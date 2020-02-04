import * as mat4 from 'toybox/math/mat4';
import * as vec3 from 'toybox/math/vec3';

import {GL} from 'toybox/gl/constants';
import {Context} from 'toybox/gl/context';
import {Framebuffer} from 'toybox/gl/framebuffer';
import {ShaderProgram} from 'toybox/gl/shader';
import {Texture2DDef} from 'toybox/gl/texture';
import {VertexArray} from 'toybox/gl/vertex_array';
import {TypedArrayList} from 'toybox/util/array';

import * as debug from 'debug';

import {Item} from 'scene';

let min = vec3.newZero();
let max = vec3.newZero();
let center = vec3.newZero();
let extents = vec3.newZero();
let transform = mat4.newZero();
let verts = [vec3.newZero(), vec3.newZero(), vec3.newZero(), vec3.newZero()];

export class ProjectionShadow {
  public fb: Framebuffer;
  private tmpFb: Framebuffer;
  private cameraPos = vec3.newZero();
  private up = vec3.newFromValues(0, 0, 1);
  private world = mat4.newZero();
  private view = mat4.newZero();
  private proj = mat4.newZero();
  private viewProj = mat4.newZero();
  private worldViewProj = mat4.newZero();

  // Bounds of the shadow casting item.
  private min = vec3.newZero();
  private max = vec3.newZero();

  private shaders: {
    blur: ShaderProgram;
    projection: ShaderProgram;
    silhouette: ShaderProgram;
  };

  private vas: {
    blur: VertexArray;
    projection: VertexArray;
  };

  private vertices = new TypedArrayList(Float32Array);

  constructor(
      private ctx: Context, private item: Item, public resolution: number, public size: number, public depth: number) {
    let fbDef: Texture2DDef = {
      size: resolution,
      filter: GL.LINEAR,
      format: GL.R8,
    };
    this.fb = ctx.newFramebuffer(fbDef);
    this.tmpFb = ctx.newFramebuffer(fbDef);

    this.shaders = {
      silhouette: ctx.newShaderProgram(
          'shaders/silhouette.vs', 'shaders/silhouette.fs'),
      projection: ctx.newShaderProgram(
          'shaders/projection_shadow.vs', 'shaders/projection_shadow.fs'),
      blur: ctx.newShaderProgram(
          'shaders/blit.vs', 'shaders/gaussian_blur.fs'),
    };

    this.vas = {
      blur: ctx.newVertexArray({
        uv: { size: 2, data: [0, 0,  1, 1,  0, 1,  0, 0,  1, 0,  1, 1] },
      }),
      projection: ctx.newVertexArray({
        position: { size: 3, type: GL.FLOAT, data: null },
      }),
    };
  }

  draw(viewProj: mat4.Type) {
    let ctx = this.ctx;
    let item = this.item;
    let animState = item.animState;
    let frame = animState.frame;
    let moveable = item.moveable;
    let room = item.room;

    // Get the sectors covered by the item's bounding box.
    // First, convert the frame's OBB to an ABB.
    vec3.add(center, frame.min, frame.max);
    vec3.scale(center, 0.5, center);
    mat4.mulPos(center, animState.transform, center);

    vec3.sub(extents, frame.max, frame.min);
    vec3.scale(extents, 0.5, extents);
    mat4.abs(transform, animState.transform);
    mat4.mulVec(extents, transform, extents);

    vec3.add(max, center, extents);
    vec3.sub(min, center, extents);
 
    // Next, add a little padding because the shadow footprint will be expanded
    // a little when it's blurred.
    let padding = this.size * 8 / this.resolution;

    let si = ((min[0] - padding) / 1024)|0;
    let sj = ((min[2] - padding) / 1024)|0;
    let ei = ((max[0] + padding) / 1024)|0;
    let ej = ((max[2] + padding) / 1024)|0;

    let oi = (item.position[0] / 1024)|0;
    let oj = (item.position[2] / 1024)|0;
    let baseSector = room.getSectorByGrid(oi, oj);
    if (baseSector == null) {
      return;
    }

    this.vertices.clear();
    for (let j = sj; j <= ej; ++j) {
      for (let i = si; i <= ei; ++i) {
        let sector = baseSector.getResolvedSectorByGrid(i, j, item.position[1]);
        if (sector == null) { continue; }
        sector = sector.getResolvedFloorSector();
        if (sector == null || sector.quadCollision.length == 0) { continue; }
        let slope = sector.floorData.floorSlope;
        if (sector.floor + Math.abs(slope[0]) + Math.abs(slope[1]) < min[1]) { continue; }
        let quad = sector.quadCollision[0];
        sector.getFloorVertex(0, 0, verts[0]);
        sector.getFloorVertex(1, 0, verts[1]);
        sector.getFloorVertex(1, 1, verts[2]);
        sector.getFloorVertex(0, 1, verts[3]);
        this.vertices.pushVec3(verts[0], verts[1], verts[2]);
        this.vertices.pushVec3(verts[0], verts[2], verts[3]);
      }
    }

    if (this.vertices.length == 0) {
      return;
    }

    // TODO(tom): project shadow onto blocks too
    // TODO(tom): set camera offset from frame.min, frame.max.
    vec3.setFromValues(this.cameraPos, 0, -2048, 0);
    vec3.add(this.cameraPos, this.cameraPos, center);

    mat4.setLookAt(this.view, this.cameraPos, center, this.up);

    let s = 0.5 * this.size;
    mat4.setOrtho(
        this.proj,
        -s, s, -s, s, -10000, 10000);

    mat4.mul(this.viewProj, this.proj, this.view);

    ctx.bindFramebuffer(this.fb);

    ctx.clearColor(0, 0, 0, 0);
    ctx.clear(GL.COLOR_BUFFER_BIT);

    ctx.useProgram(this.shaders.silhouette);
    for (let meshIdx of moveable.renderableMeshIndices) {
      let mesh = moveable.meshes[meshIdx];
      let world = animState.meshTransforms[meshIdx];

      mat4.mul(this.worldViewProj, this.viewProj, world);
      ctx.setUniform('worldViewProj', this.worldViewProj);

      for (let batch of mesh.quadBatches) {
        ctx.draw(batch.va);
      }
      for (let batch of mesh.triBatches) {
        ctx.draw(batch.va);
      }
    }

    ctx.bindFramebuffer(this.tmpFb);
    ctx.useProgram(this.shaders.blur);
    ctx.bindTexture('tex', this.fb.color[0]);
    ctx.setUniform('scaleOffset', 2.0, 2.0, -1.0, -1.0);
    ctx.setUniform('duv', 1.0 / this.resolution, 0);
    ctx.draw(this.vas.blur);

    ctx.bindFramebuffer(this.fb);
    ctx.bindTexture('tex', this.tmpFb.color[0]);
    ctx.setUniform('duv', 0, 1.0 / this.resolution);
    ctx.draw(this.vas.blur);

    let p = this.item.position;
    mat4.setTranslate(this.world, p[0], p[1], p[2]);
    mat4.mul(this.worldViewProj, viewProj, this.world);

    ctx.bindFramebuffer(null);
    ctx.enable(GL.BLEND);
    ctx.blendFunc(GL.ONE, GL.ONE_MINUS_SRC_ALPHA);
    ctx.enable(GL.POLYGON_OFFSET_FILL);
    ctx.polygonOffset(-0.5, -1);
    ctx.useProgram(this.shaders.projection);
    ctx.bindTexture('tex', this.fb.color[0]);
    ctx.setUniform('viewProj', viewProj);
    ctx.setUniform('shadowViewProj', this.viewProj);
    ctx.setUniform('opacity', 0.4);

    this.vas.projection.setVertexData('position', this.vertices.data, this.vertices.length / 3);
    ctx.draw(this.vas.projection);
    ctx.disable(GL.POLYGON_OFFSET_FILL);
    ctx.disable(GL.BLEND);
  }
}

