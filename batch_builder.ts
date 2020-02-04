import {VertexArray, VertexBuffer} from 'toybox/gl/vertex_array'
import {Context} from 'toybox/gl/context'
import {Rect} from 'toybox/math/rect'
import * as vec2 from 'toybox/math/vec2'
import * as vec3 from 'toybox/math/vec3'

import {TextureAtlas} from 'texture_atlas'
import {AtlasObjectTexture} from 'scene'

// Temporary variables to be reused.
let positions = [vec3.newZero(), vec3.newZero(), vec3.newZero(), vec3.newZero()];
let colors = [vec3.newZero(), vec3.newZero(), vec3.newZero(), vec3.newZero()];
let normals = [vec3.newZero(), vec3.newZero(), vec3.newZero(), vec3.newZero()];
let uvs = [vec2.newZero(), vec2.newZero(), vec2.newZero(), vec2.newZero()];
let tmpNorm = [vec3.newZero(), vec3.newZero()];
let polyNorm = vec3.newZero();

export class TriBatch {
  attributes: number;
  va: VertexArray;
  uvs: VertexBuffer[] = [];

  constructor(ctx: Context, buffer: TriBuffer) {
    this.attributes = buffer.attributes;
    this.va = ctx.newVertexArray({
      position: {size: 3, data: buffer.positions},
      color: {size: 3, data: buffer.colors},
      normal: {size: 3, data: buffer.normals},
      lightUv: {size: 2, data: buffer.lightUvs},
      uv: {size: 2, data: buffer.uvs[0]},
    });

    // TODO(tom): VertexArray currently requires that a valid VertexBuffer is
    // bound for all streams when it's constructed. Fix this so that new
    // VertexBuffers can be bound after the VertexArray is constructed.
    this.uvs.push(this.va.vbs.uv);
    for (let i = 1; i < buffer.uvs.length; ++i) {
      this.uvs.push(ctx.newVertexBuffer(
        'uv', {size: 2, data: buffer.uvs[i]}, false));
    }
  }
}

export class QuadBatch {
  attributes: number;
  va: VertexArray;
  uvs: VertexBuffer[] = [];

  constructor(ctx: Context, buffer: QuadBuffer) {
    this.attributes = buffer.attributes;
    this.va = ctx.newVertexArray({
      position: {size: 3, data: buffer.positions},

      // Quads all use a color map instead of vertex colors for nice bilinear
      // interpolation.
      // color: {size: 3, data: buffer.colors},

      normal: {size: 3, data: buffer.normals},
      lightUv: {size: 2, data: buffer.lightUvs},
      pp1: {size: 4, data: buffer.pp1},
      p2p3: {size: 4, data: buffer.p2p3},
      uv: {size: 4, data: buffer.uvs[0]},

      indices: {data: buffer.indices},
    });

    // TODO(tom): VertexArray currently requires that a valid VertexBuffer is
    // bound for all streams when it's constructed. Fix this so that new
    // VertexBuffers can be bound after the VertexArray is constructed.
    this.uvs.push(this.va.vbs.uv);
    for (let i = 1; i < buffer.uvs.length; ++i) {
      this.uvs.push(ctx.newVertexBuffer(
        'uv', {size: 4, data: buffer.uvs[i]}, false));
    }
  }
}

export class BatchBuilder {
  // A temporary buffer used to write light values into the lightMap.
  lights = new Uint8Array([0, 0xff, 0xff, 0xff,
                           0, 0xff, 0xff, 0xff,
                           0, 0xff, 0xff, 0xff,
                           0, 0xff, 0xff, 0xff]);
  triBuffers = new Map<number, TriBuffer>();
  quadBuffers = new Map<number, QuadBuffer>();

  // TODO(tom): use Uint8Array for colors?
  constructor(public positions: Float32Array|Int16Array,
              public colors: Float32Array,
              public normals: Int16Array,
              public lightMap: TextureAtlas) {
  }

  addQuad(primitives: Uint16Array, base: number, texture: AtlasObjectTexture,
          color: number[]|null) {
    let numFrames = texture.animTex != null ? texture.animTex.textures.length : 1;
    let key = texture.attributes | (numFrames << 16);
    let buffer = this.quadBuffers.get(key);
    if (!buffer) {
      buffer = new QuadBuffer(this, texture.attributes, numFrames);
      this.quadBuffers.set(key, buffer);
    }
    buffer.addQuad(primitives, base, texture, color);
  }

  addTri(primitives: Uint16Array, base: number, texture: AtlasObjectTexture,
         color: number[]|null) {
    let numFrames = texture.animTex != null ? texture.animTex.textures.length : 1;
    let key = texture.attributes | (numFrames << 16);
    let buffer = this.triBuffers.get(key);
    if (!buffer) {
      buffer = new TriBuffer(this, texture.attributes, numFrames);
      this.triBuffers.set(key, buffer);
    }
    buffer.addTri(primitives, base, texture, color);
  }

  build(ctx: Context, triBatches: TriBatch[], quadBatches: QuadBatch[]) {
    for (let k of Array.from(this.triBuffers.keys()).sort()) {
      triBatches.push(new TriBatch(ctx, this.triBuffers.get(k)));
    }
    for (let k of Array.from(this.quadBuffers.keys()).sort()) {
      quadBatches.push(new QuadBatch(ctx, this.quadBuffers.get(k)));
    }
  }

  calculateNormal(a: vec3.Type, b: vec3.Type, c: vec3.Type, n: vec3.Type) {
    c = vec3.sub(tmpNorm[0], c, a);
    b = vec3.sub(tmpNorm[1], b, a);
    vec3.normalize(n, vec3.cross(n, b, c));
  }
}

export class TriBuffer {
  positions: number[] = [];
  colors: number[] = [];
  normals: number[] = [];
  lightUvs: number[] = [];
  lightBounds = new Rect(0, 0, 0, 0);
  uvs: number[][];

  constructor(public builder: BatchBuilder, public attributes: number,
              numFrames: number) {
    this.uvs = new Array(numFrames);
    for (let i = 0; i < numFrames; ++i) {
      this.uvs[i] = [];
    }
  }

  addTri(primitives: Uint16Array, base: number, texture: AtlasObjectTexture,
         color: number[]|null) {
    // Calculate vertex positions.
    for (let i = 0; i < 3; ++i) {
      let j = 3 * primitives[base + i];
      vec3.setFromValues(
          positions[i], this.builder.positions[j],
          this.builder.positions[j+1], this.builder.positions[j+2]);
    }

    // Calculate polygon normal.
    this.builder.calculateNormal(
        positions[2], positions[1], positions[0], polyNorm);

    // Calculate vertex normals & colors.
    for (let i = 0; i < 3; ++i) {
      let j = 3 * primitives[base + i];
      if (this.builder.normals != null) {
        vec3.setFromValues(
          normals[i], this.builder.normals[j], this.builder.normals[j+1],
          this.builder.normals[j+2]);
      } else {
        vec3.setFromVec(normals[i], polyNorm);
      }

      if (color != null) {
        vec3.setFromArray(colors[i], color);
      } else if (this.builder.colors != null) {
        vec3.setFromValues(
          colors[i], this.builder.colors[j], this.builder.colors[j+1],
          this.builder.colors[j+2]);
      } else {
        vec3.setFromValues(colors[i], 1, 1, 1);
      }
    }

    // Write vertex colors into the lightmap and calculate lightmap UVs.
    let texelStart = [0, 4, 8];
    for (let i = 0; i < 3; ++i) {
      let j = texelStart[i];
      this.builder.lights[j + 0] = Math.max(0, Math.min(255, 128 * colors[i][0]));
      this.builder.lights[j + 1] = Math.max(0, Math.min(255, 128 * colors[i][1]));
      this.builder.lights[j + 2] = Math.max(0, Math.min(255, 128 * colors[i][2]));
    }
    this.builder.lightMap.add(2, 2, this.builder.lights, this.lightBounds);
    // Offset the lightmap UVs by half a texel. This serves two purposes:
    //  - The texel center needs to be aligned to the vertex position in order
    //    for bilinear filtering of the lightmap texture to work correctly.
    //  - We render point primitives at the texel centers when updating for
    //    caustics.
    let dlu = 1 / this.builder.lightMap.width;
    let dlv = 1 / this.builder.lightMap.height;
    let lu = this.lightBounds.left + 0.5 * dlu;
    let lv = this.lightBounds.top + 0.5 * dlv;

    // Reverse the winding order.
    for (let i = 2; i >= 0; --i) {
      this.positions.push(positions[i][0], positions[i][1], positions[i][2]);
      this.normals.push(normals[i][0], normals[i][1], normals[i][2]);
      this.colors.push(colors[i][0], colors[i][1], colors[i][2]);
    }
    this.lightUvs.push(lu, lv + dlv);
    this.lightUvs.push(lu + dlu, lv);
    this.lightUvs.push(lu, lv);

    let animTex = texture.animTex;
    if (animTex != null) {
      for (let i = 0; i < animTex.textures.length; ++i) {
        let idx = (texture.animOffset + i) % animTex.textures.length;
        let frame = animTex.textures[idx];
        for (let j = 2; j >= 0; --j) {
          this.uvs[i].push(frame.uvs[j * 2]);
          this.uvs[i].push(frame.uvs[j * 2 + 1]);
        }
      }
    } else {
      for (let j = 2; j >= 0; --j) {
        this.uvs[0].push(texture.uvs[j * 2]);
        this.uvs[0].push(texture.uvs[j * 2 + 1]);
      }
    }
  }
}

export class QuadBuffer {
  positions: number[] = [];
  colors: number[] = [];
  normals: number[] = [];
  lightUvs: number[] = [];
  pp1: number[] = [];
  p2p3: number[] = [];
  lightBounds = new Rect(0, 0, 0, 0);
  uvs: number[][];
  indices: number[] = [];

  constructor(public builder: BatchBuilder, public attributes: number,
              numFrames: number) {
    this.uvs = new Array(numFrames);
    for (let i = 0; i < numFrames; ++i) {
      this.uvs[i] = [];
    }
  }

  private addTexBounds(frame: number, texture: AtlasObjectTexture) {
    // The bilinear UV interpolation used when rendering quads takes advantage
    // of the fact that ObjectTexture's are rectangular by passing the top, left,
    // width, and height of the texture as vertex attributes, instead of four UV
    // pairs. However, under this scheme we can't freely associate UVs with
    // arbitrary vertices. Instead we make sure that the vertices are ordered such
    // that in texture space, they are always laid out as:
    //    a --- b
    //    |     |
    //    |     |
    //    d --- c
    // Fortunately, quad UVs in TR1 always have either this layout, or are flipped
    // horizontally.

    // The first vertex should have a UV coordinate that is either the top-left,
    // or the top-right of the object texture.
    if (texture.uvs[1] != texture.texBounds[1]) {
      throw new Error('First UV coordinate should be on the top of the texture');
    }

    if (texture.uvs[0] == texture.texBounds[0]) {
      // Top-left.
      for (let i = 0; i < 4; ++i) {
        this.uvs[frame].push(
          texture.texBounds[0], texture.texBounds[1], texture.texBounds[2],
          texture.texBounds[3]);
      }
    } else {
      if (texture.uvs[0] != texture.texBounds[0] + texture.texBounds[2]) {
        debugger
      }
      // Top-right.
      for (let i = 0; i < 4; ++i) {
        this.uvs[frame].push(
            texture.texBounds[0] + texture.texBounds[2], texture.texBounds[1],
            -texture.texBounds[2], texture.texBounds[3]);
      }
    }
  }

  addQuad(primitives: Uint16Array, base: number, texture: AtlasObjectTexture,
          color: number[]|null) {
    // Calculate vertex positions.
    for (let i = 0; i < 4; ++i) {
      let j = 3 * primitives[base + i];
      vec3.setFromValues(
          positions[i], this.builder.positions[j],
          this.builder.positions[j+1], this.builder.positions[j+2]);
    }
    this.builder.calculateNormal(
        positions[0], positions[3], positions[1], polyNorm);

    // Calculate vertex normals & colors.
    for (let i = 0; i < 4; ++i) {
      let j = 3 * primitives[base + i];
      if (this.builder.normals != null) {
        vec3.setFromValues(
          normals[i], this.builder.normals[j], this.builder.normals[j+1],
          this.builder.normals[j+2]);
      } else {
        vec3.setFromVec(normals[i], polyNorm);
      }

      if (color != null) {
        vec3.setFromArray(colors[i], color);
      } else if (this.builder.colors != null) {
        vec3.setFromValues(
          colors[i], this.builder.colors[j], this.builder.colors[j+1],
          this.builder.colors[j+2]);
      } else {
        vec3.setFromValues(colors[i], 1, 1, 1);
      }
    }

    // Write vertex colors into the lightmap and calculate lightmap UVs.
    let texelStart = [0, 4, 12, 8];
    for (let i = 0; i < 4; ++i) {
      let j = texelStart[i];
      this.builder.lights[j + 0] = Math.max(0, Math.min(255, 128 * colors[i][0]));
      this.builder.lights[j + 1] = Math.max(0, Math.min(255, 128 * colors[i][1]));
      this.builder.lights[j + 2] = Math.max(0, Math.min(255, 128 * colors[i][2]));
    }
    this.builder.lightMap.add(2, 2, this.builder.lights, this.lightBounds);
    // Offset the lightmap UVs by half a texel. This serves two purposes:
    //  - The texel center needs to be aligned to the vertex position in order
    //    for bilinear filtering of the lightmap texture to work correctly.
    //  - We render point primitives at the texel centers when updating for
    //    caustics.
    let dlu = 1 / this.builder.lightMap.width;
    let dlv = 1 / this.builder.lightMap.height;
    let lu = this.lightBounds.left + 0.5 * dlu;
    let lv = this.lightBounds.top + 0.5 * dlv;

    let indexBase = this.positions.length / 3;
    this.indices.push(indexBase + 0);
    this.indices.push(indexBase + 3);
    this.indices.push(indexBase + 1);
    this.indices.push(indexBase + 1);
    this.indices.push(indexBase + 3);
    this.indices.push(indexBase + 2);

    for (let i = 0; i < 4; ++i) {
      this.positions.push(positions[i][0], positions[i][1], positions[i][2]);
      this.normals.push(normals[i][0], normals[i][1], normals[i][2]);
      this.lightUvs.push(lu, lv);
    }

    // Project from 3D to 2D by discarding the largest component of the normal.
    let uIdx;
    let vIdx;
    if (Math.abs(polyNorm[0]) > Math.abs(polyNorm[1])) {
      if (Math.abs(polyNorm[0]) > Math.abs(polyNorm[2])) {
        uIdx = 1;
        vIdx = 2;
      } else {
        uIdx = 0;
        vIdx = 1;
      }
    } else {
      if (Math.abs(polyNorm[1]) > Math.abs(polyNorm[2])) {
        uIdx = 0;
        vIdx = 2;
      } else {
        uIdx = 0;
        vIdx = 1;
      }
    }

    for (let i = 0; i < 4; ++i) {
      vec2.setFromValues(uvs[i], positions[i][uIdx], positions[i][vIdx]);
    }
    let ab = vec2.sub(uvs[1], uvs[1], uvs[0]);
    let ac = vec2.sub(uvs[2], uvs[2], uvs[0]);
    let ad = vec2.sub(uvs[3], uvs[3], uvs[0]);

    // Tomb Raider's large polygons give some GPU interpolators a hard time.
    // Scale down the vertex attributes to avoid precision issues.
    vec2.scale(ab, 0.01, ab);
    vec2.scale(ac, 0.01, ac);
    vec2.scale(ad, 0.01, ad);

    this.pp1.push(
            0,     0, ab[0], ab[1],
        ab[0], ab[1], ab[0], ab[1],
        ac[0], ac[1], ab[0], ab[1],
        ad[0], ad[1], ab[0], ab[1]);

    this.p2p3.push(
        ac[0], ac[1], ad[0], ad[1],
        ac[0], ac[1], ad[0], ad[1],
        ac[0], ac[1], ad[0], ad[1],
        ac[0], ac[1], ad[0], ad[1]);

    let animTex = texture.animTex;
    if (animTex != null) {
      for (let i = 0; i < animTex.textures.length; ++i) {
        let idx = (texture.animOffset + i) % animTex.textures.length;
        let frame = animTex.textures[idx];
        this.addTexBounds(i, frame);
      }
    } else {
      this.addTexBounds(0, texture);
    }
  }
}

