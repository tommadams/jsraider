import * as app from 'toybox/app/app';
import * as input from 'toybox/app/input';
import * as mat4 from 'toybox/math/mat4';
import * as vec3 from 'toybox/math/vec3';

import * as audio from 'audio';
import * as debug from 'debug';
import * as hacks from 'hacks';

import {Animation} from 'animation';
import {Camera} from 'camera';
import {resolveRoomByPosition} from 'collision';
import {LaraBone, LocomotionType} from 'controllers/lara';
import {FollowCamera} from 'follow_camera';
import {FlyCamera} from 'fly_camera';
import {Renderer} from 'renderer';
import {Scene} from 'scene';


///  console.log('Offset objects depth a little to prevent z-fighting on some objects');

class JsRaiderApp extends app.App {
  private level: string;
  private paused = false;
  private scene: Scene = null;
  private wasUpdating = false;

  private followCamera: FollowCamera = null;
  private flyCamera: FlyCamera = null;

  private baseTime = 0;
  private time = 0;
  private activeCamera: Camera = null;
  private renderer: Renderer = null;

  constructor(level: string) {
    super('canvas', {
      antialias: true,
      depth: true,
      stencil: true,
      preserveDrawingBuffer: true,  // required to support taking screenshots
      requiredExtensions: [
        'EXT_texture_filter_anisotropic',
      ],
      profileHud: 'profile-hud',
    });

    this.ctx.canvas.style.imageRendering = 'pixelated';

    debug.init(this.ctx).onChange(() => {
      if (!this.updating) {
        this.renderImpl();
      }
    });

    this.level = level;

    // TODO(tom): use toybox/util/http
    let req = new XMLHttpRequest();
    req.open('GET', 'levels/' + this.level, true);
    req.responseType = 'arraybuffer';
    req.onload = () => {
      if (req.status != 200) {
        throw new Error(
             'Failed to load "' + req.responseURL + '" : (' +
              req.status + ') ' + req.statusText);
      }
      this.loadLevel(req.response);
      this.ctx.init();
    };
    req.send(null);

    input.enable();
  }

  protected onInit() {
    this.initInputHandlers();
    this.updating = true;
    this.ctx.canvas.focus();
    debug.options.entityInfo =
        this.scene.controllers.indexOf(this.scene.lara).toString();
  }

  private loadLevel(buf: ArrayBuffer) {
    this.scene = new Scene(this.level, buf, this.ctx);
  
    hacks.applyPostInitHacks(this.level, this.scene);
  
    audio.init(
        this.scene.soundMap,
        this.scene.soundDetails,
        this.scene.samples,
        this.scene.sampleIndices);
  
    this.initCamera();
  
    this.renderer = new Renderer(this.ctx, this.scene, this.scene.lara);
  }

  protected updateImpl(time: number) {
    // TODO(tom): proper time handling and what updateWrapper_ does
    let dt = 1 / 60;
    let dtCamera = dt;
    if (debug.options.slowMotion) {
      dt /= 5;
    }

    this.time += dt * 1000;

    let lara = this.scene.lara;
    if (this.updating) {
      if (this.paused && this.activeCamera == this.flyCamera) {
        this.updateFlyCamera_(dtCamera);
      }
      let position = vec3.newZero();
      let room = resolveRoomByPosition(lara.item.room, position);
      if (lara.locomotionType == LocomotionType.TREAD_WATER) {
        vec3.setFromValues(this.followCamera.lookAtOffset, 128, -512, 512);
        vec3.setFromValues(this.followCamera.positionOffset, 128, -640, -512);
      } else {
        vec3.setFromValues(this.followCamera.lookAtOffset, 128, -128, 1024);
        vec3.setFromValues(this.followCamera.positionOffset, 128, -256, -2048);
      }
      this.followCamera.update();
    }
  
    audio.setListenerTransform(this.activeCamera.getTransform());
  
    if (!this.paused) {
      // TODO(tom): maintain a list of active controllers
      for (let controller of this.scene.controllers) {
        if (controller != null && controller.item.active) {
          controller.update(dt);
        }
      }
    }
  
    if (input.keyPressed(input.KeyCodes.T) &&
        this.activeCamera == this.flyCamera) {
      vec3.setFromVec(lara.item.position, this.flyCamera.position);
      vec3.setFromValues(lara.item.rotation, 0, Math.PI + this.flyCamera.rotation[1], 0);
      lara.item.room = this.flyCamera.room;
      (lara as any).sector = lara.item.room.getSectorByPosition(lara.item.position);
      this.activeCamera = this.followCamera;

      let animState = lara.item.animState;
      animState.updateTransform(lara.item.position, lara.item.rotation);
      animState.anim.getFrame(
          animState.frameIdx, animState.frameOfs, animState.frame);
      animState.setMeshTransforms(
          lara.item.moveable.meshCount, lara.item.moveable.meshTree,
          this.scene.meshTrees);
    }

    if (input.keyPressed(input.KeyCodes.ESC)) {
      if (this.activeCamera == this.flyCamera) {
        this.activeCamera = this.followCamera;
      } else {
        input.reset();
        this.updating = false;
      }
    }
    if (input.keyPressed(input.KeyCodes.P)) {
      window.open().document.write(`<img src="${this.ctx.canvas.toDataURL()}"/>`);
    }
  
    input.flush();
  }

  protected renderImpl() {
    let room = this.activeCamera.getRoom();
    if (room == null) {
      throw new Error('Active camera\'s room is null');
    }
    this.renderer.render(
        this.time / 1000, this.activeCamera.getTransform(), room);
  }

  private initInputHandlers() {
    let canvas = this.ctx.canvas;
    canvas.onclick = () => {
      if (!this.updating) {
        this.updating = true;
      } else {
        if (this.paused) {
          document.exitPointerLock();
        } else if (this.updating) {
          canvas.requestPointerLock();
        }
      }
    };

    document.addEventListener(
        'pointerlockchange', this.onPointerLockChange.bind(this));
    canvas.addEventListener('blur', () => {
      this.updating = false;
      input.reset();
    });

    // Hide the mouse cursor when controlling Lara.
    document.addEventListener('keydown', () => {
      if (document.activeElement == this.ctx.canvas) {
        this.ctx.canvas.style.cursor = 'none';
      }
    });

    // Reshow the cursor on move.
    document.addEventListener('mousemove', () => {
      this.ctx.canvas.style.cursor = null;
    });
  }

  private initCamera() {
    let lara = this.scene.lara;
    let lookAtOffset = vec3.newFromValues(128, -128, 1024);
    let positionOffset = vec3.newFromValues(128, -256, -2048);
  
    // Update Lara's mesh transforms so that the follow camera can be initialized
    // with a valid target position.
    let item = this.scene.lara.item;
    let animState = item.animState;
    animState.updateTransform(item.position, item.rotation);
    if (animState != null) {
      animState.anim.getFrame(
          animState.frameIdx, animState.frameOfs, animState.frame);
      animState.setMeshTransforms(
          item.moveable.meshCount, item.moveable.meshTree, this.scene.meshTrees);
    }
    let position = vec3.newZero();
    mat4.getTranslation(position, animState.meshTransforms[LaraBone.PELVIS]);
  
    this.followCamera = new FollowCamera(
        lara.item, LaraBone.PELVIS, lookAtOffset, positionOffset);
    this.activeCamera = this.followCamera;
  }
  
  private updateFlyCamera_(dt: number) {
    let dr = vec3.newFromValues(-input.mouseDy * 0.01, input.mouseDx * 0.01, 0);
    let dp = vec3.newZero();
  
    let speed = 7680 * dt;
    if (input.keyDown(input.KeyCodes.SHIFT)) {
      speed = 1920 * dt;
    }
  
    if (input.keyDown(input.KeyCodes.A)) { dp[0] -= 1; }
    if (input.keyDown(input.KeyCodes.D)) { dp[0] += 1; }
    if (input.keyDown(input.KeyCodes.F)) { dp[1] -= 1; }
    if (input.keyDown(input.KeyCodes.R)) { dp[1] += 1; }
    if (input.keyDown(input.KeyCodes.W)) { dp[2] -= 1; }
    if (input.keyDown(input.KeyCodes.S)) { dp[2] += 1; }
    vec3.scale(dp, speed, dp);
  
    this.flyCamera.update(dp, dr);
  }

  // TODO(tom): Move pointer lock code into input library
  private onPointerLockChange() {
    let lara = this.scene.lara;
    if (document['pointerLockElement'] == this.ctx.canvas) {
      this.paused = true;
      if (this.activeCamera == this.followCamera) {
        // let position = vec3.newFromValues(45259.26171875, -3428.07177734375, 65690.453125);
        // let rotation = vec3.newFromValues(0.8299996852874756, 7.0208353996276855, 3.1415927410125732);
        // let room = this.scene.rooms[99];
        // this.flyCamera = new FlyCamera(room, position, rotation);

        this.flyCamera = new FlyCamera(
            this.followCamera.room,
            this.followCamera.position,
            new Float32Array([0, Math.PI + lara.item.rotation[1], Math.PI]));

        this.activeCamera = this.flyCamera;
      }
    } else {
      this.paused = false;
    }
  }
}

// TODO(tom): Move this into toybox.
interface UriArgs {
  [key: string]: any;
}
let args: UriArgs = {};

for (let arg of window.location.search.substring(1).split('&')) {
  let p = arg.split('=');
  let name = decodeURIComponent(p[0]);
  let value = p.length == 1 ? '' : decodeURIComponent(p[1]);
  args[name] = value;
}

// Make the app accessible from the console for debugging purposes.
(window as any).app = new JsRaiderApp(args.level);
