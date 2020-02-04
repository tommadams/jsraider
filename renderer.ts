import * as mat4 from 'toybox/math/mat4';
import * as vec2 from 'toybox/math/vec2';
import * as vec3 from 'toybox/math/vec3';
import * as vec4 from 'toybox/math/vec4';

import {GL, TextureMinFilter} from 'toybox/gl/constants';
import {Context} from 'toybox/gl/context';
import {DynamicDraw} from 'toybox/gl/dynamic_draw';
import {Framebuffer} from 'toybox/gl/framebuffer';
import {ShaderProgram} from 'toybox/gl/shader';
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

let tmp = vec3.newZero();

export class Renderer {
  ctx: Context;
  private scene_: Scene;
  private lara_: Lara;
  private fieldOfViewY_: number;
  private texAnimIndex_: number;

  private eyePos_ = vec3.newZero();
  private identity_ = mat4.newIdentity();
  private view_ = mat4.newZero();
  private proj_ = mat4.newZero();
  private viewProj_ = mat4.newZero();
  private worldViewProj_ = mat4.newZero();

  private prevViewProj_ = mat4.newZero();
  private prevWorldViewProj_ = mat4.newZero();

  private culler_: Culler;

  private lightConstants_ = new Float32Array(16);
  private noLightsConstants_ = new Float32Array(16);

  private fogStart_ = 8192;
  private fogDensity_ = 0.00015;
  private gamma_ = 0.85;

  private bakedLightTex: Texture2D;
  private lightFb_: Framebuffer;

  private shaders: {[key: string]: ShaderProgram};

  private cameraUnderwater_ = false;
  private tint_ = vec4.newFromValues(1, 1, 1, 1);

  private portalDraw_: DynamicDraw = null;

  private atlasTex: Texture2D;
  private shadow: ProjectionShadow;

  constructor(ctx: Context, scene: Scene, lara: Lara) {
    this.ctx = ctx;
    this.scene_ = scene;
    this.lara_ = lara;
    this.fieldOfViewY_ = 60 * Math.PI / 180;
    this.texAnimIndex_ = 0;

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

    // // Color texture.
    // let colorTex = new toybox.Texture(ctx);
    // colorTex.initialize(
    //     ctx.canvas.width, ctx.canvas.height, null,
    //     {filter: GL.NEAREST,
    //      format: GL.RGBA,
    //      type: GL.UNSIGNED_BYTE,
    //      wrap: GL.CLAMP_TO_EDGE});

    // // Depth texture.
    // let depthTex = new toybox.Texture(ctx);
    // depthTex.initializeDepth(ctx.canvas.width, ctx.canvas.height);

    // Velocity texture.
    // // TODO(tom): Use an UNSIGNED_BYTE texture instead.
    // let velocityTex = new toybox.Texture(ctx);
    // velocityTex.initialize(
    //     ctx.canvas.width, ctx.canvas.height, null,
    //     {filter: GL.NEAREST,
    //      format: GL.RGBA,
    //      type: GL.HALF_FLOAT_OES,
    //      wrap: GL.CLAMP_TO_EDGE});

    // // Temporal antialiasing textures.
    // this.aaTexs_ = [new toybox.Texture(ctx), new toybox.Texture(ctx)];
    // for (let i = 0; i < 2; ++i) {
    //   this.aaTexs_[i].initialize(
    //       ctx.canvas.width, ctx.canvas.height, null,
    //       {filter: GL.LINEAR,
    //        format: GL.RGBA,
    //        type: GL.HALF_FLOAT_OES,
    //        wrap: GL.CLAMP_TO_EDGE});
    // }

    // Frame buffers.
    // this.sceneFb_ = new toybox.FrameBuffer(ctx, colorTex, depthTex);
    // this.velocityFb_ = new toybox.FrameBuffer(ctx, velocityTex, depthTex);
    // this.resolveFb_ = new toybox.FrameBuffer(ctx, this.aaTexs_[0], null);

    let lightTexDef: Texture2DDef = {
      width: scene.lightTex.width,
      height: scene.lightTex.height,
      data: scene.lightTex.data,
      filter: GL.LINEAR,
      wrap: GL.CLAMP_TO_EDGE,
      format: GL.RGBA8,
    };
    this.bakedLightTex = ctx.newTexture2D(lightTexDef);
    this.lightFb_ = ctx.newFramebuffer(lightTexDef);

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
    };

    this.portalDraw_ = new DynamicDraw(ctx);
  }

  render(time: number, cameraTransform: mat4.Type, room: Room) {
    let ctx = this.ctx;

    this.fogStart_ = debug.options.fogStart;
    this.fogDensity_ = debug.options.fogDensity / 1000;

    let aspectRatio = ctx.canvas.width / ctx.canvas.height;
  
    // Animate textures at 6fps.
    this.texAnimIndex_ = Math.floor(time * 6);
  
    this.cameraUnderwater_ = room.isUnderwater();
    mat4.invert(this.view_, cameraTransform);
    mat4.getTranslation(this.eyePos_, cameraTransform);
    mat4.setPerspective(this.proj_, this.fieldOfViewY_, aspectRatio, 8, 102400);

    mat4.setFromMat(this.prevViewProj_, this.viewProj_);
    mat4.mul(this.viewProj_, this.proj_, this.view_);
  
    // TODO(tom): support disabling culling again
    let visibleRooms = this.culler_.cull(room, this.view_, this.proj_);
    // let visibleRooms;
    // if (!debug.enabled('culling')) {
    //   visibleRooms = this.culler_.setAllVisible();
    // } else {
    //   visibleRooms = this.culler_.cull(
    //       this.fieldOfViewY_, aspectRatio, room, this.view_, this.proj_);
    // }
  
    ctx.profile('caustics', () => {
      this.updateCaustics(time, visibleRooms);
    });
  
    ctx.profile('main', () => {
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
      ctx.bindFramebuffer(null);
      ctx.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT | GL.STENCIL_BUFFER_BIT);
      ctx.colorMask(true, true, true, false);
      ctx.depthFunc(GL.LEQUAL);
      this.drawScene(visibleRooms);
      ctx.disable(GL.SAMPLE_ALPHA_TO_COVERAGE);
    });

    ctx.profile('shadow', () => {
      this.shadow.draw(this.viewProj_);
    });
  
    ctx.profile('debug', () => {
      // TODO(tom): call this from the main app, not the renderer internals, then
      // remove Lara and possible other dependencies.
      debug.render(
          this.lara_, room, this.scene_.rooms, this.viewProj_, visibleRooms);
    });
  }

  private drawStencilPortals(room: Room, stencilValue: number) {
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
    this.portalDraw_.flush(this.viewProj_);

    // Reset the render state.
    ctx.colorMask(true, true, true, false);
    ctx.depthMask(true);
    ctx.stencilMask(0x00);

    // Only write to pixels whose stencil value matches the portal's.
    ctx.stencilFunc(GL.EQUAL, stencilValue, 0xff);
  }

  // TODO(tom): also need to draw moveables if their room neighbors a visible
  // room.
  private drawScene(visibleRooms: VisibleRoom[]) {
    let ctx = this.ctx;
  
    // Some room meshes overlap each other. For those we apply stencil tests
    // when rendering. Replace the stencil value on z-pass only (used when
    // drawing the portals to set up the stencil test).
    ctx.stencilOp(GL.KEEP, GL.KEEP, GL.REPLACE);
  
    // Draw visible rooms.
    for (let visibleRoomIdx = 0; visibleRoomIdx < visibleRooms.length; ++visibleRoomIdx) {
      let visibleRoom = visibleRooms[visibleRoomIdx];
      let needStencilMask = (debug.options.stencilPortals && 
                             !visibleRoom.cameraInside &&
                             hacks.stencilRooms[visibleRoom.room.id]);
    
      if (needStencilMask) {
        // We can't use room.id because many levels have more than 256 rooms,
        // but there should always be 256 or fewer rooms visible at one time.
        this.drawStencilPortals(visibleRoom.room, visibleRoomIdx);
      }

      this.drawRoom(visibleRoom, needStencilMask);
    }
  }

  private drawTriBatches_(world: mat4.Type, tint: vec4.Type, batches: TriBatch[]) {
    let ctx = this.ctx;
  
    mat4.mul(this.worldViewProj_, this.viewProj_, world);
    ctx.setUniform('world', world);
    ctx.setUniform('worldViewProj', this.worldViewProj_);
    ctx.setUniform('tint', tint);
  
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
  
  private drawQuadBatches_(world: mat4.Type, tint: vec4.Type, batches: QuadBatch[]) {
    let ctx = this.ctx;
  
    mat4.mul(this.worldViewProj_, this.viewProj_, world);
    ctx.setUniform('world', world);
    ctx.setUniform('worldViewProj', this.worldViewProj_);
    ctx.setUniform('tint', tint);
  
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
  
  private drawRoom(visibleRoom: VisibleRoom, stencilStaticMeshes: boolean) {
    let ctx = this.ctx;
    let room = visibleRoom.room;
  
    // Draw quad batches.
    ctx.useProgram(this.shaders.quad);
    ctx.setUniform('fogStartDensity', this.fogStart_, this.fogDensity_);
    ctx.setUniform('gamma', this.gamma_);
    ctx.bindTexture('tex', this.atlasTex);
    ctx.bindTexture('lightTex', this.lightFb_.color[0]);
    ctx.setUniform('texSize', this.atlasTex.width, this.atlasTex.height);
    ctx.setUniform('lightTexSize', this.lightFb_.width, this.lightFb_.height);
  
    this.disableLighting_();
  
    if (stencilStaticMeshes) {
      ctx.enable(GL.STENCIL_TEST);
    }
    this.drawQuadBatches_(this.identity_, this.getTint(room, 1), room.quadBatches);
  
    for (let i = 0; i < room.renderableStaticMeshes.length; ++i) {
      let roomStaticMesh = room.renderableStaticMeshes[i];
      let mesh = this.scene_.meshes[roomStaticMesh.staticMesh.mesh];
      this.drawQuadBatches_(
          roomStaticMesh.transform,
          this.getTint(room, roomStaticMesh.intensity),
          mesh.quadBatches);
    }

    // Don't perform stencil test for moveables because they can intersect portals.
    if (stencilStaticMeshes) {
      ctx.disable(GL.STENCIL_TEST);
    }
    let moveables = visibleRoom.moveables;
    for (let item of moveables) {
      let animState = item.animState;
  
      this.setLighting_(item);
      let moveable = item.moveable;
      for (let meshIdx of moveable.renderableMeshIndices) {
        let mesh = moveable.meshes[meshIdx];
        this.drawQuadBatches_(
            animState.meshTransforms[meshIdx],
            this.getTint(room, item.intensity),
            mesh.quadBatches);
      }
    }
  
    // Draw tri batches.
    ctx.useProgram(this.shaders.tri);
    ctx.setUniform('fogStartDensity', this.fogStart_, this.fogDensity_);
    ctx.setUniform('gamma', this.gamma_);
    ctx.bindTexture('tex', this.atlasTex);
    ctx.bindTexture('lightTex', this.lightFb_.color[0]);
    ctx.setUniform('texSize', this.atlasTex.width, this.atlasTex.height);
  
    this.disableLighting_();

    if (stencilStaticMeshes) {
      ctx.enable(GL.STENCIL_TEST);
    }
    this.drawTriBatches_(this.identity_, this.getTint(room, 1), room.triBatches);
  
    for (let i = 0; i < room.renderableStaticMeshes.length; ++i) {
      let roomStaticMesh = room.renderableStaticMeshes[i];
      let mesh = this.scene_.meshes[roomStaticMesh.staticMesh.mesh];
      this.drawTriBatches_(
          roomStaticMesh.transform,
          this.getTint(room, roomStaticMesh.intensity),
          mesh.triBatches);
    }

    // Don't perform stencil test for moveables because they can intersect portals.
    if (stencilStaticMeshes) {
      ctx.disable(GL.STENCIL_TEST);
    }
    for (let item of moveables) {
      let animState = item.animState;
  
      this.setLighting_(item);
      let moveable = item.moveable;
      for (let meshIdx of moveable.renderableMeshIndices) {
        let mesh = moveable.meshes[meshIdx];
        this.drawTriBatches_(
            animState.meshTransforms[meshIdx],
            this.getTint(room, item.intensity),
            mesh.triBatches);
      }
    }
  
    // Draw static sprite batch.
    ctx.useProgram(this.shaders.sprite);
    ctx.setUniform('fogStartDensity', this.fogStart_, this.fogDensity_);
    ctx.setUniform('gamma', this.gamma_);
    ctx.setUniform('eyePos', this.eyePos_);
    ctx.bindTexture('tex', this.atlasTex);
    ctx.setUniform('texSize', this.atlasTex.width, this.atlasTex.height);
  
    let sb = visibleRoom.room.spriteBatch;
    if (sb != null) {
      ctx.setUniform('translation', 0, 0, 0);
      ctx.setUniform('viewProj', this.viewProj_);
      ctx.draw(sb.va);
    }
  
    // Draw sprite sequences
    for (let item of visibleRoom.spriteSequences) {
      // TODO(tom): do we really need to create a new VertexArray for each frame?
      let frame = this.texAnimIndex_ % item.spriteSequence.batches.length;
      let batch = item.spriteSequence.batches[frame];
      ctx.setUniform('translation', item.position);
      ctx.setUniform('viewProj', this.viewProj_);
      ctx.draw(batch.va);
    }
  }

  private disableLighting_() {
    let ctx = this.ctx;
    ctx.setUniform('ambient', 1.0);
    ctx.setUniform('fogStartDensity', this.fogStart_, this.fogDensity_);
    ctx.setUniform('lights', this.noLightsConstants_);
  }
  
  private setLighting_(item: Item) {
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

  private updateCaustics(time: number, visibleRooms: VisibleRoom[]) {
    // Find all the visible rooms that are underwater.
    let underwaterRooms = [];
    for (let visibleRoom of visibleRooms) {
      if (visibleRoom.room.isUnderwater()) {
        underwaterRooms.push(visibleRoom.room);
      }
    }
    if (underwaterRooms.length == 0) {
      // Nothing to do.
      return;
    }
  
    let ctx = this.ctx;
    ctx.bindFramebuffer(this.lightFb_);
  
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
    for (let room of underwaterRooms) {
      for (let batch of room.quadBatches) {
        ctx.drawArrays(batch.va, GL.POINTS);
      }
    }
  
    // Update caustics for tri primitives.
    ctx.useProgram(this.shaders.causticsTri);
    ctx.bindTexture('lightTex', this.bakedLightTex);
    ctx.setUniform('time', time);
    for (let room of underwaterRooms) {
      for (let batch of room.triBatches) {
        ctx.drawArrays(batch.va, GL.POINTS);
      }
    }

    ctx.enable(GL.CULL_FACE);
  
    ctx.bindFramebuffer(null);
  }

  private getTint(room: Room, lighting: number) {
    if (this.cameraUnderwater_ || room.isUnderwater()) {
      this.tint_[0] = 0.5 * lighting;
      this.tint_[1] = lighting;
      this.tint_[2] = lighting;
    } else {
      this.tint_[0] = lighting;
      this.tint_[1] = lighting;
      this.tint_[2] = lighting;
    }
    return this.tint_;
  }
}

