import * as icosphere from 'toybox/geom/icosphere';
import * as sh3 from 'toybox/math/sh3';
import * as mat4 from 'toybox/math/mat4';
import * as vec2 from 'toybox/math/vec2';
import * as vec3 from 'toybox/math/vec3';
import * as vec4 from 'toybox/math/vec4';

import {Mesh} from 'toybox/geom/mesh';

import {GL, TextureMinFilter} from 'toybox/gl/constants';
import {Context} from 'toybox/gl/context';
import {DynamicCubeMap, FORWARD} from 'toybox/gl/dynamic_cube_map';
import {Framebuffer} from 'toybox/gl/framebuffer';
import {ShaderProgram} from 'toybox/gl/shader';
import {VertexArray} from 'toybox/gl/vertex_array';
import {getMagFilter, Texture, Texture2D, Texture2DDef} from 'toybox/gl/texture';

import {TweakObject} from 'toybox/app/tweaks';

// TODO(tom): decouple debug from Renderer
import * as debug from 'debug';
import * as hacks from 'hacks';

import {Batch} from 'batch_builder';
import {Lara} from 'controllers/lara';
import {ProjectionShadow} from 'projection_shadow';
import {Item, Room, Scene} from 'scene';
import {Culler, VisibleRoom} from 'visibility';

import {Probe, ShProbeField} from 'sh_probe';

let tmp = vec3.newZero();

console.log(`
  Calculating value to make quad bilinear interpolation match triangle interpolation:
   a         b
    +-------+
    |  x   /|
    |   ./  |
    |  /    |
    |/      |
    +-------+
   d         c

  x = (a + b + c + d) / 4
  x = (b + d) / 2
  c = b + d - a
`);
class RenderView {
  view = mat4.newZero();
  proj = mat4.newZero();
  viewProj = mat4.newZero();
  eyePos = vec3.newZero();
  fb: Framebuffer = null;
  visibleRooms: VisibleRoom[];
  tint = vec3.newZero();

  constructor(public name: string, public flags: number,
              public quadShader: ShaderProgram, public triShader: ShaderProgram) {}

  updateTint(room: Room) {
    if (this.visibleRooms[0].room.isUnderwater() || room.isUnderwater()) {
      vec3.setFromValues(this.tint, 0.5, 1, 1);
    } else {
      vec3.setFromValues(this.tint, 1, 1, 1);
    }
  }
}

namespace RenderView {
  export const STATIC = 1 << 0;
  export const MOVEABLES = 1 << 1;
  export const CRYSTALS = 1 << 2;
  export const SPRITES = 1 << 3;
  export const ALL = ~0;
}

// TODO(tom): remove ColoredMesh and extend the Mesh class to support vertex
// colors & normals.
class ColoredMesh {
  constructor(public positions: vec3.Type[],
              public colors: vec3.Type[],
              public indices: number[]) {}
}

// Probe field with debug geometry.
class DebugProbeField extends ShProbeField {
  va: VertexArray;

  createVertexArray(ctx: Context) {
    let radius = 128;
    let reflectance = 0.8;
    let room = this.room;
    let width = room.sectorTableWidth;
    let height = room.sectorTableHeight;

    let x = room.x + 512;
    let z = room.z + 512;
    let pos = vec3.newZero();
    let meshes: ColoredMesh[] = [];
    for (let j = 0; j < height; ++j) {
      pos[2] = z + j * 1024;
      for (let i = 0; i < width; ++i) {
        pos[0] = x + i * 1024;
        for (let probe of this.probes[i + j * width]) {
          pos[1] = probe.y;
          let mesh = this.createProbeMesh(pos, probe, radius, reflectance);
          meshes.push(mesh);
        }
      }
    }

    let numVertices = 0;
    let numIndices = 0;
    for (let mesh of meshes) {
      numVertices += mesh.positions.length;
      numIndices += mesh.indices.length;
    }

    let positions = new Float32Array(3 * numVertices);
    let colors = new Float32Array(3 * numVertices);
    let indices = new Uint32Array(numIndices);

    let dstIdx = 0;
    for (let mesh of meshes) {
      for (let srcIdx = 0; srcIdx < mesh.positions.length; ++srcIdx) {
        let p = mesh.positions[srcIdx];
        let c = mesh.colors[srcIdx];
        positions[dstIdx] = p[0];
        positions[dstIdx + 1] = p[1];
        positions[dstIdx + 2] = p[2];
        colors[dstIdx] = c[0];
        colors[dstIdx + 1] = c[1];
        colors[dstIdx + 2] = c[2];
        dstIdx += 3;
      }
    }

    let base = 0;
    dstIdx = 0;
    for (let mesh of meshes) {
      for (let srcIdx of mesh.indices) {
        indices[dstIdx++] = base + srcIdx;
      }
      base += mesh.positions.length;
    }

    this.va = ctx.newVertexArray({
      position: {size: 3, data: positions},
      color: {size: 3, data: colors},
      indices: {data: indices},
    });
  }

  private createProbeMesh(pos: vec3.Type, probe: Probe, radius: number, reflectance: number) {
    let sphere = icosphere.newMesh(3);
    let colors: vec3.Type[] = [];
    for (let p of sphere.positions) {
      let col = vec3.newZero()

      // Ambient illumination is physically based.
      sh3.reconstruct(col, probe.sh, p);

      // Direct illumination is a massive hack that happens to look nice.
      const WRAP = 0.5;
      let L = Math.max(0, (vec3.dot(p, probe.dir) + WRAP) / (1 + WRAP));
      vec3.addScaled(col, col, probe.col, L * L);
      vec3.pow(col, col, 1 / 2.2);
      colors.push(col);
      vec3.addScaled(p, pos, p, radius);
    }
    return new ColoredMesh(sphere.positions, colors, sphere.faceIndices);
  }
}

class RenderPass {
  lists: RenderPass.RenderList[] = [];
  constructor(public rv: RenderView, public shader: ShaderProgram) {}
}

namespace RenderPass {
  export class RenderList {
    enableStencil = false;
    world: mat4.Type = null;
    uniforms: {[key: string]: Float32Array | number | number[]} = {};
    samplers: {[key: string]: Texture} = {};
    batches: Batch[] = [];
  }
}

export class Renderer {
  ctx: Context;
  private scene: Scene;
  private lara: Lara;
  private fieldOfViewY: number;
  private texAnimIndex: number;

  private worldViewProj = mat4.newIdentity();
  private worldView = mat4.newIdentity();
  private identity = mat4.newIdentity();

  private culler: Culler;

  private lightConstants = new Float32Array(16);
  private noLightsConstants = new Float32Array(16);

  private fogStart = 8192;
  private fogDensity = 0.00015;

  private bakedLightTex: Texture2D;
  private lightFb: Framebuffer;

  private shaders: {[key: string]: ShaderProgram};

  private atlasTex: Texture2D;
  private shadow: ProjectionShadow;

  private crystalFb: Framebuffer;

  private cubeMap: DynamicCubeMap;

  private probeFields: DebugProbeField[] = [];

  private texBindings: [string, Texture][] = [];

  private renderState = {
    view: mat4.newZero(),
    proj: mat4.newZero(),
    fogStartDensity: new Float32Array(2),
    tex: null as Texture2D,
    lightTex: null as Texture2D,
  };

  constructor(ctx: Context, scene: Scene, lara: Lara) {
    this.ctx = ctx;
    this.scene = scene;
    this.lara = lara;
    this.fieldOfViewY = 60 * Math.PI / 180;
    this.texAnimIndex = 0;

    for (let room of scene.rooms) {
      this.probeFields.push(null);
    }

    this.culler = new Culler(scene.rooms, scene.items);

    this.atlasTex = ctx.newTexture2D({
      width: scene.atlasTex.width,
      height: scene.atlasTex.height,
      data: scene.atlasTex.data,
      filter: GL.LINEAR_MIPMAP_LINEAR,
      wrap: GL.CLAMP_TO_EDGE,
      format: GL.RGBA8});
    ctx.generateMipmap(GL.TEXTURE_2D);

    let maxAniso = ctx.getParameter(GL.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    ctx.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    ctx.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAX_LOD, 6);

    this.shadow = new ProjectionShadow(ctx, lara.item, 256, 1280, 64);

    let lightTexDef: Texture2DDef = {
      width: scene.lightTex.width,
      height: scene.lightTex.height,
      data: scene.lightTex.data,
      filter: GL.LINEAR,
      wrap: GL.CLAMP_TO_EDGE,
      format: GL.RGBA8,
    };
    this.bakedLightTex = ctx.newTexture2D(lightTexDef);
    this.lightFb = ctx.newFramebuffer(lightTexDef);

    this.crystalFb = ctx.newFramebuffer(
        {size: 256, format: GL.RGBA8, filter: GL.LINEAR},
        {size: 256, format: GL.DEPTH_COMPONENT16});

    let cubeMapFormat: DynamicCubeMap.Format[] = [
        {format: GL.RGBA8, filter: GL.NEAREST},
        {format: GL.RGBA8, filter: GL.NEAREST},
        {format: GL.RGBA8, filter: GL.NEAREST},
    ];
    this.cubeMap = new DynamicCubeMap(this.ctx, 32, cubeMapFormat, 8, 102400, true);

    // Set the default texture bindings for when rendering normal geometry.
    // Subsequent render passes (e.g. projection shadow) stomp on some of these,
    // so the texture bindings should be set before each beginning rendering pass.
    // TODO(tom): fix this stomping so we only need to set the texture bindings once.
    this.texBindings = [
      ['tex', this.atlasTex],  // TODO(tom): rename tex to atlasTex
      ['bakedLightTex', this.bakedLightTex],
      ['lightTex', this.lightFb.color[0]],
      ['crystalTex', this.crystalFb.color[0]],
    ];

    // Build a map from sampler name to texture unit.
    // This map is passed in when compiling shaders.
    let texUnits: {[key: string]: number} = {};
    for (let i = 0; i < this.texBindings.length; ++i) {
      let texName = this.texBindings[i][0];
      texUnits[texName] = i;
    }

    this.shaders = {
      causticsQuad: ctx.newShaderProgram('shaders/caustics_quad.vs',
                                         'shaders/caustics.fs',
                                         {defines: {ENABLE_LIGHTING: 1}, texUnits}),
      causticsTri: ctx.newShaderProgram('shaders/caustics_tri.vs',
                                        'shaders/caustics.fs',
                                        {defines: {ENABLE_LIGHTING: 1}, texUnits}),
      colorQuad: ctx.newShaderProgram('shaders/quad.vs',
                                      'shaders/quad.fs',
                                      {defines: {ENABLE_LIGHTING: 1}, texUnits}),
      colorTri: ctx.newShaderProgram('shaders/tri.vs',
                                     'shaders/tri.fs',
                                     {defines: {ENABLE_LIGHTING: 1}, texUnits}),
      probeQuad: ctx.newShaderProgram('shaders/probe_quad.vs',
                                      'shaders/probe.fs',
                                      {texUnits}),
      probeTri: ctx.newShaderProgram('shaders/probe_tri.vs',
                                     'shaders/probe.fs',
                                     {texUnits}),
      sprite: ctx.newShaderProgram('shaders/sprite.vs',
                                   'shaders/sprite.fs',
                                   {texUnits}),
      crystal: ctx.newShaderProgram('shaders/crystal.vs',
                                    'shaders/crystal.fs',
                                    {texUnits}),
      vertexColor: ctx.newShaderProgram('shaders/vertex_color.vs',
                                        'shaders/vertex_color.fs',
                                        {texUnits}),
      portalStencil: ctx.newShaderProgram('shaders/position_only.vs',
                                          'shaders/position_only.fs',
                                          {texUnits}),
    };
  }

  render(time: number, cameraTransform: mat4.Type, room: Room) {
    if (this.probeFields[room.id] == null) {
      this.probeFields[room.id] = this.createProbeFieldForRoom(room);
    }

    let ctx = this.ctx;

    // Update globals.
    // Animate textures at 6fps.
    this.texAnimIndex = Math.floor(time * 6);
    this.fogStart = debug.options.fogStart;
    this.fogDensity = debug.options.fogDensity / 1000;

    // TODO(tom): set these per RenderView
    let aspectRatio = ctx.canvas.width / ctx.canvas.height;
    let fov = this.fieldOfViewY;

    let mainView = new RenderView(
        'main', RenderView.ALL, this.shaders.colorQuad, this.shaders.colorTri);
    mat4.invert(mainView.view, cameraTransform);
    mat4.getTranslation(mainView.eyePos, cameraTransform);
    mat4.setPerspective(mainView.proj, fov, aspectRatio, 8, 102400);
    mat4.mul(mainView.viewProj, mainView.proj, mainView.view);

    mainView.visibleRooms = this.culler.cull(room, mainView.view, mainView.proj);

    // TODO(tom): calculate all RenderView visible rooms first, then update
    // caustics on their union.
    ctx.profile('caustics', () => {
      let rooms = [];
      for (let visibleRoom of mainView.visibleRooms) {
        if (visibleRoom.room.isUnderwater()) {
          rooms.push(visibleRoom.room);
        }
      }
      this.updateCaustics(time, rooms);
    });

    this.drawRenderView(mainView);

    let crystal = this.findClosestVisibleSaveCrystal(mainView);
    if (crystal != null) {
      let reflectView = new RenderView(
          'crystal', RenderView.STATIC | RenderView.MOVEABLES | RenderView.SPRITES,
          this.shaders.colorQuad, this.shaders.colorTri);
      reflectView.fb = this.crystalFb;

      mat4.getTranslation(reflectView.eyePos, crystal.animState.meshTransforms[0]);
      mat4.setLookAt(reflectView.view, reflectView.eyePos, mainView.eyePos, vec3.newFromValues(0, -1, 0));
      mat4.setPerspective(reflectView.proj, 0.5 * Math.PI, 1, 8, 102400);
      mat4.mul(reflectView.viewProj, reflectView.proj, reflectView.view);
      reflectView.visibleRooms = this.culler.cull(crystal.room, reflectView.view, reflectView.proj);
      this.drawRenderView(reflectView);

      ctx.bindFramebuffer(null);
      // debug.draw.blitRgb(
      //     reflectView.fb.color[0],
      //     0, ctx.canvas.height - 2 * reflectView.fb.height,
      //     2 * reflectView.fb.width, 2 * reflectView.fb.height);
    }

    // SH
    // SH
    // SH
    // SH
    let field = this.probeFields[this.lara.item.room.id];
    if (field != null) {
      let sh = sh3.newZero();

      let hips = this.lara.item.animState.meshTransforms[0];
      let R = 128;
      let P = vec3.newFromValues(hips[12], hips[13], hips[14]);
      field.sample(sh, P);

      let sphere = icosphere.newMesh(2);
      let colors: vec3.Type[] = [];
      for (let p of sphere.positions) {
        let col = vec3.newZero()
        sh3.reconstruct(col, sh, p);
        col[0] = Math.pow(Math.max(0.8 * col[0], 0), 1 / 2.2);
        col[1] = Math.pow(Math.max(0.8 * col[1], 0), 1 / 2.2);
        col[2] = Math.pow(Math.max(0.8 * col[2], 0), 1 / 2.2);
        colors.push(col);

        p[0] = p[0] * R + P[0];
        p[1] = p[1] * R + P[1];
        p[2] = p[2] * R + P[2];
      }

      ctx.stencilFunc(GL.ALWAYS, 0, 0xff);
      ctx.stencilOp(GL.KEEP, GL.KEEP, GL.KEEP);

      for (let i = 0; i < sphere.faceIndices.length;) {
        let i0 = sphere.faceIndices[i++];
        let i1 = sphere.faceIndices[i++];
        let i2 = sphere.faceIndices[i++];
        let p0 = sphere.positions[i0];
        let p1 = sphere.positions[i1];
        let p2 = sphere.positions[i2];
        let c0 = colors[i0];
        let c1 = colors[i1];
        let c2 = colors[i2];
        debug.draw.triangles.push(p0[0], p0[1], p0[2], c0[0], c0[1], c0[2], 1);
        debug.draw.triangles.push(p1[0], p1[1], p1[2], c1[0], c1[1], c1[2], 1);
        debug.draw.triangles.push(p2[0], p2[1], p2[2], c2[0], c2[1], c2[2], 1);
      }
      debug.draw.flush(mainView.viewProj, 0.1);
      // SH
      // SH
      // SH
      // SH
    }

    ctx.useProgram(this.shaders.vertexColor);
    ctx.setUniform('viewProj', mainView.viewProj);
    ctx.setUniform('fogStartDensity', this.fogStart, this.fogDensity);
    for (let visibleRoom of mainView.visibleRooms) {
      let field = this.probeFields[visibleRoom.room.id];
      if (field != null) {
        ctx.draw(field.va);
      }
      break;
    }

    ctx.profile('shadow', () => {
      this.shadow.draw(mainView.viewProj);
    });

    ctx.profile('debug', () => {
      // TODO(tom): call this from the main app, not the renderer internals, then
      // remove Lara and possible other dependencies.
      debug.render(this.scene, room, mainView.viewProj, mainView.visibleRooms);
    });
  }

  private findClosestVisibleSaveCrystal(rv: RenderView) {
    let closest: Item = null;
    let closestDisSqr = Infinity;
    for (let visibleRoom of rv.visibleRooms) {
      for (let item of visibleRoom.moveables) {
        if (!item.isSaveCrystal()) { continue; }
        let disSqr = vec3.distanceSqr(item.position, rv.eyePos);
        if (disSqr < closestDisSqr) {
          closest = item;
          closestDisSqr = disSqr;
        }
      }
    }
    return closest;
  }

  private drawRenderView(rv: RenderView) {
    let ctx = this.ctx;

    for (let i = 0; i < this.texBindings.length; ++i) {
      let tex = this.texBindings[i][1];
      ctx.gl.activeTexture(GL.TEXTURE0 + i);
      ctx.gl.bindTexture(tex.target, tex.handle)
    }

    // Set default render state.
    ctx.colorMask(true, true, true, true);
    ctx.depthMask(true);
    ctx.enable(GL.DEPTH_TEST);
    ctx.stencilFunc(GL.ALWAYS, 0, 0xff);
    ctx.stencilOp(GL.KEEP, GL.KEEP, GL.KEEP);
    ctx.disable(GL.BLEND);
    ctx.clearColor(0, 0, 0, 1);
    ctx.clearStencil(0);
    ctx.enable(GL.CULL_FACE);

    // Color & depth pass.
    ctx.enable(GL.SAMPLE_ALPHA_TO_COVERAGE);
    ctx.bindFramebuffer(rv.fb);
    ctx.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT | GL.STENCIL_BUFFER_BIT);
    ctx.colorMask(true, true, true, false);
    ctx.depthFunc(GL.LEQUAL);

    // Some room meshes overlap each other. For those we apply stencil tests
    // when rendering. Replace the stencil value on z-pass only (used when
    // drawing the portals to set up the stencil test).
    ctx.stencilOp(GL.KEEP, GL.KEEP, GL.REPLACE);

    if (rv.flags & RenderView.STATIC) {
      this.drawWorldGeometry(rv);
      this.drawStaticGeometry(rv);
    }
    if (rv.flags & RenderView.SPRITES) {
      this.drawSprites(rv);
    }
    if (rv.flags & RenderView.MOVEABLES) {
      this.drawMoveables(rv);
    }
    if (rv.flags & RenderView.CRYSTALS) {
      this.drawCrystals(rv);
    }

    ctx.disable(GL.STENCIL_TEST);
    ctx.disable(GL.SAMPLE_ALPHA_TO_COVERAGE);
  }

  private drawPortalStencil(visibleRoom: VisibleRoom, viewProj: mat4.Type) {
    let ctx = this.ctx;

    // Don't write to the depth or color buffers when drawing the stencil mask.
    ctx.enable(GL.STENCIL_TEST);
    ctx.colorMask(false, false, false, false);
    ctx.depthMask(false);
    ctx.stencilMask(0xff);

    // Write the stencil value to all visible portal pixels.
    ctx.stencilFunc(GL.ALWAYS, visibleRoom.stencilMask, 0xff);
    ctx.useProgram(this.shaders.portalStencil);
    ctx.setUniform('viewProj', viewProj);
    ctx.draw(visibleRoom.room.portalVa);

    // Reset the render state.
    ctx.colorMask(true, true, true, false);
    ctx.depthMask(true);
    ctx.stencilMask(0x00);

    // Only write to pixels whose stencil value matches the stencil.
    ctx.stencilFunc(GL.EQUAL, visibleRoom.stencilMask, 0xff);
  }

  private drawWorldBatches(rv: RenderView, batches: Batch[]) {
    let ctx = this.ctx;

    ctx.setUniform('worldViewProj', rv.viewProj);
    ctx.setUniform('tint', rv.tint);
    for (let batch of batches) {
      if (batch.uvs.length > 1) {
        // Note: bindVertexBuffer only calls into GL if the vertex buffer is
        // different.
        let frame = this.texAnimIndex % batch.uvs.length;
        batch.va.bindVertexBuffer(batch.uvs[frame]);
      }
      // TODO(tom): check for WEBGL_multi_draw support and draw all batches with
      // a single call.
      ctx.draw(batch.va);
    }
  }

  private drawBatches(rv: RenderView, world: mat4.Type, intensity: number, batches: Batch[]) {
    let ctx = this.ctx;

    mat4.mul(this.worldViewProj, rv.viewProj, world);
    ctx.setUniform('world', world);
    ctx.setUniform('worldViewProj', this.worldViewProj);
    ctx.setUniform('tint', rv.tint[0] * intensity, rv.tint[1] * intensity, rv.tint[2] * intensity);

    for (let batch of batches) {
      if (batch.uvs.length > 1) {
        // Note: bindVertexBuffer only calls into GL if the vertex buffer is
        // different.
        let frame = this.texAnimIndex % batch.uvs.length;
        batch.va.bindVertexBuffer(batch.uvs[frame]);
      }
      // TODO(tom): check for WEBGL_multi_draw support and draw all batches with
      // a single call.
      ctx.draw(batch.va);
    }
  }

  private drawWorldGeometry(rv: RenderView) {
    let ctx = this.ctx;
    ctx.useProgram(rv.quadShader);
    ctx.setUniform('fogStartDensity', this.fogStart, this.fogDensity);
    this.disableLighting();
    for (let visibleRoom of rv.visibleRooms) {
      if (visibleRoom.stencilMask) {
        this.drawPortalStencil(visibleRoom, rv.viewProj);
        ctx.enable(GL.STENCIL_TEST);
        ctx.useProgram(rv.quadShader);
      }
      rv.updateTint(visibleRoom.room);
      this.drawBatches(rv, this.identity, 1, visibleRoom.room.quadBatches);
      if (visibleRoom.stencilMask) {
        ctx.disable(GL.STENCIL_TEST);
      }
    }

    ctx.useProgram(rv.triShader);
    ctx.setUniform('fogStartDensity', this.fogStart, this.fogDensity);
    this.disableLighting();
    for (let visibleRoom of rv.visibleRooms) {
      if (visibleRoom.stencilMask) {
        this.drawPortalStencil(visibleRoom, rv.viewProj);
        ctx.enable(GL.STENCIL_TEST);
        ctx.useProgram(rv.triShader);
      }
      rv.updateTint(visibleRoom.room);
      this.drawBatches(rv, this.identity, 1, visibleRoom.room.triBatches);
      if (visibleRoom.stencilMask) {
        ctx.disable(GL.STENCIL_TEST);
      }
    }
  }

  private drawStaticGeometry(rv: RenderView) {
    let ctx = this.ctx;
    ctx.useProgram(rv.quadShader);
    ctx.setUniform('fogStartDensity', this.fogStart, this.fogDensity);
    this.disableLighting();
    for (let visibleRoom of rv.visibleRooms) {
      rv.updateTint(visibleRoom.room);
      for (let roomStaticMesh of visibleRoom.room.renderableStaticMeshes) {
        let mesh = this.scene.meshes[roomStaticMesh.staticMesh.mesh];
        this.drawBatches(
            rv,
            roomStaticMesh.transform,
            roomStaticMesh.intensity,
            mesh.quadBatches);
      }
    }

    ctx.useProgram(rv.triShader);
    ctx.setUniform('fogStartDensity', this.fogStart, this.fogDensity);
    this.disableLighting();
    for (let visibleRoom of rv.visibleRooms) {
      rv.updateTint(visibleRoom.room);
      for (let roomStaticMesh of visibleRoom.room.renderableStaticMeshes) {
        let mesh = this.scene.meshes[roomStaticMesh.staticMesh.mesh];
        this.drawBatches(
            rv,
            roomStaticMesh.transform,
            roomStaticMesh.intensity,
            mesh.triBatches);
      }
    }
  }

  private drawSprites(rv: RenderView) {
    let ctx = this.ctx;
    ctx.useProgram(this.shaders.sprite);
    ctx.setUniform('fogStartDensity', this.fogStart, this.fogDensity);
    for (let visibleRoom of rv.visibleRooms) {
      let sb = visibleRoom.room.spriteBatch;
      if (sb != null) {
        ctx.setUniform('translation', 0, 0, 0);
        ctx.setUniform('viewProj', rv.viewProj);
        ctx.draw(sb.va);
      }

      // Draw sprite sequences
      // TODO(tom): light sprites correctly. For example: near the exit of the
      // room containing the gold idol in Vilcabamba, there is a large medikit
      // that's supposed to be hidden in the shadows.
      for (let item of visibleRoom.spriteSequences) {
        let frame = this.texAnimIndex % item.spriteSequence.batches.length;
        let batch = item.spriteSequence.batches[frame];
        ctx.setUniform('translation', item.position);
        ctx.setUniform('viewProj', rv.viewProj);
        ctx.draw(batch.va);
      }
    }
  }

  private drawMoveables(rv: RenderView) {
    let ctx = this.ctx;
    ctx.useProgram(rv.quadShader);
    ctx.setUniform('fogStartDensity', this.fogStart, this.fogDensity);
    for (let visibleRoom of rv.visibleRooms) {
      rv.updateTint(visibleRoom.room);
      for (let item of visibleRoom.moveables) {
        if (item.isSaveCrystal()) { continue; }
        this.setLighting(item);
        for (let idx of item.moveable.renderableMeshIndices) {
          let mesh = item.moveable.meshes[idx];
          this.drawBatches(
              rv,
              item.animState.meshTransforms[idx],
              item.intensity,
              mesh.quadBatches);
        }
      }
    }

    ctx.useProgram(rv.triShader);
    ctx.setUniform('fogStartDensity', this.fogStart, this.fogDensity);
    for (let visibleRoom of rv.visibleRooms) {
      rv.updateTint(visibleRoom.room);
      for (let item of visibleRoom.moveables) {
        if (item.isSaveCrystal()) { continue; }
        this.setLighting(item);
        for (let idx of item.moveable.renderableMeshIndices) {
          let mesh = item.moveable.meshes[idx];
          this.drawBatches(
              rv,
              item.animState.meshTransforms[idx],
              item.intensity,
              mesh.triBatches);
        }
      }
    }
  }

  private drawCrystals(rv: RenderView) {
    let ctx = this.ctx;
    ctx.useProgram(this.shaders.crystal);
    ctx.setUniform('fogStartDensity', this.fogStart, this.fogDensity);
    ctx.setUniform('tint', 0.3, 0.3, 2.0);
    ctx.setUniform('eyePos', rv.eyePos);
    for (let visibleRoom of rv.visibleRooms) {
      for (let item of visibleRoom.moveables) {
        if (!item.isSaveCrystal()) { continue; }
        let moveable = item.moveable;
        let animState = item.animState;
        for (let idx of moveable.renderableMeshIndices) {
          let mesh = moveable.meshes[idx];
          let world = animState.meshTransforms[idx];
          mat4.mul(this.worldViewProj, rv.viewProj, world);
          mat4.mul(this.worldView, rv.view, world);
          ctx.setUniform('worldView', this.worldView);
          ctx.setUniform('worldViewProj', this.worldViewProj);
          for (let batch of mesh.triBatches) { ctx.draw(batch.va); }
          for (let batch of mesh.quadBatches) { ctx.draw(batch.va); }
        }
      }
    }
  }

  private disableLighting() {
    let ctx = this.ctx;
    ctx.setUniform('ambient', 1.0);
    ctx.setUniform('lights', this.noLightsConstants);
  }

  private setLighting(item: Item) {
    let ctx = this.ctx;
    let room = item.room;

    let pos;
    if (item.animState != null) {
      let transform = item.animState.meshTransforms[0];
      pos = vec3.setFromValues(tmp, transform[12], transform[13], transform[14]);
    } else {
      pos = item.position;
    }

    ctx.setUniform('ambient', room.ambientIntensity);

    let x = 0;
    let y = 0;
    let z = 0;
    let LL = 0;

    let j = 0;
    for (let i = 0; i < room.lights.length; ++i) {
      let light = room.lights[i];
      let v = vec3.sub(tmp, light.position, pos);
      let length = vec3.length(v);
      if (length > 0) {
        vec3.scale(v, 1 / length, v);
      }
      let falloff = 1 - 0.5 * length / light.fade;
      let intensity = Math.min(2, Math.max(0, light.intensity * falloff));
      //let intensity = Math.min(1, light.intensity * light.fade / length);

      x += v[0] * intensity;
      y += v[1] * intensity;
      z += v[2] * intensity;
      LL += intensity;
      this.lightConstants[j++] = v[0];
      this.lightConstants[j++] = v[1];
      this.lightConstants[j++] = v[2];
      this.lightConstants[j++] = intensity;
    }
    while (j < this.lightConstants.length) {
      this.lightConstants[j++] = 0;
    }

    this.lightConstants.fill(0);
    if (LL > 0) {
      this.lightConstants[0] = x / LL;
      this.lightConstants[1] = y / LL;
      this.lightConstants[2] = z / LL;
      this.lightConstants[3] = LL;
    }

    ctx.setUniform('lights', this.lightConstants);
  }

  private updateCaustics(time: number, rooms: Room[]) {
    if (rooms.length == 0) {
      // Nothing to do.
      return;
    }

    let ctx = this.ctx;
    ctx.bindFramebuffer(this.lightFb);

    ctx.colorMask(true, true, true, false);
    ctx.depthMask(false);
    ctx.disable(GL.CULL_FACE);
    ctx.disable(GL.BLEND);
    ctx.disable(GL.DEPTH_TEST);

    // Update caustics for quad primitives.
    ctx.useProgram(this.shaders.causticsQuad);
    ctx.bindTexture('bakedLightTex', this.bakedLightTex);
    ctx.setUniform('time', time);
    for (let room of rooms) {
      for (let batch of room.quadBatches) {
        ctx.drawArrays(batch.va, GL.POINTS);
      }
    }

    // Update caustics for tri primitives.
    ctx.useProgram(this.shaders.causticsTri);
    ctx.bindTexture('bakedLightTex', this.bakedLightTex);
    ctx.setUniform('time', time);
    for (let room of rooms) {
      for (let batch of room.triBatches) {
        ctx.drawArrays(batch.va, GL.POINTS);
      }
    }

    ctx.enable(GL.CULL_FACE);

    ctx.bindFramebuffer(null);
  }

  private updateCubeMap(pos: vec3.Type, room: Room) {
    let ctx = this.ctx;

    this.cubeMap.setOrigin(pos);
    for (let face of this.cubeMap.faces) {
      let view = new RenderView(
          `cube[${face.name}]`, RenderView.STATIC, this.shaders.probeQuad, this.shaders.probeTri);
      view.fb = face.fb;
      mat4.setFromMat(view.view, face.view);
      mat4.setFromMat(view.proj, this.cubeMap.proj);
      mat4.setFromMat(view.viewProj, face.viewProj);
      vec3.setFromVec(view.eyePos, pos);

      view.visibleRooms = this.culler.cull(room, view.view, view.proj);
      this.drawRenderView(view);
    }
    for (let face of this.cubeMap.faces) {
      ctx.bindFramebuffer(face.fb);
      for (let i = 0; i < this.cubeMap.color.length; ++i) {
        ctx.readBuffer(GL.COLOR_ATTACHMENT0 + i);
        ctx.readPixels(0, 0, this.cubeMap.size, this.cubeMap.size, this.cubeMap.color[i].format,
                       this.cubeMap.color[i].type, face.pixels[i]);
      }
    }
    ctx.readBuffer(GL.NONE);
    ctx.bindFramebuffer(null);
  }

  private createProbeFieldForRoom(room: Room) {
    let pos = vec3.newZero();

    let field = new DebugProbeField(room);
    let ri = room.x / 1024;
    let rj = room.z / 1024;
    for (let j = 0; j < room.sectorTableHeight; ++j) {
      for (let i = 0; i < room.sectorTableWidth; ++i) {
        let sector = room.getSectorByGrid(ri + i, rj + j);
        pos[0] = room.x + i * 1024 + 512;
        pos[2] = room.z + j * 1024 + 512;

        let floorSector = sector.getResolvedFloorSector();
        let floor = 0.25 * (
            floorSector.getFloorVertexY(0, 0) +
            floorSector.getFloorVertexY(1, 0) +
            floorSector.getFloorVertexY(0, 1) +
            floorSector.getFloorVertexY(1, 1));

        let ceilingSector = sector.getResolvedCeilingSector();
        let ceiling = 0.25 * (
            ceilingSector.getCeilingVertexY(0, 0) +
            ceilingSector.getCeilingVertexY(1, 0) +
            ceilingSector.getCeilingVertexY(0, 1) +
            ceilingSector.getCeilingVertexY(1, 1));

        if (Math.abs(floor - ceiling) < 1) {
          continue;
        }

        // Figure out the light probe vertical spacing.

        // Highest probe is 1024 units below the ceiling.
        let start = ceiling + 1024;

        // Lowest probe is 384 units above the floor (roughly Lara's hip height).
        let end = floor - 384;

        if (start + 768 >= end) {
          // There's less than 768 units (Lara's height) between the highest
          // and lowest probe heights: only use one probe.
          if (start > end) {
            // For narrow gaps (e.g. shimmy cracks), place the probe at the
            // average of the ceiling and floor height.
            pos[1] = 0.5 * (ceiling + floor);
          } else {
            // For larger gaps (e.g. low rooms), place the probe at the average
            // of the  highest and lowest probe points.
            pos[1] = 0.5 * (start + end);
          }
          this.addProbe(field, room, i, j, pos);
        } else {
          // Normal case: add probes roughly every 2048 units.
          let numProbes = 1 + Math.max(1, Math.round((end - start) / 2048));
          for (let step = 0; step < numProbes; ++step) {
            pos[1] = start + (end - start) * step / (numProbes - 1);
            this.addProbe(field, room, i, j, pos);
          }
        }
      }
    }

    field.createVertexArray(this.ctx);

    return field;
  }

  private addProbe(field: ShProbeField, room: Room, i: number, j: number, pos: vec3.Type) {
    let sector = room.getSectorByPosition(pos).getResolvedSectorByPosition(pos);
    this.updateCubeMap(pos, sector.room);
    field.insertProbe(i, j, pos[1], this.cubeMap);
  }
}

