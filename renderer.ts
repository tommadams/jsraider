import * as icosphere from 'toybox/geom/icosphere';
import * as sh3 from 'toybox/math/sh3';
import * as mat4 from 'toybox/math/mat4';
import * as vec2 from 'toybox/math/vec2';
import * as vec3 from 'toybox/math/vec3';
import * as vec4 from 'toybox/math/vec4';

import {Mesh} from 'toybox/geom/mesh';

import {GL, TextureMinFilter} from 'toybox/gl/constants';
import {Context} from 'toybox/gl/context';
import {DynamicCubeMap} from 'toybox/gl/dynamic_cube_map';
import {DynamicDraw} from 'toybox/gl/dynamic_draw';
import {Framebuffer} from 'toybox/gl/framebuffer';
import {ShaderProgram} from 'toybox/gl/shader';
import {VertexArray} from 'toybox/gl/vertex_array';
import {getMagFilter, Texture2D, Texture2DDef} from 'toybox/gl/texture';

import {TweakObject} from 'toybox/app/tweaks';

// TODO(tom): decouple debug from Renderer
import * as debug from 'debug';
import * as hacks from 'hacks';

import {QuadBatch, TriBatch} from 'batch_builder';
import {Lara} from 'controllers/lara';
import {ProjectionShadow} from 'projection_shadow';
import {Item, Room, Scene} from 'scene';
import {Culler, VisibleRoom} from 'visibility';

import {projectIrradiance, ShProbeField} from 'sh_probe';

let tmp = vec3.newZero();

class RenderView {
  view = mat4.newZero();
  proj = mat4.newZero();
  viewProj = mat4.newZero();
  eyePos = vec3.newZero();
  fb: Framebuffer = null;
  visibleRooms: VisibleRoom[];
  tint = vec3.newZero();

  constructor(public name: string, public flags: number) {}

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

  createVertexArray(ctx: Context, room: Room) {
    let radius = 128;
    let reflectance = 0.8;

    let x = room.x + 512;
    let z = room.z + 512;
    let pos = vec3.newZero();
    let meshes: ColoredMesh[] = [];
    for (let j = 0; j < this.height; ++j) {
      pos[2] = z + j * 1024;
      for (let i = 0; i < this.width; ++i) {
        pos[0] = x + i * 1024;
        for (let probe of this.probes[i + j * this.width]) {
          pos[1] = probe.y;
          let mesh = this.createProbeMesh(pos, probe.sh, radius, reflectance);
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

  private createProbeMesh(pos: vec3.Type, sh: sh3.Type, radius: number, reflectance: number) {
    let sphere = icosphere.getMesh(2).clone();
    let colors: vec3.Type[] = [];
    for (let p of sphere.positions) {
      let col = vec3.newZero()
      sh3.reconstruct(col, sh, p);
      col[0] = Math.pow(Math.max(reflectance * col[0], 0), 1 / 2.2);
      col[1] = Math.pow(Math.max(reflectance * col[1], 0), 1 / 2.2);
      col[2] = Math.pow(Math.max(reflectance * col[2], 0), 1 / 2.2);
      colors.push(col);
      vec3.addScaled(p, pos, p, radius);
    }
    return new ColoredMesh(sphere.positions, colors, sphere.faceIndices);
  }
}

export class Renderer {
  ctx: Context;
  private scene_: Scene;
  private lara_: Lara;
  private fieldOfViewY_: number;
  private texAnimIndex_: number;

  private worldViewProj = mat4.newIdentity();
  private worldView = mat4.newIdentity();
  private identity = mat4.newIdentity();

  private culler_: Culler;

  private lightConstants_ = new Float32Array(16);
  private noLightsConstants_ = new Float32Array(16);

  private fogStart_ = 8192;
  private fogDensity_ = 0.00015;

  private bakedLightTex: Texture2D;
  private lightFb: Framebuffer;

  private shaders: {[key: string]: ShaderProgram};

  private tint_ = vec4.newFromValues(1, 1, 1, 1);

  private portalDraw_: DynamicDraw = null;

  private atlasTex: Texture2D;
  private shadow: ProjectionShadow;

  private reflectFb: Framebuffer;

  private cubeMap: DynamicCubeMap;

  private probeFields: DebugProbeField[] = [];

  constructor(ctx: Context, scene: Scene, lara: Lara) {
    this.ctx = ctx;
    this.scene_ = scene;
    this.lara_ = lara;
    this.fieldOfViewY_ = 60 * Math.PI / 180;
    this.texAnimIndex_ = 0;

    for (let room of scene.rooms) {
      this.probeFields.push(null);
    }

    this.culler_ = new Culler(scene.rooms, scene.items);

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

    this.reflectFb = ctx.newFramebuffer(
        {size: 256, format: GL.RGBA8, filter: GL.LINEAR},
        {size: 256, format: GL.DEPTH_COMPONENT16});

    this.cubeMap = new DynamicCubeMap(
        this.ctx, {size: 32, format: GL.RGBA8, filter: GL.NEAREST}, 8, 102400, true);

    this.shaders = {
      causticsQuad: ctx.newShaderProgram('shaders/caustics_quad.vs', 
                                         'shaders/caustics_quad.fs'),
      causticsTri: ctx.newShaderProgram('shaders/caustics_tri.vs', 
                                        'shaders/caustics_tri.fs'),
      copyTex: ctx.newShaderProgram('shaders/copy_tex.vs', 
                                    'shaders/copy_tex.fs'),
      quad: ctx.newShaderProgram('shaders/quad.vs', 'shaders/quad.fs'),
      tri: ctx.newShaderProgram('shaders/tri.vs', 'shaders/tri.fs'),
      sprite: ctx.newShaderProgram('shaders/sprite.vs', 'shaders/sprite.fs'),
      crystal: ctx.newShaderProgram('shaders/crystal.vs', 'shaders/crystal.fs'),
      probeReflect: ctx.newShaderProgram('shaders/probe_reflect.vs', 'shaders/probe_reflect.fs'),
      vertexColor: ctx.newShaderProgram('shaders/vertex_color.vs', 'shaders/vertex_color.fs'),
    };

    this.portalDraw_ = new DynamicDraw(ctx);
  }

  render(time: number, cameraTransform: mat4.Type, room: Room) {
    if (this.probeFields[room.id] == null) {
      this.probeFields[room.id] = this.createProbeFieldForRoom(room);
    }

    let ctx = this.ctx;

    // Update globals.
    // Animate textures at 6fps.
    this.texAnimIndex_ = Math.floor(time * 6);
    this.fogStart_ = debug.options.fogStart;
    this.fogDensity_ = debug.options.fogDensity / 1000;

    // TODO(tom): set these per RenderView
    let aspectRatio = ctx.canvas.width / ctx.canvas.height;
    let fov = this.fieldOfViewY_;

    let mainView = new RenderView('main', RenderView.ALL);
    mat4.invert(mainView.view, cameraTransform);
    mat4.getTranslation(mainView.eyePos, cameraTransform);
    mat4.setPerspective(mainView.proj, fov, aspectRatio, 8, 102400);
    mat4.mul(mainView.viewProj, mainView.proj, mainView.view);

    mainView.visibleRooms = this.culler_.cull(room, mainView.view, mainView.proj);

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
      let reflectView = new RenderView('crystal', RenderView.STATIC | RenderView.MOVEABLES);
      reflectView.fb = this.reflectFb;

      mat4.getTranslation(reflectView.eyePos, crystal.animState.meshTransforms[0]);
      mat4.setLookAt(reflectView.view, reflectView.eyePos, mainView.eyePos, vec3.newFromValues(0, -1, 0));
      mat4.setPerspective(reflectView.proj, 0.5 * Math.PI, 1, 8, 102400);
      mat4.mul(reflectView.viewProj, reflectView.proj, reflectView.view);
      reflectView.visibleRooms = this.culler_.cull(crystal.room, reflectView.view, reflectView.proj);
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
    let field = this.probeFields[this.lara_.item.room.id];
    if (field != null) {
      let sh = sh3.newZero();

      let hips = this.lara_.item.animState.meshTransforms[0];
      let R = 128;
      let P = vec3.newFromValues(hips[12], hips[13], hips[14]);
      field.sample(sh, P);

      let sphere = icosphere.getMesh(2).clone();
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
      debug.render(this.scene_, room, mainView.viewProj, mainView.visibleRooms);
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
    // ctx.gl.drawBuffers([GL.COLOR_ATTACHMENT0]);
    ctx.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT | GL.STENCIL_BUFFER_BIT);
    ctx.colorMask(true, true, true, false);
    ctx.depthFunc(GL.LEQUAL);
    this.drawScene(rv);
    ctx.disable(GL.SAMPLE_ALPHA_TO_COVERAGE);
  }

  private drawStencilPortals(room: Room, stencilValue: number, viewProj: mat4.Type) {
    let ctx = this.ctx;

    // Don't write to the depth or color buffers when drawing the stencil
    // mask.
    ctx.enable(GL.STENCIL_TEST);
    ctx.colorMask(false, false, false, false);
    ctx.depthMask(false);
    ctx.stencilMask(0xff);

    // Write the stencil value to all visible portal pixels.
    // TODO(tom): Use pre-baked vertex arrays rather dynamic draw.
    ctx.stencilFunc(GL.ALWAYS, stencilValue, 0xff);
    for (let portal of room.portals) {
      this.portalDraw_.polygon(portal.vertices, [0, 0, 0, 1]);
    }
    this.portalDraw_.flush(viewProj);

    // Reset the render state.
    ctx.colorMask(true, true, true, false);
    ctx.depthMask(true);
    ctx.stencilMask(0x00);

    // Only write to pixels whose stencil value matches the portal's.
    ctx.stencilFunc(GL.EQUAL, stencilValue, 0xff);
  }

  // TODO(tom): also need to draw moveables if their room neighbours a visible
  // room.
  private drawScene(rv: RenderView) {
    let ctx = this.ctx;

    // Some room meshes overlap each other. For those we apply stencil tests
    // when rendering. Replace the stencil value on z-pass only (used when
    // drawing the portals to set up the stencil test).
    ctx.stencilOp(GL.KEEP, GL.KEEP, GL.REPLACE);

    // Draw visible rooms.
    for (let visibleRoomIdx = 0; visibleRoomIdx < rv.visibleRooms.length; ++visibleRoomIdx) {
      let visibleRoom = rv.visibleRooms[visibleRoomIdx];
      let needStencilMask = (debug.options.stencilPortals && 
                             !visibleRoom.cameraInside &&
                             hacks.stencilRooms[visibleRoom.room.id]);

      if (needStencilMask) {
        // We can't use room.id because many levels have more than 256 rooms,
        // but there should always be 256 or fewer rooms visible at one time.
        this.drawStencilPortals(visibleRoom.room, visibleRoomIdx, rv.viewProj);
      }

      this.drawRoom(rv, visibleRoom, needStencilMask);
    }

    ctx.disable(GL.STENCIL_TEST);
  }

  private drawTriBatches(rv: RenderView, world: mat4.Type, intensity: number, batches: TriBatch[]) {
    let ctx = this.ctx;

    mat4.mul(this.worldViewProj, rv.viewProj, world);
    ctx.setUniform('world', world);
    ctx.setUniform('worldViewProj', this.worldViewProj);
    ctx.setUniform('tint', rv.tint[0] * intensity, rv.tint[1] * intensity, rv.tint[2] * intensity);

    for (let batch of batches) {
      if (batch.uvs.length > 1) {
        // Note: bindVertexBuffer only calls into GL if the vertex buffer is
        // different.
        let frame = this.texAnimIndex_ % batch.uvs.length;
        batch.va.bindVertexBuffer(batch.uvs[frame]);
      }
      // TODO(tom): check for WEBGL_multi_draw support and draw all batches with
      // a single call.
      ctx.draw(batch.va);
    }
  }

  private drawQuadBatches(rv: RenderView, world: mat4.Type, intensity: number, batches: QuadBatch[]) {
    let ctx = this.ctx;

    mat4.mul(this.worldViewProj, rv.viewProj, world);
    ctx.setUniform('world', world);
    ctx.setUniform('worldViewProj', this.worldViewProj);
    ctx.setUniform('tint', rv.tint[0] * intensity, rv.tint[1] * intensity, rv.tint[2] * intensity);

    for (let batch of batches) {
      if (batch.uvs.length > 1) {
        // Note: bindVertexBuffer only calls into GL if the vertex buffer is
        // different.
        let frame = this.texAnimIndex_ % batch.uvs.length;
        batch.va.bindVertexBuffer(batch.uvs[frame]);
      }
      // TODO(tom): check for WEBGL_multi_draw support and draw all batches with
      // a single call.
      ctx.draw(batch.va);
    }
  }

  private drawRoom(rv: RenderView, visibleRoom: VisibleRoom, stencilStaticMeshes: boolean) {
    let ctx = this.ctx;
    let room = visibleRoom.room;

    rv.updateTint(room);

    // Draw quad batches.
    ctx.useProgram(this.shaders.quad);
    ctx.setUniform('fogStartDensity', this.fogStart_, this.fogDensity_);
    ctx.bindTexture('tex', this.atlasTex);
    ctx.bindTexture('lightTex', this.lightFb.color[0]);
    ctx.setUniform('texSize', this.atlasTex.width, this.atlasTex.height);
    ctx.setUniform('lightTexSize', this.lightFb.width, this.lightFb.height);

    this.disableLighting();

    if (rv.flags & RenderView.STATIC) {
      if (stencilStaticMeshes) {
        ctx.enable(GL.STENCIL_TEST);
      }
      this.drawQuadBatches(rv, this.identity, 1, room.quadBatches);

      for (let i = 0; i < room.renderableStaticMeshes.length; ++i) {
        let roomStaticMesh = room.renderableStaticMeshes[i];
        let mesh = this.scene_.meshes[roomStaticMesh.staticMesh.mesh];
        this.drawQuadBatches(
            rv,
            roomStaticMesh.transform,
            roomStaticMesh.intensity,
            mesh.quadBatches);
      }

      // Don't perform stencil test for moveables because they can intersect portals.
      if (stencilStaticMeshes) {
        ctx.disable(GL.STENCIL_TEST);
      }
    }

    if (rv.flags & RenderView.MOVEABLES) {
      for (let item of visibleRoom.moveables) {
        // Save crystals are drawn with a special shader.
        if (item.isSaveCrystal()) { continue; }

        let animState = item.animState;

        this.setLighting(item);
        let moveable = item.moveable;
        for (let idx of moveable.renderableMeshIndices) {
          let mesh = moveable.meshes[idx];
          this.drawQuadBatches(
              rv,
              animState.meshTransforms[idx],
              item.intensity,
              mesh.quadBatches);
        }
      }
    }

    // Draw tri batches.
    ctx.useProgram(this.shaders.tri);
    ctx.setUniform('fogStartDensity', this.fogStart_, this.fogDensity_);
    ctx.bindTexture('tex', this.atlasTex);
    ctx.bindTexture('lightTex', this.lightFb.color[0]);
    ctx.setUniform('texSize', this.atlasTex.width, this.atlasTex.height);

    if (rv.flags & RenderView.STATIC) {
      this.disableLighting();

      if (stencilStaticMeshes) {
        ctx.enable(GL.STENCIL_TEST);
      }
      this.drawTriBatches(rv, this.identity, 1, room.triBatches);

      for (let i = 0; i < room.renderableStaticMeshes.length; ++i) {
        let roomStaticMesh = room.renderableStaticMeshes[i];
        let mesh = this.scene_.meshes[roomStaticMesh.staticMesh.mesh];
        this.drawTriBatches(
            rv,
            roomStaticMesh.transform,
            roomStaticMesh.intensity,
            mesh.triBatches);
      }

      // Don't perform stencil test for moveables because they can intersect portals.
      if (stencilStaticMeshes) {
        ctx.disable(GL.STENCIL_TEST);
      }
    }

    if (rv.flags & RenderView.MOVEABLES) {
      for (let item of visibleRoom.moveables) {
        // Save crystals are drawn with a spectial shader.
        if (item.isSaveCrystal()) { continue; }

        let animState = item.animState;

        this.setLighting(item);
        let moveable = item.moveable;
        for (let idx of moveable.renderableMeshIndices) {
          let mesh = moveable.meshes[idx];
          this.drawTriBatches(
              rv,
              animState.meshTransforms[idx],
              item.intensity,
              mesh.triBatches);
        }
      }
    }

    if (rv.flags & RenderView.CRYSTALS) {
      // Draw save crystals if any.
      ctx.useProgram(this.shaders.crystal);
      ctx.setUniform('fogStartDensity', this.fogStart_, this.fogDensity_);
      ctx.setUniform('tint', 0.3, 0.3, 2.0);
      ctx.bindTexture('tex', this.reflectFb.color[0]);
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

          for (let batch of mesh.triBatches) {
            ctx.draw(batch.va);
          }
          for (let batch of mesh.quadBatches) {
            ctx.draw(batch.va);
          }
        }
      }
    }

    if (rv.flags & RenderView.STATIC) {
      // Draw static sprite batch.
      ctx.useProgram(this.shaders.sprite);
      ctx.setUniform('fogStartDensity', this.fogStart_, this.fogDensity_);
      ctx.setUniform('eyePos', rv.eyePos);
      ctx.bindTexture('tex', this.atlasTex);
      ctx.setUniform('texSize', this.atlasTex.width, this.atlasTex.height);

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
        let frame = this.texAnimIndex_ % item.spriteSequence.batches.length;
        let batch = item.spriteSequence.batches[frame];
        ctx.setUniform('translation', item.position);
        ctx.setUniform('viewProj', rv.viewProj);
        ctx.draw(batch.va);
      }
    }
  }

  private disableLighting() {
    let ctx = this.ctx;
    ctx.setUniform('ambient', 1.0);
    ctx.setUniform('fogStartDensity', this.fogStart_, this.fogDensity_);
    ctx.setUniform('lights', this.noLightsConstants_);
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
      this.lightConstants_[j++] = v[0];
      this.lightConstants_[j++] = v[1];
      this.lightConstants_[j++] = v[2];
      this.lightConstants_[j++] = intensity;
    }
    while (j < this.lightConstants_.length) {
      this.lightConstants_[j++] = 0;
    }

    this.lightConstants_.fill(0);
    if (LL > 0) {
      this.lightConstants_[0] = x / LL;
      this.lightConstants_[1] = y / LL;
      this.lightConstants_[2] = z / LL;
      this.lightConstants_[3] = LL;
    }

    ctx.setUniform('lights', this.lightConstants_);
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
    ctx.bindTexture('lightTex', this.bakedLightTex);
    ctx.setUniform(
        'lightTexSize', this.bakedLightTex.width, this.bakedLightTex.height);
    ctx.setUniform('time', time);
    for (let room of rooms) {
      for (let batch of room.quadBatches) {
        ctx.drawArrays(batch.va, GL.POINTS);
      }
    }

    // Update caustics for tri primitives.
    ctx.useProgram(this.shaders.causticsTri);
    ctx.bindTexture('lightTex', this.bakedLightTex);
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
      let view = new RenderView(`cube[${face.name}]`, RenderView.STATIC);
      view.fb = face.fb;
      mat4.setFromMat(view.view, face.view);
      mat4.setFromMat(view.proj, this.cubeMap.proj);
      mat4.setFromMat(view.viewProj, face.viewProj);
      vec3.setFromVec(view.eyePos, pos);

      view.visibleRooms = this.culler_.cull(room, view.view, view.proj);
      this.drawRenderView(view);
    }
    for (let face of this.cubeMap.faces) {
      ctx.bindFramebuffer(face.fb);
      ctx.readBuffer(GL.COLOR_ATTACHMENT0);
      ctx.readPixels(0, 0, this.cubeMap.size, this.cubeMap.size, this.cubeMap.color.format,
                     this.cubeMap.color.type, face.pixels);
    }
    ctx.readBuffer(GL.NONE);
    ctx.bindFramebuffer(null);
  }

  private createProbeFieldForRoom(room: Room) {
    let pos = vec3.newZero();

    let field = new DebugProbeField(room.x, room.z, 1024, room.sectorTableWidth, room.sectorTableHeight);
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
          let numProbes = 1 + Math.max(1, Math.floor((end - start) / 2048));
          for (let step = 0; step < numProbes; ++step) {
            pos[1] = start + (end - start) * step / (numProbes - 1);
            this.addProbe(field, room, i, j, pos);
          }
        }
      }
    }

    field.createVertexArray(this.ctx, room);

    return field;
  }

  private addProbe(field: ShProbeField, room: Room, i: number, j: number, pos: vec3.Type) {
    let sector = room.getSectorByPosition(pos).getResolvedSectorByPosition(pos);
    this.updateCubeMap(pos, sector.room);
    let probe = field.insertProbe(i, j, pos[1]);
    projectIrradiance(probe.sh, this.cubeMap);
  }
}

