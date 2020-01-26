import * as app from 'toybox/app/app';
import * as input from 'toybox/app/input';
import * as mat4 from 'toybox/math/mat4';
import * as vec3 from 'toybox/math/vec3';

import * as audio from 'audio';
import * as debug from 'debug';
import * as hacks from 'hacks';

import {Animation} from 'animation';
import {Block} from 'block';
import {Camera} from 'camera';
import {resolveRoomByPosition} from 'collision';
import {Controller} from 'controller';
import {FollowCamera} from 'follow_camera';
import {FlyCamera} from 'fly_camera';
import {Lara, LaraBone, LocomotionType} from 'lara';
import {Renderer} from 'renderer';
import {ItemType, Scene} from 'scene';

console.log('SIGH THE HARP STRING TEXTURE IS WRONG ON ONE SIDE');
console.log('SIGH THE HARP STRING TEXTURE IS WRONG ON ONE SIDE');
console.log('SIGH THE HARP STRING TEXTURE IS WRONG ON ONE SIDE');
console.log('SIGH THE HARP STRING TEXTURE IS WRONG ON ONE SIDE');

console.log('REPEATEDLY CLIMBING OUT OF LARA\'S POOL AND HOPPING BACK BREAKS THE CLIMB OUT');
console.log('REPEATEDLY CLIMBING OUT OF LARA\'S POOL AND HOPPING BACK BREAKS THE CLIMB OUT');
console.log('REPEATEDLY CLIMBING OUT OF LARA\'S POOL AND HOPPING BACK BREAKS THE CLIMB OUT');
console.log('REPEATEDLY CLIMBING OUT OF LARA\'S POOL AND HOPPING BACK BREAKS THE CLIMB OUT');

console.log('SWIMMING IN LEVEL02 CRASHES BECAUSE OF SECTORING');
console.log('SWIMMING IN LEVEL02 CRASHES BECAUSE OF SECTORING');
console.log('SWIMMING IN LEVEL02 CRASHES BECAUSE OF SECTORING');
console.log('SWIMMING IN LEVEL02 CRASHES BECAUSE OF SECTORING');

class JsRaiderApp extends app.App {
    private level: string;
    private paused = false;
    private scene: Scene = null;
    private wasUpdating = false;

    private controllers: Controller[] = [];
    private lara: Lara = null;
    private followCamera: FollowCamera = null;
    private flyCamera: FlyCamera = null;

    private baseTime = 0;
    private time = 0;
    private animatedTextureDelay_ = 0;
    private activeCamera: Camera = null;
    private debugAnim = -1;
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

      // TypeScript 3.4.5 CSSStyleDeclaration doesn't know about image-rendering.
      (this.ctx.canvas.style as any)['imageRendering'] = 'pixelated';

      debug.init(this.ctx);

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

    onInit() {
      this.initInputHandlers();
      this.updating = true;
    }

    loadLevel(buf: ArrayBuffer) {
      this.scene = new Scene(this.level, buf, this.ctx);
    
      for (let item of this.scene.items) {
        if (item.animState == null) {
          continue;
        }
        item.animState.anim.getFrame(
            item.animState.frameIdx, item.animState.frameOfs, item.animState.frame);
        item.animState.setMeshTransforms(
            item.moveable.meshCount, item.moveable.meshTree, this.scene.meshTrees);
        switch (item.id) {
          case ItemType.LARA:
            this.lara = new Lara(item, this.scene);
            this.controllers.push(this.lara);
            break;
    
          case ItemType.BLOCK_1:
          case ItemType.BLOCK_2:
            this.controllers.push(new Block(item, this.scene));
            break;
    
          default:
            this.controllers.push(new Controller(item, this.scene));
            break;
        }
      }
    
      if (this.lara == null) {
        throw 'Couldn\'t find Lara :(';
      }
    
      hacks.applyPostInitHacks(this.level, this.scene);
    
      audio.init(
          this.scene.soundMap,
          this.scene.soundDetails,
          this.scene.samples,
          this.scene.sampleIndices);
    
      this.initCamera();
    
      this.renderer = new Renderer(this.ctx, this.scene, this.lara);
    }

    updateImpl(time: number) {
      // TODO(tom): proper time handling and what updateWrapper_ does
      let dt = 1 / 60;
      let dtCamera = dt;
      if (debug.options.slowMotion) {
        dt /= 5;
      }

      this.time += dt * 1000;

      if (this.updating) {
        if (this.paused && this.activeCamera == this.flyCamera) {
          this.updateFlyCamera_(dtCamera);
        }
        let position = vec3.newZero();
        let room = resolveRoomByPosition(this.lara.item.room, position);
        if (this.lara.locomotionType == LocomotionType.TREAD_WATER) {
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
        for (let controller of this.controllers) {
          controller.update(dt);
        }
      }
    
      if (input.keyPressed(input.KeyCodes.ESC)) {
        if (this.activeCamera == this.flyCamera) {
          this.activeCamera = this.followCamera;
        } else {
          input.reset();
          this.updating = false;
        }
      }
      if (input.keyPressed(input.KeyCodes.ENTER)) {
        this.nextAnim();
      }
      if (input.keyPressed(input.KeyCodes.P)) {
        window.open().document.write(`<img src="${this.ctx.canvas.toDataURL()}"/>`);
      }
    
      input.flush();
    }

    renderImpl() {
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
      window.addEventListener('blur', () => { this.updating = false; });
      canvas.addEventListener('blur', () => { this.updating = false; });

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
      let lookAtOffset = vec3.newFromValues(128, -128, 1024);
      let positionOffset = vec3.newFromValues(128, -256, -2048);
    
      // Update Lara's mesh transforms so that the follow camera can be initialized
      // with a valid target position.
      let item = this.lara.item;
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
          this.lara.item, LaraBone.PELVIS, lookAtOffset, positionOffset);
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
              new Float32Array([0, Math.PI + this.lara.item.rotation[1], Math.PI]));

          this.activeCamera = this.flyCamera;
        }
      } else {
        this.paused = false;
      }
    }
    
    
    private nextAnim() {
      this.setAnim(this.debugAnim + 1);
      console.log(this.debugAnim, Animation.getName(this.debugAnim));
    }
    
    private prevAnim() {
      this.setAnim(this.debugAnim - 1);
      console.log(this.debugAnim, Animation.getName(this.debugAnim));
    }

    private setAnim(id: number) {
      let anim = this.scene.animations[id];
      this.debugAnim = id;

      let animState = this.lara.item.animState;
      animState.anim = anim;
      animState.frameIdx = anim.firstFrame;
      animState.frameOfs = 0;

      animState.anim.getFrame(animState.frameIdx, animState.frameOfs, animState.frame);
      animState.setMeshTransforms(
          this.lara.item.moveable.meshCount,
          this.lara.item.moveable.meshTree,
          this.scene.meshTrees);

      // TODO(tom): do we still need to explicitly call render here?
      // this.render();
    }
  }

  ///  console.log('Offset objects depth a little to prevent z-fighting on some objects');
  ///  
  ///  /**
  ///   * @param {string} level
  ///   * @constructor
  ///   * @struct
  ///   * @export
  ///   */
  ///  App(level) {
  ///    if (document.body == null) {
  ///      throw new Error('Document has no body. How does it smell?');
  ///    }
  ///    this.canvas = toybox.addCanvasToElement(document.body, true);
  ///    this.canvas.style.imageRendering = 'pixelated';
  ///  
  ///    this.ctx = new toybox.Context(
  ///        this.canvas, {
  ///          antialias: true,
  ///          depth: true,
  ///          stencil: true,
  ///          preserveDrawingBuffer: false },
  ///        ['EXT_texture_filter_anisotropic',
  ///         'OES_standard_derivatives',
  ///         'WEBGL_depth_texture',
  ///         'OES_texture_float',
  ///         'OES_texture_float_linear',
  ///         'OES_texture_half_float',
  ///         'OES_texture_half_float_linear']);
  ///  
  ///    debug.init(this.ctx, this.render.bind(this));
  ///  
  ///    let frameTimeDiv = document.createElement('div');
  ///    frameTimeDiv.style.position = 'absolute';
  ///    frameTimeDiv.style.right = '0';
  ///    frameTimeDiv.style.top = '0';
  ///    document.body.appendChild(frameTimeDiv);
  ///    this.frameTimeDebug_ = new toybox.FrameTimeDebug(frameTimeDiv, 80, 24);
  ///  
  ///    this.level = level;
  ///  
  ///    this.paused_ = false;
  ///  
  ///    this.scene = null;
  ///    this.wasUpdating = false;
  ///  
  ///    /** @private {!Array<!Controller>} */
  ///    this.controllers = [];
  ///  
  ///    /** @private {FollowCamera} */
  ///    this.followCamera_ = null;
  ///  
  ///    /** @private {FlyCamera} */
  ///    this.flyCamera = null;
  ///  
  ///    this.baseTime = 0;
  ///    this.time = 0;
  ///    this.animatedTextureDelay_ = 0;
  ///  
  ///    /** @private {Camera} */
  ///    this.activeCamera_ = null;
  ///  
  ///    /** @private {number} */
  ///    this.debugAnim = -1;
  ///  
  ///    this.renderer = null;
  ///  
  ///    let req = new XMLHttpRequest();
  ///    req.open('GET', 'levels/' + this.level, true);
///    req.responseType = 'arraybuffer';
///    req.onload = () => {
///      if (req.status != 200) {
///        throw new Error(
///             'Failed to load "' + req.responseURL + '" : (' +
///              req.status + ') ' + req.statusText);
///      }
///      let buf = /** @type {!ArrayBuffer} */ (req.response);
///      this.init(buf);
///    };
///    req.send(null);
///  
///    input.enable();
///  }
///  
///  
///  /**
///   * @param {!ArrayBuffer} buf
///   */
///  init(buf) {
///  }
///  
///  
///  /** @private */
///  /**
///   * Wrapper for the animation delay that converts raw time into time deltas.
///   * This makes it easier to call update_() from the console when debugging.
///   * @param {number} time
///   * @private
///   */
///  updateWrapper_(time: number) {
///    if (this.baseTime == 0) {
///      this.baseTime = time;
///    }
///    time = time - this.baseTime;
///  
///    let dt;
///    if (!this.wasUpdating) {
///      this.wasUpdating = false;
///      dt = 1 / 60;
///    } else {
///      dt = this.time == 0 ? 1 / 60 : (time - this.time) / 1000;
///    }
///    dt = 1 / 60;
///    if (debug.enabled('slowmo')) {
///      dt *= 0.25;
///    }
///    dt = Math.min(dt, 1/30);
///  
///    this.time = time;
///  
///    this.update(dt);
///    this.frameTimeDebug.update(time);
///  }
///  
///  




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

(window as any).app = new JsRaiderApp(args.level);
