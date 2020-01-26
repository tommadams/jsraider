import * as mat4 from 'toybox/math/mat4';
import * as vec3 from 'toybox/math/vec3';

import * as audio from 'audio';

import {AnimationId} from 'animation';
import {BlockState} from 'block';
import {Intersection, moveCharacter, resolveRoomByGrid, resolveRoomByPosition} from 'collision';
import {Controller} from 'controller';
import {Item, ItemType, FloorFunc, Room, Scene, Sector} from 'scene';
import {Input} from 'input';
import {SlidingConstraints} from 'sliding_constraints';
import {State} from 'state';

const GRAVITY = 180;
const FPS = 30;
const HANG_OFFSET = 730;

const FALL_SPEED = 150;
const SCREAM_SPEED = 185;

const TURN_FAST = Math.PI;
const TURN_FAST_BACK = Math.PI * 3 / 4;
const TURN_NORMAL = Math.PI / 2;
const TURN_SLOW = Math.PI / 3;
const TURN_WATER_FAST = Math.PI * 3 / 4;
const TURN_WATER_SLOW = Math.PI * 2 / 3;

const VAULT_MIN_HEIGHT = 512 - 128;
const VAULT_LOW_HEIGHT = 512 + 128;
const VAULT_MEDIUM_HEIGHT = 768 + 128;
const VAULT_HIGH_HEIGHT = 1792;

const STEP_UP_DOWN_SPEED = 2048;

console.log('SWAN DIVE TO SWIM TRANSITION IS BROKEN');
console.log('SWAN DIVE TO SWIM TRANSITION IS BROKEN');
console.log('SWAN DIVE TO SWIM TRANSITION IS BROKEN');
console.log('SWAN DIVE TO SWIM TRANSITION IS BROKEN');

export enum LocomotionType {
  GROUND = 0,
  AIR = 1,
  HANG = 2,
  SLIDE = 3,
  SWIM = 4,
  TREAD_WATER = 5
}

export const enum LaraBone {
  PELVIS = 0,
  LEFT_HIP = 1,
  LEFT_KNEE = 2,
  LEFT_ANKLE = 3,
  RIGHT_HIP = 4,
  RIGHT_KNEE = 5,
  RIGHT_ANKLE = 6,
  TORSO = 7,
  RIGHT_SHOULDER = 8,
  RIGHT_ELBOW = 9,
  RIGHT_WRIST = 10,
  LEFT_SHOULDER = 11,
  LEFT_ELBOW = 12,
  LEFT_WRIST = 13,
  HEAD = 14,
}

export class CharacterCollision {
  constructor(public p: vec3.Type, public n: vec3.Type) {}
}

export class Lara extends Controller {
  locomotionType = LocomotionType.GROUND;
  private input_ = new Input();
  private sector_: Sector = null;
  private prevSector_: Sector = null;
  private prevPosition_ = vec3.newZero();
  private oneOffTriggers_: boolean[] = [];
  private radius_ = 128;
  private height_ = 768;

  /** Lara's velocity (in character-local space). */
  private velocity_ = vec3.newZero();

  private health_ = 1;
  private state_: State = State.STOP;

  /** Stored for debug rendering purposes. */
  collisions: CharacterCollision[] = [];

  private grabSector_: Sector = null;
  private grabHeight_ = 0;
  private prevGrabTestPosition_ = vec3.newZero();
  private currGrabTestPosition_ = vec3.newZero();
  private averageHandPos_ = vec3.newZero();

  /**
   * the i'th column of the sector grid that corresponds to Lara's X coordinate.
   * this.i_ = math.floor(this.item.position[0] / 1024);
   */
  private i_ = 0;

  /**
   * the j'th row of the sector grid that corresponds to Lara's Z coordinate.
   * this.j_ = math.floor(this.item.position[2] / 1024);
   */
  private j_ = 0;

  /** If Lara is pointing mostly along the X axis, di_ == +/- 1 or 0 Otherwise. */
  private di_ = 0;
 
  /** If Lara is pointing mostly along the Z axis, dj_ == +/- 1 or 0 Otherwise. */
  private dj_ = 0;

  private getStateFuncs_: Function[] = [];

  constructor(item: Item, scene: Scene) {
    super(item, scene);

    vec3.setFromVec(this.prevPosition_, item.position);

    let anim = this.scene.animations[AnimationId.IDLE];
    item.animState.setAnim(anim, anim.firstFrame);

    this.getStateFuncs_ = [];
    this.getStateFuncs_[LocomotionType.GROUND] = this.getStateGround_.bind(this);
    this.getStateFuncs_[LocomotionType.AIR] = this.getStateAir_.bind(this);
    this.getStateFuncs_[LocomotionType.HANG] = this.getStateHang_.bind(this);
    this.getStateFuncs_[LocomotionType.SLIDE] = this.getStateSlide_.bind(this);
    this.getStateFuncs_[LocomotionType.SWIM] = this.getStateSwim_.bind(this);
    this.getStateFuncs_[LocomotionType.TREAD_WATER] = this.getStateTreadWater_.bind(this);

    // Uncomment to dump all of Lara's animations.
    //Animation.dumpGraph(this.scene.animations, item.animState.anim.id);

    // gym - boxes
    // item.position[0] = 55819;
    // item.position[1] = 2560;
    // item.position[2] = 39387;
    // item.rotation[1] = -Math.PI * 0.5;
    // item.room = this.scene.rooms[11];

    // gym - ceiling collision
    // item.position[0] = 42275;
    // item.position[1] = -1280;
    // item.position[2] = 48631;
    // item.rotation[1] = -Math.PI * 0.5;
    // item.room = this.scene.rooms[7];

    // gym - vault
    // item.position[0] = 43904;
    // item.position[1] = 2112;
    // item.position[2] = 51524;
    // item.rotation[1] = Math.PI * 0.5;
    // item.room = this.scene.rooms[12];
   
    // gym - fall
    // item.position[0] = 53165;
    // item.position[1] = 0;
    // item.position[2] = 46684;
    // item.rotation[1] = -3.70;
    // item.room = this.scene.rooms[9];
    
    // caves - low ceiling
    // item.position[0] = 36445;
    // item.position[1] = 3040;
    // item.position[2] = 74138;
    // item.rotation[1] = 0;
    // item.room = this.scene.rooms[32];

    // caves - slide
    // item.position[0] = 74507;
    // item.position[1] = 3693;
    // item.position[2] = 12725;
    // item.rotation[1] = -0.680678;
    // item.room = this.scene.rooms[0];

    // caves - bridge
    // item.position[0] = 25122;
    // item.position[1] = 4352;
    // item.position[2] = 55814;
    // item.rotation[1] = Math.PI;
    // item.room = this.scene.rooms[13];

    // vilcabamba - sprites
    // item.position[0] = 72315;
    // item.position[1] = 0;
    // item.position[2] = 24906;
    // item.rotation[1] = 2.7925;
    // item.room = this.scene.rooms[15];

    // vilcabamba - jump
    // item.position[0] = 31251;
    // item.position[1] = -2560;
    // item.position[2] = 24704;
    // item.rotation[1] = Math.PI
    // item.room = this.scene.rooms[43];

    // vilcabamba - portals
    // item.position[0] = 75545.078125;
    // item.position[1] = 0;
    // item.position[2] = 32897.54296875;
    // item.rotation[1] = -1.326450231515698;
    // item.room = this.scene.rooms[85];

    // cistern
    // item.position[0] = 40300;
    // item.position[1] = -3328;
    // item.position[2] = 63766;
    // item.rotation[1] = -3.61283;
    // item.room = this.scene.rooms[99];

    // this.item.position[0] = 45549; 
    // this.item.position[1] = -3328;
    // this.item.position[2] = 67050;
    // this.item.rotation[1] = 3.0892367362976074;
    // this.item.room = this.scene.rooms[7];

    // lost valley - waterfall climb
    // item.position[0] = 44539;
    // item.position[1] = 2624;
    // item.position[2] = 5248;
    // item.rotation[1] = -Math.PI;
    // item.room = this.scene.rooms[59];

    // lost valley - inside waterfall
    // item.position[0] = 40831;
    // item.position[1] = -512;
    // item.position[2] = 2338;
    // item.rotation[1] = Math.PI;
    // item.room = this.scene.rooms[31];

    // lost valley
    // item.position[0] = 32639;
    // item.position[1] = 4960;
    // item.position[2] = 48256;
    // item.rotation[1] = 0.5 * Math.PI;
    // item.room = this.scene.rooms[16];
    
    // st francis' folly - block
    // item.position[0] = 31217;
    // item.position[1] = 256;
    // item.position[2] = 36339;
    // item.rotation[1] = 0.5 * Math.PI;
    // item.room = this.scene.rooms[0];

    // st francis' folly - item
    // item.position[0] = 34104;
    // item.position[1] = -3840;
    // item.position[2] = 40127;
    // item.rotation[1] = 0.1571;
    // item.room = this.scene.rooms[1];

    // colosseum
    // item.position[0] = 81537;
    // item.position[1] = 0;
    // item.position[2] = 38783;
    // item.rotation[1] = 0;
    // item.room = this.scene.rooms[4];

    // palace midas
    // item.position[0] = 37147;
    // item.position[1] = -4678;
    // item.position[2] = 29231;
    // item.rotation[1] = 0.5 * Math.PI;
    // item.room = this.scene.rooms[42];

    this.sector_ = this.item.room.getSectorByPosition(this.item.position);
    // this.updateTriggers_();
    // this.prevSector_ = this.sector_;
  }

  getBoneTransform(bone: LaraBone) {
    return this.item.animState.meshTransforms[bone];
  }

  private updateGrabTestPosition_() {
    vec3.setFromVec(this.prevGrabTestPosition_, this.currGrabTestPosition_);
  
    let leftTransform = this.getBoneTransform(LaraBone.LEFT_WRIST);
    let rightTransform = this.getBoneTransform(LaraBone.RIGHT_WRIST);
    for (let i = 0; i < 3; ++i) {
      // Offset the left and right wrist positions along the local Y axis to get
      // the grab test Position.
      let l = leftTransform[12 + i] + 48 * leftTransform[4 + i];
      let r = rightTransform[12 + i] + 48 * rightTransform[4 + i];
      this.currGrabTestPosition_[i] = 0.5 * (l + r);
    }
  }
  
  /** Moves Lara according to her rotation & local velocity. */
  private move_(dt: number) {
    let item = this.item;
    let animState = item.animState;
  
    this.collisions.length = 0;
    // Do nothing if Lara isn't moving.
    if (this.velocity_[0] == 0 && this.velocity_[2] == 0) {
      return;
    }
  
    let v = vec3.newZero();
    let p = vec3.newFromVec(item.position);
    let x = vec3.newFromValues(
        animState.transform[0],
        animState.transform[1],
        animState.transform[2]);
    let z = vec3.newFromValues(
        animState.transform[8],
        animState.transform[9],
        animState.transform[10]);
    let room = item.room;
    vec3.scale(z, FPS * dt * this.velocity_[2], z);
    vec3.scale(x, FPS * dt * this.velocity_[0], x);
    vec3.add(v, x, z);
  
    let length = vec3.length(v);
    if (length > 0) {
      let constraints = new SlidingConstraints(v);
      let intersection = new Intersection();
      let vv = vec3.newZero();
  
      for (let loop = 0; loop < 8; ++loop) {
        vec3.normalize(vv, v);
        intersection.geom.t = length;
  
        if (!moveCharacter(
              room, p, vv, this.radius_, this.height_, intersection,
              this.state_)) {
          vec3.add(p, p, v);
          break;
        }
  
        let pos = vec3.scale(vec3.newZero(), -this.radius_, intersection.geom.n);
        vec3.add(pos, pos, item.position);
  
        this.collisions.push(new CharacterCollision(
              pos, vec3.newFromVec(intersection.geom.n)));
  
        // Move to the intersection position.
        // TODO(tom): t - 0.1 is not really the correct thing to do.
        vec3.scale(vv, intersection.geom.t - 0.1, vv);
        vec3.add(p, p, vv);
  
        // Calculate the remaining movement vector and apply sliding constraits.
        vec3.scale(v, (length - intersection.geom.t) / length, v);
        constraints.add(intersection.geom.n);
        constraints.apply(v);
  
        length = vec3.length(v);
        if (length < 0.00001) {
          break;
        }
      }
      if (room != null) {
        item.room = room;
        vec3.setFromVec(item.position, p);
      }
    }
  }
  
  /**
   * @return {boolean} Returns true if Lara is touching (or almost touching) the
   *     edge between her current sector (i, j) and the next sector
   *     (i + di, j + dj).
   */
  private nearSectorEdge_() {
    // Check that Lara is close enough to the next sector to potentially grab it.
    let dis = this.radius_ + 1;
  
    let position = this.item.position;
    let fx = position[0] % 1024;
    fx = fx >= 0 ? fx : fx + 1024;
    if (this.di_ == 1) {
      return fx > 1024 - dis;
    }
    if (this.di_ == -1) {
      return fx <= dis;
    }
  
    let fz = position[2] % 1024;
    fz = fz >= 0 ? fz : fz + 1024;
    if (this.dj_ == 1) {
      return fz > 1024 - dis;
    }
    if (this.dj_ == -1) {
      return fz <= dis;
    }
  
    throw new Error('Either di or dj should always be +/- 1');
  }

  findGrabSector_() {
    this.grabSector_ = null;
    this.grabHeight_ = 0;
  
    let position = this.item.position;
    // Get (i, j) index of potential grab sector.
    let i = this.i_ + this.di_;
    let j = this.j_ + this.dj_;
  
    // Get the sector at this location.
    let room = resolveRoomByGrid(this.item.room, i, j, position[1]);
    if (!room) {
      return;
    }
    let sector = room.getSectorByGrid(i, j);
    if (!sector) {
      return;
    }
  
    // Get the floor height at the point closest to Lara and check that it is
    // high enough to perform a vault or a grab.
    let floor = sector.getFloorAt(position);
    let dy = this.item.position[1] - floor;
    if (this.state_ == State.TREAD_WATER_STOP ||
        this.state_ == State.TREAD_WATER_FORWARD) {
      if (sector.floor >= this.sector_.floor ||
          this.sector_.floor - sector.floor > 256 + 128) {
        return;
      }
    } else {
      if (dy < VAULT_MIN_HEIGHT) {
        return;
      }
    }
  
    // If the grab height is low enough to be a vault, ensure that there's enough
    // space for Lara to vault up and stand. We take the lowest ceiling height
    // from Lara's current sector and the next sector to avoid her bumping her
    // head as she climbs up.
    if (dy <= VAULT_MEDIUM_HEIGHT) {
      let ceiling = Math.max(
          this.sector_.getCeilingAt(position),
          sector.getCeilingAt(position));
      if (floor - ceiling < this.height_) {
        return;
      }
    }
  
    // Check that the floor slope is not too steep.
    if (this.di_ == 0) {
      if (Math.abs(sector.floorData.floorSlope[0]) > 512) {
        return;
      }
    } else {
      if (Math.abs(sector.floorData.floorSlope[1]) > 512) {
        return;
      }
    }
  
    // Check that Lara is close enough to the next sector to potentially grab it.
    if (!this.nearSectorEdge_()) {
      return;
    }
  
    // All tests pass, we found a grab candidate.
    this.grabSector_ = sector;
    this.grabHeight_ = floor;
  }
 

  update(dt: number) {
    let item = this.item;
    let animState = item.animState;
  
    this.input_.update();
  
    this.locomotionType = this.getLocomotionType_();
    this.updateState_(dt);
    this.updateVelocity_(dt);
    this.updatePosition_(dt);
    this.updateSector_();
  
    animState.anim.getFrame(
        animState.frameIdx, animState.frameOfs, animState.frame);
    animState.setMeshTransforms(
        item.moveable.meshCount,
        item.moveable.meshTree,
        this.scene.meshTrees);
    this.updateGrabTestPosition_();
  }

  private getLocomotionType_() {
    if (State.isHanging(this.state_)) {
      return LocomotionType.HANG;
    }
    if (State.isTreadingWater(this.state_)) {
      return LocomotionType.TREAD_WATER;
    }
  
    let sector = this.sector_;
  
    if (this.item.room.underwater()) {
      if (State.isSwimming(this.state_)) {
        if (this.item.position[1] - this.radius_ < sector.ceiling) {
          if (!sector.roomAbove || !sector.roomAbove.underwater()) {
            return LocomotionType.TREAD_WATER;
          }
        }
      } else {
        // Don't transition to swim until Lara's hips are underwater.
        let v = vec3.newZero();
        mat4.getTranslation(
            v, this.item.animState.meshTransforms[LaraBone.PELVIS]);
        if (v[1] < sector.ceiling) {
          return this.locomotionType;
        }
      }
      return LocomotionType.SWIM;
    }
  
    if (this.state_ == State.DIVE) {
      return LocomotionType.SWIM;
    }
    if (State.isSwimming(this.state_)) {
      if (sector.roomBelow && sector.roomBelow.underwater()) {
        return LocomotionType.TREAD_WATER;
      } else {
        return LocomotionType.AIR;
      }
    }
  
    let floor = sector.getFloorAt(this.item.position);
    let sx = sector.floorData.floorSlope[0];
    let sz = sector.floorData.floorSlope[1];
    let slide = Math.abs(sx) > 512 || Math.abs(sz) > 512;
  
    if (this.locomotionType == LocomotionType.AIR) {
      if (this.item.position[1] >= floor) {
        let animState = this.item.animState;
        if (this.velocity_[1] >= 0 ||
            animState.frameIdx > animState.anim.firstFrame + 2) {
          return slide ? LocomotionType.SLIDE : LocomotionType.GROUND;
        }
      }
    } else {
      if (this.item.position[1] + 256 >= floor) {
        return slide ? LocomotionType.SLIDE : LocomotionType.GROUND;
      }
    }
  
    return LocomotionType.AIR;
  }
 

  private findBlock_() {
    // If Lara isn't near a sector edge, there's no way she can push a block.
    if (!this.nearSectorEdge_()) {
      return null;
    }
  
    // Get the sector ahead of Lara.
    let i = this.i_ + this.di_;
    let j = this.j_ + this.dj_;
    let y = this.item.position[1];
    let room = resolveRoomByGrid(this.item.room, i, j, y);
    let sector = room.getSectorByGrid(i, j);
  
    // If the sector floor isn't flat, a block can't be on it.
    if (sector.floorData.floorSlope[0] != 0 ||
        sector.floorData.floorSlope[1] != 0) {
      return null;
    }
  
    // Quick tests have all passed, look for a block that's in the desired
    // sector and at the same height as Lara.
    for (let item of this.scene.items) {
      if (!item.isBlock()) {
        continue;
      }
      let p = item.position;
      if (i == Math.floor(item.position[0] / 1024) &&
          j == Math.floor(item.position[2] / 1024) &&
          y == item.position[1] &&
          room == item.room) {
        return item;
      }
    }
  
    return null;
  }
  
  /**
   * @param room Room adjacent to the sector (i, j). Either the
   *     room of the block if pushing, or Lara's room if pulling.
   * @param i
   * @param j
   * @param y
   * @return {boolean} True if a block with height y can be pushed to the
   *     sector at (i, j).
   */
  private canPushBlockTo_(room: Room, i: number, j: number, y: number) {
    room = resolveRoomByGrid(room, i, j, y);
    if (room == null) { return false; }
    let sector = room.getSectorByGrid(i, j);
    if (sector == null) { return false; }
    return (sector.floor == y &&
            sector.floorData.floorSlope[0] == 0 &&
            sector.floorData.floorSlope[1] == 0);
  }
  
  private alignToAxis_() {
    this.item.rotation[1] = Math.atan2(this.di_, this.dj_);
  }
  
  private getStateGround_() {
    let forward = this.input_.forward;
    let backward = this.input_.backward;
    let left = this.input_.left;
    let right = this.input_.right;
    let action = this.input_.action;
    let stepLeft = this.input_.stepLeft;
    let stepRight = this.input_.stepRight;
    let jump = this.input_.jump;
    let walk = this.input_.walk;
    
    // Handle transition from fall.
    if (this.state_ == State.FALL) {
      if (!this.item.animState.canChangeState(State.STOP)) {
        let anim = this.scene.animations[AnimationId.LAND];
        this.item.animState.setAnim(anim, anim.firstFrame);
      }
      return State.STOP;
    }
  
    // Handle transition from jump.
    if (State.isJumping(this.state_)) {
      let position = this.item.position;
      if (this.velocity_[1] < 0) {
        let anim = this.scene.animations[AnimationId.LAND];
        this.item.animState.setAnim(anim, anim.firstFrame);
        this.velocity_[1] = 0;
      }
      if (this.state_ == State.JUMP_FORWARD && forward && !walk) { return State.RUN; }
      return State.STOP;
    }
  
    // Handle transition from slide
    if (this.state_ == State.SLIDE || this.state_ == State.SLIDE_BACK) {
      return State.STOP;
    }
  
    // Jump
    if (this.state_ == State.COMPRESS) {
      if (forward) { return State.JUMP_FORWARD; }
      if (backward) { return State.JUMP_BACK; }
      if (left) { return State.JUMP_LEFT; }
      if (right) { return State.JUMP_RIGHT; }
      return this.state_;
    }
    if (jump) {
      if (this.state_ == State.RUN) { return State.JUMP_FORWARD; }
      if (this.state_ == State.STOP) { return State.COMPRESS; }
    }
  
    // Side step
    if (this.state_ == State.STEP_LEFT) {
      return stepLeft && !stepRight ? State.STEP_LEFT : State.STOP;
    }
    if (this.state_ == State.STEP_RIGHT) {
      return stepRight && !stepLeft ? State.STEP_RIGHT : State.STOP;
    }
    if (this.state_ == State.STOP) {
      if (stepLeft && !stepRight) { return State.STEP_LEFT; }
      if (stepRight && !stepLeft) { return State.STEP_RIGHT; }
    }
  
    // Push or pull block
    if (this.state_ == State.PUSH_BLOCK ||
        this.state_ == State.PULL_BLOCK) {
      return this.state_;
    }
    if (action) {
      let block = this.findBlock_();
      if (block != null) {
        if (this.state_ == State.PUSH_READY) {
          if (forward && this.item.animState.canChangeState(State.PUSH_BLOCK)) {
            if (this.canPushBlockTo_(
                  block.room, this.i_ + 2 * this.di_, this.j_ + 2 * this.dj_,
                  block.position[1])) {
              block.rotation[1] = this.item.rotation[1];
              block.animState.tryChangeState(BlockState.PUSH);
              return State.PUSH_BLOCK;
            }
          }
          if (backward && this.item.animState.canChangeState(State.PULL_BLOCK)) {
            if (this.canPushBlockTo_(
                  this.item.room, this.i_ - this.di_, this.j_ - this.dj_,
                  block.position[1])) {
              block.rotation[1] = this.item.rotation[1];
              block.animState.tryChangeState(BlockState.PULL);
              return State.PULL_BLOCK;
            }
          }
          return State.PUSH_READY;
        }
        if (!forward) {
          this.alignToAxis_();
          return State.PUSH_READY;
        }
      }
    }
  
    // Climb up
    if (this.grabSector_ != null && forward && action) {
      if (this.state_ != State.STOP) {
        let anim = this.scene.animations[AnimationId.IDLE];
        this.item.animState.setAnim(anim, anim.firstFrame);
        return State.STOP;
      }
      if (this.item.animState.anim.id == AnimationId.IDLE) {
        let dy = this.item.position[1] - this.grabHeight_;
        let anim = null;
        // TODO(tom): snap height
        if (dy <= VAULT_LOW_HEIGHT) {
          anim = this.scene.animations[AnimationId.VAULT_UP_LOW];
        } else if (dy <= VAULT_MEDIUM_HEIGHT) {
          anim = this.scene.animations[AnimationId.VAULT_UP_MED];
        } else if (dy <= VAULT_HIGH_HEIGHT) {
          anim = this.scene.animations[AnimationId.PREPARE_JUMP_UP_GRAB];
        }
        if (anim != null) {
          this.alignToAxis_();
          this.item.animState.setAnim(anim, anim.firstFrame);
        }
      }
      return State.STOP;
    }
  
    // Forward
    if (forward) {
      return walk ? State.WALK : State.RUN;
    }
  
    // Turn
    if (this.state_ == State.STOP || this.state_ == State.TURN_FAST ||
        this.state_ == State.TURN_LEFT || this.state_ == State.TURN_RIGHT) {
      if (left != right) {
        if (this.state_ == State.TURN_FAST) {
          return this.state_;
        }
        let animState = this.item.animState;
        let slow = animState.anim.id == AnimationId.IDLE || animState.loopCount == 0;
        if (left) {
          return slow ? State.TURN_LEFT : State.TURN_FAST;
        }
        if (right) {
          return slow ? State.TURN_RIGHT : State.TURN_FAST;
        }
      }
      if (this.state_ != State.STOP) {
        return State.STOP;
      }
    }
  
    // Backward
    if (backward) {
      if (this.state_ == State.RUN || this.state_ == State.WALK) { return State.STOP }
      if (this.state_ == State.BACK && !walk) { return State.STOP; }
      return walk ? State.BACK : State.FAST_BACK;
    }
  
    return State.STOP;
  }

  private getStateAir_() {
    let forward = this.input_.forward;
    let action = this.input_.action;
    let walk = this.input_.walk;
  
    // Handle transitions from ground.
    if (!State.isJumping(this.state_) && this.state_ != State.FALL) {
      // TODO(tom): Figure out how to do this properly
      if (this.state_ == State.FAST_BACK) {
        this.velocity_[2] = -6;
      }
      let anim = this.scene.animations[AnimationId.START_DROP];
      this.item.animState.setAnim(anim, anim.firstFrame);
      return this.item.animState.anim.state;
    }
  
    if (this.velocity_[1] > FALL_SPEED) {
      return State.FALL;
    }
  
    if ((this.state_ == State.REACH || this.state_ == State.JUMP_UP) && action) {
      let di = this.di_;
      let dj = this.dj_;
  
      let prevPos = this.prevGrabTestPosition_;
      let currPos = this.currGrabTestPosition_;
  
      // Get the adjacent sector in that direction.
      let grabDistance = this.radius_ + 32;
  
      let v = vec3.newFromValues(
          this.item.position[0],
          Math.min(prevPos[1], currPos[1]),
          this.item.position[2]);
  
      let currRoom = resolveRoomByPosition(this.item.room, v);
      v[0] += grabDistance * di;
      v[2] += grabDistance * dj;
      let grabRoom = resolveRoomByPosition(currRoom, v);
      let grabSector = grabRoom.getSectorByPosition(v);
      let grabFloor = grabSector.getFloorAt(v);
  
      // If Lara passed by the grab point this frame, transition to the HANG state.
      let minY = Math.min(currPos[1], prevPos[1]);
      let maxY = Math.max(currPos[1], prevPos[1]);
      if (minY <= grabFloor && maxY >= grabFloor) {
        // TODO(tom): Probably don't want to simply use HANG and the +15 frame
        // offset here. Figure out how these three animations should be used:
        //   29 "jump_up_catch_edge"
        //   96 "hang"
        //   150 "catch_edge_no_wall"
        let anim = this.scene.animations[AnimationId.HANG];
        let frame = anim.firstFrame;
        if (this.state_ == State.JUMP_UP) {
          frame += 15;
        }
        this.item.animState.setAnim(anim, frame);
        this.item.rotation[1] = Math.atan2(di, dj);
        grabSector.getNearestFloorPosition(this.item.position, this.item.position);
        // Snap Lara to the grab position
        this.item.position[0] -= this.radius_ * di;
        this.item.position[1] = grabFloor + HANG_OFFSET;
        this.item.position[2] -= this.radius_ * dj;
        this.velocity_.fill(0);
        return State.HANG;
      }
    }
  
    let position = this.item.position;
    let floor = this.sector_.getFloorAt(position);
    if (floor == position[1]) {
      if (forward) { return State.RUN; }
      return State.STOP;
    }
  
    if (action && this.state_ != State.JUMP_UP) { return State.REACH; }
  
    if (walk) { return State.SWAN_DIVE; }
  
    return this.state_;
  }

  private getStateHang_() {
    let forward = this.input_.forward;
    let left = this.input_.left;
    let right = this.input_.right;
    let action = this.input_.action;
    let walk = this.input_.walk;
  
    // Get the sector that Lara is hanging from.
    let di = this.di_;
    let dj = this.dj_;
    let hy = this.currGrabTestPosition_[1] - 64;
    let hi = this.i_ + di;
    let hj = this.j_ + dj;
    let currHangSector = this.sector_.getResolvedSectorByGrid(hi, hj, hy);
    let currHangRoom = currHangSector.room;
  
    // Get the height of the floor at the point Lara is hanging from.
    let hangFloor = currHangSector.getFloorAt(this.item.position);
  
    // Determine whether Lara is currently, or about to start, shimmying left or
    // right. Favour checking her actual state over what the requested state is
    // based on the input state, to correctly handle the case where Lara is
    // partway through shimmying in one direction and the input is pointing in the
    // opposite direction.
    let checkLeft, checkRight;
    if (this.state_ == State.SHIMMY_LEFT || this.state_ == State.SHIMMY_RIGHT) {
      checkLeft = this.state_ == State.SHIMMY_LEFT;
      checkRight = this.state_ == State.SHIMMY_RIGHT;
    } else {
      checkLeft = left;
      checkRight = right;
    }
  
    let canShimmy = false;
    if (checkLeft || checkRight) {
      // The logic for determining whether or not Lara can shimmy from one sector
      // to the next needs the exact heights of three floor vertices:
      //  a) The vertex of the sector she is shimmying on.
      //  b) The vertex of the sector she is shimmying to.
      //  c) The vertex of the sector she is hanging above.
      // Assuming Lara is shimmying along edge (0, 1) of sector a below, the
      // sectors involved are (a, b, c) as above and the vertex in each sector
      // that we're interested in is X:
      //   +-----+-----+
      //   |2   3|     |
      //   |  a  |  b  |
      //   |0   1|     |
      //   +-----X-----+
      //         |     |
      //         |  c  |
      //         |     |
      //         +-----+
      let ni, nj, nhi, nhj;
      if (checkLeft) {
        ni = this.i_ - dj;
        nj = this.j_ + di;
        nhi = hi - dj;
        nhj = hj + di;
      } else {
        ni = this.i_ + dj;
        nj = this.j_ - di;
        nhi = hi + dj;
        nhj = hj - di;
      }
  
      // Get the sector Lara is shimmying towards.
      let nextHangRoom = resolveRoomByGrid(currHangRoom, nhi, nhj, hy);
      let nextHangSector = nextHangRoom.getSectorByGrid(nhi, nhj);
      let nextFloorRoom = resolveRoomByGrid(this.item.room, ni, nj, this.item.position[1]);
      let nextFloorSector = nextFloorRoom.getSectorByGrid(ni, nj);
  
      // In order to cross from one sector to another while shimmying, several
      // checks must be passed:
      //  1) The sector edge that Lara is shimmying along and the next
      //     sector edge have the same height at their connecting vertex.
      let currHangA, currHangB, nextHangA, nextHangB, nextFloorA, nextFloorB;
      if (dj == 0) {
        currHangA = (1 - di) / 2;
        currHangB = checkRight ? currHangA : 1 - currHangA;
        nextHangA = currHangA;
        nextHangB = 1 - currHangB;
        nextFloorA = 1 - currHangA;
        nextFloorB = nextHangB;
      } else {
        currHangB = (1 - dj) / 2;
        currHangA = checkLeft ? currHangB : 1 - currHangB;
        nextHangB = currHangB;
        nextHangA = 1 - currHangA;
        nextFloorB = 1 - currHangB;
        nextFloorA = nextHangA;
      }
      let edgesConnect =
          currHangSector.getFloorVertexY(currHangA, currHangB) ==
          nextHangSector.getFloorVertexY(nextHangA, nextHangB);
  
      // Oh, and some rare cases have a floor sector adjacent to a roomBelow
      // sector at the same height, e.g. the first ledge in the water room of the
      // temple in the City of Vilcabamba.
      if (nextHangSector.roomBelow != null) {
        edgesConnect = false;
      }
  
      //  2) The distance from the next sector's shimmy edge and the floor is
      //     large enough for Lara to fit.
      let enoughSpace =
          nextHangSector.getFloorVertexY(nextHangA, nextHangB) + HANG_OFFSET <=
          nextFloorSector.getFloorVertexY(nextFloorA, nextFloorB);
  
      //  3) The next sector's shimmy edge doesn't slope too much.
      let noSlope;
      if (di == 0) {
        noSlope = Math.abs(nextHangSector.floorData.floorSlope[0]) <= 512;
      } else{
        noSlope = Math.abs(nextHangSector.floorData.floorSlope[1]) <= 512;
      }
  
      if (edgesConnect && enoughSpace && noSlope) {
        // Can transition from this sector to the next.
        canShimmy = true;
      } else {
        // Can't transition from this sector to the next: stop shimmying once we
        // get close enough to the edge of the current sector.
        let fx = this.item.position[0] % 1024;
        let fz = this.item.position[2] % 1024;
        if (fx < 0) { fx += 1024; }
        if (fz < 0) { fz += 1024; }
        let dx = currHangA * 1024 - fx;
        let dz = currHangB * 1024 - fz;
        canShimmy = Math.abs(di * dz - dj * dx) > this.radius_ + 1;
      }
  
      // Check that the ground below Lara hasn't sloped up so much that it blocks
      // the shimmy.
      if (canShimmy) {
        let ahead = vec3.newFromVec(this.item.position);
        if (checkLeft) {
          ahead[0] -= this.radius_ * dj;
          ahead[2] += this.radius_ * di;
        } else {
          ahead[0] += this.radius_ * dj;
          ahead[2] -= this.radius_ * di;
        }
        let aheadFloor = this.sector_.getFloorAt(ahead);
        let aheadHang = currHangSector.getFloorAt(ahead);
        canShimmy = aheadHang + HANG_OFFSET < aheadFloor;
      }
    }
  
    if (this.state_ == State.SHIMMY_LEFT || this.state_ == State.SHIMMY_RIGHT) {
      this.item.position[1] = hangFloor + HANG_OFFSET;
  
      if (!canShimmy) {
        vec3.setFromValues(this.velocity_, 0, 0, 0);
        let anim = this.scene.animations[AnimationId.HANG];
        this.item.animState.setAnim(anim, anim.firstFrame + 21);
        return State.HANG;
      }
  
      if (this.state_ == State.SHIMMY_LEFT) {
        return left ? State.SHIMMY_LEFT : State.HANG;
      } else {
        return right ? State.SHIMMY_RIGHT : State.HANG;
      }
    }
  
    if (forward) {
      // Check that there's enough space to climb up. Check both the current
      // ceiling and the next one to avoid Lara bumping her head on the way up.
      let hangCeiling = Math.max(
          currHangSector.getCeilingAt(this.item.position),
          this.sector_.getCeilingAt(this.item.position));
      if (hangCeiling - hangFloor < -this.height_) {
        return walk ? State.HANDSTAND : State.HANG_UP;
      }
    }
    if (left && canShimmy) { return State.SHIMMY_LEFT; }
    if (right && canShimmy) { return State.SHIMMY_RIGHT; }
  
    if (action || this.state_ == State.HANG_UP || this.state_ == State.HANDSTAND ||
        this.state_ == State.WATER_OUT) {
      return State.HANG;
    }
  
    // Let go.
    vec3.setFromValues(this.velocity_, 0, 0, 0);
    this.item.position[1] += 128;
    let anim = this.scene.animations[AnimationId.JUMP_UP];
    this.item.animState.setAnim(anim, anim.firstFrame);
    this.locomotionType = LocomotionType.AIR;
    return State.JUMP_UP;
  }

  private getStateSlide_() {
    let jump = this.input_.jump;
  
    // Starting a jump from slide takes a few frames so don't do any state
    // handling during that time, otherwise we may mess up the transition to
    // the actual jump.
    if (this.item.animState.anim.id == AnimationId.START_JUMP_FORWARD ||
        this.item.animState.anim.id == AnimationId.START_JUMP_BACK) {
      return this.state_;
    }
  
    if (this.state_ != State.SLIDE && this.state_ != State.SLIDE_BACK) {
      let sx = this.sector_.floorData.floorSlope[0];
      let sz = this.sector_.floorData.floorSlope[1];
      let dx = this.item.animState.transform[8];
      let dz = this.item.animState.transform[10];
      let back;
      if (Math.abs(sx) > Math.abs(sz)) {
        back = (dx * sx) > 0;
        if (back) {
          this.item.rotation[1] = (sx > 0) ? 0.5 : 1.5;
        } else {
          this.item.rotation[1] = (sx > 0) ? 1.5 : 0.5;
        }
      } else {
        back = (dz * sz) > 0;
        if (back) {
          this.item.rotation[1] = (sz > 0) ? 0 : 1;
        } else {
          this.item.rotation[1] = (sz > 0) ? 1 : 0;
        }
      }
      this.item.rotation[1] *= Math.PI;
  
      if (back) {
        let anim = this.scene.animations[AnimationId.START_BACK_SLIDE];
        this.item.animState.setAnim(anim, anim.firstFrame);
        this.state_ = State.SLIDE_BACK;
      } else {
        let anim = this.scene.animations[AnimationId.SLIDE];
        this.item.animState.setAnim(anim, anim.firstFrame);
        this.state_ = State.SLIDE;
      }
    }
  
    if (jump) {
      if (this.state_ == State.SLIDE_BACK) {
        return State.JUMP_BACK;
      } else if (this.state_ == State.SLIDE) {
        return State.JUMP_FORWARD;
      }
    }
  
    return this.state_;
  }

  private getStateSwim_() {
    if (this.state_ == State.STOP && this.locomotionType == LocomotionType.SWIM) {
      let anim = this.scene.animations[AnimationId.SWIM_STOP];
      this.item.animState.setAnim(anim, anim.firstFrame);
      return State.SWIM_STOP;
    }

    // Handle transition from fall or jump.
    if (this.state_ == State.FALL || State.isJumping(this.state_)) {
      let anim;
      if (this.item.animState.anim.id == AnimationId.SWAN_DIVE) {
        anim = this.scene.animations[AnimationId.SWAN_DIVE_TO_SWIM];
      } else {
        anim = this.scene.animations[AnimationId.DROP_TO_SWIM];
      }
      this.item.animState.setAnim(anim, anim.firstFrame);
      return State.SWIM;
    }
  
    let jump = this.input_.jump;
    if (jump) {
      return State.SWIM;
    }
    
    if (this.state_ == State.SWIM_INERTIA || this.state_ == State.STOP) {
      return State.SWIM_STOP;
    }
  
    return State.SWIM_INERTIA;
  }

  private getStateTreadWater_() {
    // Handle transition from swim.
    if (this.state_ == State.SWIM ||
        this.state_ == State.SWIM_INERTIA ||
        this.state_ == State.SWIM_STOP ) {
      if (this.item.room.underwater()) {
        this.item.room = this.sector_.roomAbove;
        this.sector_ = this.item.room.getSectorByPosition(this.item.position);
      }
      let anim = this.scene.animations[AnimationId.SWIM_TO_TREAD_WATER];
      this.item.animState.setAnim(anim, anim.firstFrame);
      this.item.rotation[0] = 0;
      vec3.setFromValues(this.velocity_, 0, 0, 0);
      this.item.position[1] = this.sector_.floor - 32;
    }
  
    if (this.grabSector_ != null &&
        this.input_.forward && this.input_.action) {
      let anim = this.scene.animations[AnimationId.LEAVE_WATER];
      this.alignToAxis_();
      this.item.animState.setAnim(anim, anim.firstFrame);
      this.grabSector_.getNearestFloorPosition(
          this.item.position, this.item.position);
      return State.WATER_OUT;
    }
  
    if (this.input_.forward) { return State.TREAD_WATER_FORWARD; }
    if (this.input_.backward) { return State.TREAD_WATER_BACK; }
    if (this.input_.stepLeft) { return State.TREAD_WATER_LEFT; }
    if (this.input_.stepRight) { return State.TREAD_WATER_RIGHT; }
    if (this.input_.jump &&
        this.item.animState.anim.id != AnimationId.SWIM_TO_TREAD_WATER) {
      let anim = this.scene.animations[AnimationId.TREAD_WATER_TO_SWIM];
      this.item.animState.setAnim(anim, anim.firstFrame);
      this.item.position[1] = this.sector_.floor + 1;
      this.item.room = this.sector_.getResolvedSectorByPosition(
          this.item.position).room;
      return State.DIVE;
    }
  
    return State.TREAD_WATER_STOP;
  }
  
  private getStateDefault_() {
    if (this.state_ == State.SWAN_DIVE || this.state_ == State.RUN) {
      return this.state_;
    }
    return this.state_;
    switch (this.locomotionType) {
      case LocomotionType.GROUND: return State.STOP;
      case LocomotionType.AIR: return State.FALL;
      case LocomotionType.HANG: return State.HANG;
      case LocomotionType.SLIDE: return State.FALL;
      case LocomotionType.SWIM: return State.SWIM_STOP;
      case LocomotionType.TREAD_WATER: return State.TREAD_WATER_STOP;
    }
    return State.NONE;
  }
  
  private updateState_(dt: number) {
    // Try and change Lara's state.
    let targetState = this.getStateFuncs_[this.locomotionType]();
    if (targetState != this.item.animState.anim.state) {
      if (!this.item.animState.tryChangeState(targetState)) {
        let defaultState = this.getStateDefault_();
        if (defaultState != this.state_ && defaultState != targetState) {
          console.log(
              `can\'t transition from ${State[this.state_]} to` +
              `${State[targetState]}', trying default ${State[defaultState]}`);
          this.item.animState.tryChangeState(defaultState);
        }
      }
    }
  
    // Advance the animation system.
    let animState = this.item.animState;
    animState.advance(dt, this.animStateCommand);
    if (this.animStateCommand.jump[0] != 0) {
      this.locomotionType = LocomotionType.AIR;
    }
  
    // Apply an offset to Lara's position if one triggered.
    // TODO(tom): Unify this logic with Controller.prototype.update
    let offset = this.animStateCommand.offset;
    if (offset[0] != 0 || offset[1] != 0 || offset[2] != 0) {
      // TODO(tom): the correct thing to do here is to offset Lara's position so
      // that she's fully inside her sector after the updateSector_() call. For
      // now, just fudge the offset position.
      offset[2] += 1;
      mat4.mulVec(offset, animState.transform, offset);
      vec3.add(this.item.position, offset, this.item.position);
      this.updateSector_();
    }
  
    // TODO(tom): Remove this cached copy of the anim state.
    this.state_ = this.item.animState.anim.state;
  }

  private updateVelocity_(dt: number) {
    let animState = this.item.animState;
  
    // Calculate turning.
    let turn = 0;
    if (this.input_.left) {
      turn -= 1;
    }
    if (this.input_.right) {
      turn += 1;
    }
    switch (this.state_) {
      case State.SWIM: case State.SWIM_INERTIA:
        turn *= TURN_WATER_FAST;
        break;
      case State.SWIM_STOP:
      case State.TREAD_WATER_STOP:
      case State.TREAD_WATER_FORWARD:
      case State.TREAD_WATER_BACK:
      case State.TREAD_WATER_LEFT:
      case State.TREAD_WATER_RIGHT:
        turn *= TURN_WATER_SLOW;
        break;
      case State.RUN:
        // TODO(tom): tilt
        turn *= TURN_FAST;
        break;
      case State.TURN_FAST:
        turn *= TURN_FAST;
        break;
      case State.FAST_BACK:
        turn *= TURN_FAST_BACK;
        break;
      case State.WALK:
      case State.TURN_LEFT:
      case State.TURN_RIGHT:
      case State.STEP_LEFT:
      case State.STEP_RIGHT:
        turn *= TURN_NORMAL;
        break;
      case State.JUMP_FORWARD:
      case State.BACK:
        turn *= TURN_SLOW;
        break;
      default:
        turn = 0;
        break;
    }
    this.item.rotation[1] += dt * turn;
  
    // Calculate pitch.
    if (State.isSwimming(this.state_)) {
      let pitch = 0;
      if (this.input_.forward) {
        pitch -= TURN_WATER_SLOW;
      }
      if (this.input_.backward) {
        pitch += TURN_WATER_SLOW;
      }
      
      this.item.rotation[0] += dt * pitch;
      this.item.rotation[0] =
          Math.max(-0.45 * Math.PI, Math.min(0.45 * Math.PI, this.item.rotation[0]));
    } else if (animState.anim.id == AnimationId.TREAD_WATER_TO_SWIM) {
      this.item.rotation[0] =
          -(animState.frameIdx - animState.anim.firstFrame + animState.frameOfs) / 25;
    } else {
      this.item.rotation[0] = 0;
    }
  
    let speedX = 0;
    let speedZ = 0;
    if (this.locomotionType == LocomotionType.AIR) {
      if (this.velocity_[1] < 0) {
        let sector = this.item.room.getSectorByGrid(this.i_, this.j_);
        let ceiling = sector.getCeilingAt(this.item.position);
        if (this.item.position[1] - this.height_ < ceiling) {
          this.velocity_[1] = 0;
        }
      }
      this.velocity_[1] += GRAVITY * dt;
    } else if (this.locomotionType == LocomotionType.SWIM) {
      // Calculate a framerate independent scale factor.
      let scale = Math.exp(dt * Math.log(0.06));
      vec3.scale(this.velocity_, scale, this.velocity_);
      if (this.state_ == State.SWIM || this.state_ == State.DIVE) {
        this.velocity_[2] = Math.min(45, this.velocity_[2] + 150 * dt);
      }
    } else if (this.locomotionType == LocomotionType.TREAD_WATER) {
      // Calculate a framerate independent scale factor.
      let scale = Math.exp(dt * Math.log(0.06));
      vec3.scale(this.velocity_, scale, this.velocity_);
      switch (this.state_) {
        case State.TREAD_WATER_FORWARD:
          this.velocity_[2] = Math.min(20, this.velocity_[2] + 40 * dt);
          break;
        case State.TREAD_WATER_BACK:
          this.velocity_[2] = Math.max(-10, this.velocity_[2] - 20 * dt);
          break;
        case State.TREAD_WATER_LEFT:
          this.velocity_[0] = Math.max(-15, this.velocity_[0] - 30 * dt);
          break;
        case State.TREAD_WATER_RIGHT:
          this.velocity_[0] = Math.min(15, this.velocity_[0] + 30 * dt);
          break;
      }
    } else {
      let frameNum = animState.frameIdx - animState.anim.firstFrame;
      //let numFrames = 1 + animState.anim.lastFrame - animState.anim.firstFrame;
      let t = (frameNum + animState.frameOfs);
      let speed = animState.anim.speed + t * animState.anim.accel;
      switch (this.state_) {
        case State.SHIMMY_LEFT:
        case State.STEP_LEFT:
        case State.JUMP_LEFT:
          speedX = -speed;
          break;
        case State.SHIMMY_RIGHT:
        case State.STEP_RIGHT:
        case State.JUMP_RIGHT:
          speedX = speed;
          break;
        case State.BACK:
        case State.JUMP_BACK:
        case State.FAST_BACK:
        case State.SLIDE_BACK:
          speedZ = -speed;
          break;
        default:
          speedZ = speed;
          break;
      }
      this.velocity_[0] = speedX;
      this.velocity_[1] = 0;
      this.velocity_[2] = speedZ;
    }
  
    let jump = this.animStateCommand.jump;
    if (jump[0] != 0) {
      speedZ = jump[1];
      switch (this.state_) {
        case State.JUMP_BACK:
          speedZ = -speedZ;
          break;
        case State.JUMP_LEFT:
          speedX = -speedZ;
          speedZ = 0;
          break;
        case State.JUMP_RIGHT:
          speedX = speedZ;
          speedZ = 0;
          break;
      }
      this.velocity_[0] = speedX;
      this.velocity_[1] = jump[0];
      this.velocity_[2] = speedZ;
    }
  }

  private updatePosition_(dt: number) {
    let item = this.item;
    this.move_(dt);
  
    let floor = this.sector_.getFloorAt(item.position);
    let ceiling = this.sector_.getCeilingAt(item.position);
    switch (this.locomotionType) {
      case LocomotionType.GROUND:
        this.stepUpDown_(floor, dt);
        break;
  
      case LocomotionType.SLIDE:
        item.position[1] = floor;
        break;
  
      case LocomotionType.SWIM:
        item.position[1] += FPS * dt * this.velocity_[1];
        item.position[1] = Math.min(floor - this.radius_, item.position[1]);
        item.position[1] = Math.max(ceiling + this.radius_, item.position[1]);
        break;
  
      default:
        item.position[1] = Math.min(
            item.position[1] + FPS * dt * this.velocity_[1], floor);
        break;
    }
  
    item.animState.updateTransform(item.position, item.rotation);
  
    // Calculate Lara's sector grid row and column.
    this.i_ = Math.floor(this.item.position[0] / 1024);
    this.j_ = Math.floor(this.item.position[2] / 1024);
  
    // Figure out the primary cartesian direction Lara is facing.
    let dx = item.animState.transform[8];
    let dz = item.animState.transform[10];
  
    this.di_ = 0;
    this.dj_ = 0;
    if (Math.abs(dx) > Math.abs(dz)) {
      this.di_ = Math.sign(dx);
    } else {
      this.dj_ = Math.sign(dz);
    }
  
    this.findGrabSector_();
  }

  private stepUpDown_(floor: number, dt: number) {
    // Don't apply step up/down rules when pushing or pulling blocks, since
    // the block changes the height of the sector that Lara is standing on before
    // the animation finishes.
    if (this.state_ == State.PUSH_BLOCK ||
        this.state_ == State.PULL_BLOCK) {
      return;
    }
  
    let item = this.item;
  
    // Figure out if Lara is on her left or right foot. For most animations,
    // the left foot is up first.
    let numFrames =
        1 + item.animState.anim.lastFrame - item.animState.anim.firstFrame;
    let frameNum = item.animState.frameIdx - item.animState.anim.firstFrame;
    let onLeftFoot = frameNum < numFrames / 2;
    if (item.animState.anim.id == AnimationId.START_RUN) {
      onLeftFoot = !onLeftFoot;
    }
  
    // Handle transitioning into step up or down animtions.
    let floorDelta = Math.abs(floor - item.position[1]);
    let stepId = -1;
    if (floor < item.position[1]) {
      item.position[1] = Math.max(
          floor, item.position[1] - STEP_UP_DOWN_SPEED * dt);
      if (floorDelta >= 128 && (this.state_ == State.WALK || this.state_ == State.RUN)) {
        if (onLeftFoot) {
          stepId = this.state_ == State.WALK ? AnimationId.WALK_STEP_UP_L : AnimationId.RUN_STEP_UP_L;
        } else {
          stepId = this.state_ == State.WALK ? AnimationId.WALK_STEP_UP_R : AnimationId.RUN_STEP_UP_R;
        }
      }
    } else if (floor> item.position[1]) {
      item.position[1] = Math.min(
          floor, item.position[1] + STEP_UP_DOWN_SPEED * dt);
      if (floorDelta >= 128 && (this.state_ == State.WALK || this.state_ == State.BACK)) {
        if (onLeftFoot) {
          stepId = this.state_ == State.WALK ? AnimationId.WALK_STEP_DOWN_L : AnimationId.BACKSTEP_DOWN_L;
        } else {
          stepId = this.state_ == State.WALK ? AnimationId.WALK_STEP_DOWN_R : AnimationId.BACKSTEP_DOWN_L;
        }
      }
    }
  
    // Play the step up/down animation if we have one & snap to the ground.
    if (stepId != -1) {
      let stepAnim = this.scene.animations[stepId];
      if (item.animState.anim != stepAnim) {
        item.animState.setAnim(stepAnim, stepAnim.firstFrame);
      }
      item.position[1] = floor;
    }
  }
  
  private updateSector_() {
    let room = this.item.room;
    let position = this.item.position;
  
    this.sector_ = this.sector_.getResolvedSectorByPosition(position);
    this.item.room = this.sector_.room;
  
    if (this.sector_ != this.prevSector_) {
      this.updateTriggers_();
      this.prevSector_ = this.sector_;
    }
  }

  private logFloorData_() {
    if (this.sector_.floorData.funcs.length == 0) {
      return;
    }
  
    let lines = [];
    for (let i = 0; i < this.sector_.floorData.funcs.length; ++i) {
      let func = this.sector_.floorData.funcs[i];
      let activationMask = func.opcodes[0] >> 9;
      let once = (func.opcodes[0] >> 8) & 1;
  
      let line = `${i} type:${FloorFunc.Type[func.type]}`;
      if (func.type == FloorFunc.Type.TRIGGER) {
        line +=
            ` mask:${activationMask} once: ${once}` +
            ` func:${FloorFunc.TriggerFunc[func.sub]} (${func.sub})`;
      };
      lines.push(line);
  
      for (var j = 1; j < func.opcodes.length; ++j) {
        var opcode = func.opcodes[j];
        let op = (opcode >> 10) & 0xf;
        let operand = opcode & 0x3ff;
  
        switch (op) {
          case FloorFunc.Op.ITEM:
            line = `item idx: ${operand}`;
            if (operand < this.scene.items.length) {
              let itemType = this.scene.items[operand].id;
              line += ` type:${ItemType[itemType]} (${itemType})`;
            } else {
              line += ` out of range (${this.scene.items.length})`;
            }
            break;
  
          case FloorFunc.Op.PLAY_MUSIC:
            line = `music ${operand}`;
            break;
  
          case FloorFunc.Op.SECRET:
            line = `secret ${operand}`;
            break;
  
          case FloorFunc.Op.CLOCK_CONTROL:
          case FloorFunc.Op.CAMERA_SWITCH:
          case FloorFunc.Op.UNDERWATER_CURRENT:
          case FloorFunc.Op.ALTERNATE_ROOM:
          case FloorFunc.Op.ROOM_FLAGS_0:
          case FloorFunc.Op.ROOM_FLAGS_1:
          case FloorFunc.Op.LOOK_AT:
          case FloorFunc.Op.END_LEVEL:
            line = FloorFunc.Op[op].toLowerCase() + ' 0x' + operand.toString(16);
            break;
  
          default:
            line = `unknown<${op}> 0x${operand.toString(16)}`;
            break;
        }
  
        lines.push('    ' + line);
      }
    }
  
    console.log(lines.join('\n'));
  }
 

  private updateTriggers_() {
    this.logFloorData_();
  
    // TODO(tom): Figure out modifiers (Lara in the air, etc).
    for (let func of this.sector_.floorData.funcs) {
      let activationMask = func.opcodes[0] >> 9;
      let once = (func.opcodes[0] >> 8) & 1;
  
      for (let opcode of func.opcodes) {
        let op = (opcode >> 10) & 0xf;
        let operand = opcode & 0x3ff;
  
        if (once || op == FloorFunc.Op.SECRET) {
          if (this.oneOffTriggers_[operand]) {
            continue;
          }
          this.oneOffTriggers_[operand] = true;
        }
  
        // TODO(tom): Implement the rest of the functions
        switch (op) {
          case FloorFunc.Op.ITEM:
            break;
  
          case FloorFunc.Op.PLAY_MUSIC:
            audio.playTrack(operand);
            break;
  
          case FloorFunc.Op.SECRET:
            audio.playSecret();
            break;
        }
      }
    }
  }

  debugString() {
    let state = State[this.state_];
    let locomotion = LocomotionType[this.locomotionType];
    let speed = this.item.animState.anim.speed;
    let accel = this.item.animState.anim.accel;
    let vel = this.velocity_;
    let parts = [
        `room: ${this.item.room.id}`,
        `locomotion: ${locomotion} state: ${state}`,
        `speed: ${speed.toFixed(1)} accel: ${accel.toFixed(1)}`,
        `velocity: ${vel[0].toFixed(1)} ${vel[1].toFixed(1)} ${vel[2].toFixed(1)}`,
    ];
    return parts.join('\n');
  }
}
