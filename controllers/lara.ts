import * as mat4 from 'toybox/math/mat4';
import * as vec3 from 'toybox/math/vec3';

import * as audio from 'audio';

import {AnimationId} from 'animation';
import {Block} from 'controllers/block';
import {Intersection, moveCharacter, resolveRoomByGrid, resolveRoomByPosition} from 'collision';
import {Controller} from 'controllers/controller';
import {Switch} from 'controllers/switch';
import {EntityType} from 'entity/entity';
import {Item, Room, Scene, Sector, Trigger} from 'scene';
import {Input} from 'input';
import {SlidingConstraints} from 'sliding_constraints';
import {State} from 'state';

const GRAVITY = 180;
const FPS = 30;
const HANG_OFFSET = 730;

const MAX_PITCH = 0.45 * Math.PI;

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
const VAULT_HIGH_HEIGHT = 1792 + 128;

const STEP_UP_DOWN_SPEED = 2048;

const PICK_UP_FRAME_NORMAL = 40;
const PICK_UP_FRAME_UNDERWATER = 18;

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
  private input = new Input();
  private sector: Sector = null;
  private prevSector: Sector = null;
  private radius = 128;
  private height = 768;

  /** Lara's velocity (in character-local space). */
  private velocity = vec3.newZero();

  private state: State = State.STOP;

  /** Stored for debug rendering purposes. */
  collisions: CharacterCollision[] = [];

  private grabSector: Sector = null;
  private grabHeight = 0;
  private prevGrabTestPosition = vec3.newZero();
  private currGrabTestPosition = vec3.newZero();

  private interactingItem: Item = null;

  /**
   * the i'th column of the sector grid that corresponds to Lara's X coordinate.
   * this.i = math.floor(this.item.position[0] / 1024);
   */
  private i = 0;

  /**
   * the j'th row of the sector grid that corresponds to Lara's Z coordinate.
   * this.j = math.floor(this.item.position[2] / 1024);
   */
  private j = 0;

  /** If Lara is pointing mostly along the X axis, di == +/- 1 or 0 Otherwise. */
  private di = 0;
 
  /** If Lara is pointing mostly along the Z axis, dj == +/- 1 or 0 Otherwise. */
  private dj = 0;

  private getStateFuncs: Function[] = [];

  constructor(item: Item, scene: Scene) {
    super(item, scene);

    let anim = this.scene.animations[AnimationId.IDLE];
    item.animState.setAnim(anim, anim.firstFrame);

    this.getStateFuncs = [];
    this.getStateFuncs[LocomotionType.GROUND] = this.getStateGround.bind(this);
    this.getStateFuncs[LocomotionType.AIR] = this.getStateAir.bind(this);
    this.getStateFuncs[LocomotionType.HANG] = this.getStateHang.bind(this);
    this.getStateFuncs[LocomotionType.SLIDE] = this.getStateSlide.bind(this);
    this.getStateFuncs[LocomotionType.SWIM] = this.getStateSwim.bind(this);
    this.getStateFuncs[LocomotionType.TREAD_WATER] = this.getStateTreadWater.bind(this);

    // Uncomment to dump all of Lara's animations.
    //Animation.dumpGraph(this.scene.animations, item.animState.anim.id);

    if (scene.name == 'GYM.PHD') {
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
    } else if (scene.name == 'LEVEL01.PHD') {
      // caves - bridge
      vec3.setFromValues(item.position, 25122, 4352, 55814);
      item.rotation[1] = Math.PI;
      item.room = this.scene.rooms[13];

      // caves - switch
      // vec3.setFromValues(item.position, 50831, 7680, 57704);
      // item.rotation[1] = 1.5 * Math.PI;
      // item.room = this.scene.rooms[9];

      // caves - timed switch
      // vec3.setFromValues(item.position, 24447.9, 6912.0, 83495.9);
      // item.rotation[1] = 0.5 * Math.PI;
      // item.room = this.scene.rooms[26];

      // caves - secret
      // vec3.setFromValues(item.position, 66142, -2910, 52184);
      // item.rotation[1] = -0.4 * Math.PI;
      // item.room = this.scene.rooms[28];
    } else if (scene.name == 'LEVEL02.PHD') {
      // vilcabamba - underwater switch
      vec3.setFromValues(item.position, 71808, 1702, 18992);
      item.rotation[1] = -0.5 * Math.PI;
      item.room = this.scene.rooms[26];

      // vilcabamba - sprites
      // vec3.setFromValues(item.position, 72315, 0, 24906);
      // item.rotation[1] = 2.7925;
      // item.room = this.scene.rooms[15];

      // vilcabamba - jump
      // vec3.setFromValues(item.position, 31251, -2560, 24704);
      // item.rotation[1] = Math.PI
      // item.room = this.scene.rooms[43];

      // vilcabamba - portals
      // vec3.setFromValues(item.position, 75545, 0, 32897);
      // item.rotation[1] = -1.326450231515698;
      // item.room = this.scene.rooms[85];
    } else if (scene.name == 'LEVEL03A.PHD') {
      // lost valley - pick up
      // vec3.setFromValues(item.position, 27128, -3584, 1530);
      // item.rotation[1] = Math.PI;
      // item.room = this.scene.rooms[40];

      // lost valley - waterfall climb
      // vec3.setFromValues(item.position, 44539, 2624, 5248);
      // item.rotation[1] = -Math.PI;
      // item.room = this.scene.rooms[59];

      // lost valley - inside waterfall
      // vec3.setFromValues(item.position, 40831, -512, 2338);
      // item.rotation[1] = Math.PI;
      // item.room = this.scene.rooms[31];

      // lost valley - jump forwards onto slope gets lara stuck in fall state
      // because of floating point precision.
      vec3.setFromValues(item.position, 59683.7, 3584.0, 5786.6);
      item.rotation[1] = 2.76;
      item.room = this.scene.rooms[61];

      // lost valley - buried bridge pieces
      // vec3.setFromValues(item.position, 39351, 3584, 23691);
      // item.rotation[1] = Math.PI;
      // item.room = this.scene.rooms[56];
    } else if (scene.name == 'LEVEL04.PHD') {
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

      // st francis' folly - item
      // vec3.setFromValues(item.position, 43136, 10752, 34307);
      // item.rotation[1] = 1.5 * Math.PI;
      // item.room = this.scene.rooms[13];
    } else if (scene.name == 'LEVEL05.PHD') {
      // colosseum
      // item.position[0] = 81537;
      // item.position[1] = 0;
      // item.position[2] = 38783;
      // item.rotation[1] = 0;
      // item.room = this.scene.rooms[4];

      // colosseum - slamming door
      // vec3.setFromValues(this.item.position, 59031, -4608, 64042);
      // item.rotation[1] = 0.37;
      // item.room = this.scene.rooms[41];
    } else if (scene.name == 'LEVLE06.PHD') {
      // palace midas
      // item.position[0] = 37147;
      // item.position[1] = -4678;
      // item.position[2] = 29231;
      // item.rotation[1] = 0.5 * Math.PI;
      // item.room = this.scene.rooms[42];
    } else if (scene.name == 'LEVEL07A.PHD') {
      // the cistern - entrance
      // this.item.position[0] = 45549;
      // this.item.position[1] = -3328;
      // this.item.position[2] = 67050;
      // this.item.rotation[1] = 3.0892367362976074;
      // this.item.room = this.scene.rooms[7];

      // the cistern - block
      // vec3.setFromValues(this.item.position, 46207, -5632, 71234);
      // this.item.rotation[1] = -0.5 * Math.PI
      // this.item.room = this.scene.rooms[4];
      // vec3.setFromValues(this.scene.items[7].position, 45568, -5632, 71168);
      // this.scene.items[7].rotation[1] = -0.5 * Math.PI
      // this.scene.items[7].room = this.scene.rooms[4];
      // this.scene.items[7].room.getSectorByPosition(this.scene.items[7].position).floor -= 1024;
    }

    this.sector = this.item.room.getSectorByPosition(this.item.position);

    this.item.active = true;
  }

  getBoneTransform(bone: LaraBone) {
    return this.item.animState.meshTransforms[bone];
  }

  private updateGrabTestPosition() {
    vec3.setFromVec(this.prevGrabTestPosition, this.currGrabTestPosition);
  
    let leftTransform = this.getBoneTransform(LaraBone.LEFT_WRIST);
    let rightTransform = this.getBoneTransform(LaraBone.RIGHT_WRIST);
    for (let i = 0; i < 3; ++i) {
      // Offset the left and right wrist positions along the local Y axis to get
      // the grab test Position.
      let l = leftTransform[12 + i] + 48 * leftTransform[4 + i];
      let r = rightTransform[12 + i] + 48 * rightTransform[4 + i];
      this.currGrabTestPosition[i] = 0.5 * (l + r);
    }
  }
  
  /** Moves Lara according to her rotation & local velocity. */
  private move(dt: number) {
    let item = this.item;
    let animState = item.animState;
  
    this.collisions.length = 0;
    // Do nothing if Lara isn't moving.
    if (this.velocity[0] == 0 && this.velocity[2] == 0) {
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
    vec3.scale(z, FPS * dt * this.velocity[2], z);
    vec3.scale(x, FPS * dt * this.velocity[0], x);
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
              room, p, vv, this.radius, this.height, intersection,
              this.state)) {
          vec3.add(p, p, v);
          break;
        }
  
        let pos = vec3.scale(vec3.newZero(), -this.radius, intersection.geom.n);
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
  private nearSectorEdge(dis: number) {
    let position = this.item.position;
    let fx = position[0] % 1024;
    fx = fx >= 0 ? fx : fx + 1024;
    if (this.di == 1) {
      return fx > 1024 - dis;
    }
    if (this.di == -1) {
      return fx <= dis;
    }
  
    let fz = position[2] % 1024;
    fz = fz >= 0 ? fz : fz + 1024;
    if (this.dj == 1) {
      return fz > 1024 - dis;
    }
    if (this.dj == -1) {
      return fz <= dis;
    }
  
    throw new Error('Either di or dj should always be +/- 1');
  }

  findGrabSector() {
    this.grabSector = null;
    this.grabHeight = 0;
  
    let position = this.item.position;
    // Get (i, j) index of potential grab sector.
    let i = this.i + this.di;
    let j = this.j + this.dj;
  
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
    // TODO(tom): there's a bug here (which is also present in TR1): if there's
    // an overhang that Lara should be able to vault up, it won't be detected
    // here. A good example is the room in Vilcabamba with the collapsing floor
    // and pullable block (just before you get the key): pull the block back
    // one tile, climb up and try to vault up to the ledge with the large
    // medipack.
    let floor = sector.getFloorAt(position);
    let ceiling = sector.getCeilingAt(position);
    let dy = this.item.position[1] - floor;
    if (dy > VAULT_HIGH_HEIGHT) {
      return;
    }

    // Don't let Lara grab blocks that tightly fit into a hole.
    if (floor <= ceiling) {
      return;
    }

    if (this.state == State.TREAD_WATER_STOP ||
        this.state == State.TREAD_WATER_FORWARD) {
      if (sector.floor >= this.sector.floor ||
          this.sector.floor - sector.floor > 256 + 128) {
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
      let maxCeiling = Math.max(this.sector.getCeilingAt(position), ceiling);
      if (floor - maxCeiling < this.height) {
        return;
      }
    }
  
    // Check that the floor slope is not too steep.
    if (this.di != 0) {
      if (Math.abs(sector.floorData.floorSlope[1]) > 512) {
        return;
      }
    } else {
      if (Math.abs(sector.floorData.floorSlope[0]) > 512) {
        return;
      }
    }
  
    // Check that Lara is close enough to the next sector to potentially grab it.
    if (!this.nearSectorEdge(this.radius + 1)) {
      return;
    }

    // All tests pass, we found a grab candidate.
    this.grabSector = sector;
    this.grabHeight = floor;
  }
 

  update(dt: number) {
    // TODO(tom): refactor Controller.update and Lara.update we can call
    // super.update(dt) here.

    let item = this.item;
    let animState = item.animState;
    let prevFrameIdx = animState.frameIdx;
  
    this.input.update();
  
    this.locomotionType = this.getLocomotionType();
    this.updateState(dt);
    this.updateTriggers();
    this.updateVelocity(dt);
    this.updatePosition(dt);
    this.updateSector();
  
    animState.anim.getFrame(
        animState.frameIdx, animState.frameOfs, animState.frame);
    animState.setMeshTransforms(
        item.moveable.meshCount, item.moveable.meshTree, this.scene.meshTrees);
    if (animState.frameIdx != prevFrameIdx) {
      this.onAnimFrameChange();
    }

    this.updateGrabTestPosition();
  }

  private getLocomotionType() {
    let sector = this.sector;
  
    if (State.isHanging(this.state)) {
      return LocomotionType.HANG;
    }

    if (State.isTreadingWater(this.state)) {
      // For places like the river at the top of Lost Valley: fall if Lara can't
      // possibly be treading water anymore.
      if (!sector.roomBelow || !sector.roomBelow.isUnderwater()) {
        return LocomotionType.AIR;
      }
      return LocomotionType.TREAD_WATER;
    }
  
    if (this.item.room.isUnderwater()) {
      if (State.isSwimming(this.state)) {
        if (sector.roomAbove && !sector.roomAbove.isUnderwater() &&
            this.item.position[1] - this.radius < sector.ceiling) {
          return LocomotionType.TREAD_WATER;
        }
      } else {
        // Don't transition to swim until Lara's hips are underwater.
        let v = vec3.newZero();
        mat4.getTranslation(
            v, this.item.animState.meshTransforms[LaraBone.PELVIS]);
        if (v[1] < sector.ceiling) {
          return this.locomotionType;
        }
        if (this.state == State.SWAN_DIVE) {
          // On entering the water from a swan dive, take Lara's pitch from her
          // pelvis transform.
          let m = this.item.animState.meshTransforms[LaraBone.PELVIS];
          this.item.rotation[0] = Math.asin(m[5]);
        }
      }
      return LocomotionType.SWIM;
    } else {
      if (State.isSwimming(this.state)) {
        return LocomotionType.AIR;
      }
    }
  
    if (this.state == State.DIVE) {
      return LocomotionType.SWIM;
    }
    if (State.isSwimming(this.state)) {
      if (sector.roomBelow && sector.roomBelow.isUnderwater()) {
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
      if (this.item.position[1] + 1 >= floor) {
        this.item.position[1] = floor;
        let animState = this.item.animState;
        if (this.velocity[1] >= 0 ||
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

  private tryInteraction() {
    let room = resolveRoomByGrid(
        this.item.room, this.i, this.j, this.item.position[1]);
    let sector = room.getSectorByGrid(this.i, this.j);

    for (let item of this.scene.items) {
      if (item == this.item) {
        continue;
      }
 
      if (item.isPickup()) {
        if (item.visible &&
            item.room == room &&
            this.item.animState.canChangeState(State.PICK_UP) &&
            vec3.distance(item.position, this.item.position) < 320) {
          this.interactingItem = item;
          return State.PICK_UP;
        }
      } else if (item.isBlock()) {
        // Lara must be near a sector edge in order to grab a block.
        if (!this.nearSectorEdge(this.radius + 1)) {
          continue;
        }
        if (this.i + this.di == Math.floor(item.position[0] / 1024) &&
            this.j + this.dj == Math.floor(item.position[2] / 1024) &&
            this.item.position[1] == item.position[1]) {
          this.interactingItem = item;
          if (this.state == State.PUSH_READY) {
            if (this.input.forward || this.input.backward) {
              let di, dj: number;
              let targetRoom: Room;
              let laraState: State;
              let blockState: Block.State;
              if (this.input.forward) {
                // Trying to push the block forwards: check whether there's
                // space in front of the block (start from the block's room).
                [di, dj, targetRoom] = [2 * this.di, 2 * this.dj, item.room];
                [laraState, blockState] = [State.PUSH_BLOCK, Block.State.PUSH];
              } else {
                // Trying to push the block backwards: check whether there's
                // space in behind Lara  (start from Lara's room).
                [di, dj, targetRoom] = [-this.di, -this.dj, room];
                [laraState, blockState] = [State.PULL_BLOCK, Block.State.PULL];
              }
              if (this.item.animState.canChangeState(laraState) &&
                  this.canPushBlockTo(targetRoom, this.i + di, this.j + dj, item.position[1])) {
                item.rotation[1] = this.item.rotation[1];
                item.controller.changeState(blockState);
                item.controller.activate();
                return laraState;
              }
            }
            return State.PUSH_READY;
          } else if (!this.input.forward) {
            this.alignToAxis();
            return State.PUSH_READY;
          }
          return State.NONE;
        }
      }
    }

    return State.NONE;
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
  private canPushBlockTo(room: Room, i: number, j: number, y: number) {
    // TODO(tom): check for trap doors
    room = resolveRoomByGrid(room, i, j, y);
    if (room == null) { return false; }
    let sector = room.getSectorByGrid(i, j);
    if (sector == null) { return false; }
    return (sector.floor == y &&
            sector.floorData.floorSlope[0] == 0 &&
            sector.floorData.floorSlope[1] == 0);
  }
  
  private alignToAxis() {
    this.item.rotation[1] = Math.atan2(this.di, this.dj);
  }
  
  private getStateGround() {
    let forward = this.input.forward;
    let backward = this.input.backward;
    let left = this.input.left;
    let right = this.input.right;
    let action = this.input.action;
    let stepLeft = this.input.stepLeft;
    let stepRight = this.input.stepRight;
    let jump = this.input.jump;
    let walk = this.input.walk;
    
    // Handle transition from fall.
    if (this.state == State.FALL) {
      if (!this.item.animState.canChangeState(State.STOP)) {
        let anim = this.scene.animations[AnimationId.LAND];
        this.item.animState.setAnim(anim, anim.firstFrame);
      }
      return State.STOP;
    }
  
    // Handle transition from jump.
    if (State.isJumping(this.state)) {
      let position = this.item.position;
      if (this.velocity[1] < 0) {
        let anim = this.scene.animations[AnimationId.LAND];
        this.item.animState.setAnim(anim, anim.firstFrame);
        this.velocity[1] = 0;
      }
      if (this.state == State.JUMP_FORWARD && forward && !walk) { return State.RUN; }
      return State.STOP;
    }
  
    // Handle transition from slide
    if (this.state == State.SLIDE || this.state == State.SLIDE_BACK) {
      return State.STOP;
    }
  
    // Jump
    if (this.state == State.COMPRESS) {
      if (forward) { return State.JUMP_FORWARD; }
      if (backward) { return State.JUMP_BACK; }
      if (left) { return State.JUMP_LEFT; }
      if (right) { return State.JUMP_RIGHT; }
      return this.state;
    }
    if (jump) {
      if (this.state == State.RUN) { return State.JUMP_FORWARD; }
      if (this.state == State.STOP) { return State.COMPRESS; }
    }
  
    // Side step
    if (this.state == State.STEP_LEFT) {
      return stepLeft && !stepRight ? State.STEP_LEFT : State.STOP;
    }
    if (this.state == State.STEP_RIGHT) {
      return stepRight && !stepLeft ? State.STEP_RIGHT : State.STOP;
    }
    if (this.state == State.STOP) {
      if (stepLeft && !stepRight) { return State.STEP_LEFT; }
      if (stepRight && !stepLeft) { return State.STEP_RIGHT; }
    }
  
    // Push or pull block
    if (this.state == State.PUSH_BLOCK ||
        this.state == State.PULL_BLOCK) {
      return this.state;
    }
    if (action) {
      let state = this.tryInteraction();
      if (state != State.NONE) {
        return state;
      }
    }
  
    // Climb up
    if (this.grabSector != null && forward && action) {
      // Perform a hard transition from walk or run to idle.
      // This allows Lara to go straight from run or walk into climb up without
      // having to stop.
      if (this.state == State.WALK || this.state == State.RUN) {
        this.hardTransitionToIdle();
      }

      if (this.item.animState.anim.id == AnimationId.IDLE) {
        let dy = this.item.position[1] - this.grabHeight;
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
          this.alignToAxis();
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
    if (this.state == State.STOP || this.state == State.TURN_FAST ||
        this.state == State.TURN_LEFT || this.state == State.TURN_RIGHT) {
      if (left != right) {
        if (this.state == State.TURN_FAST) {
          return this.state;
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
      if (this.state != State.STOP) {
        return State.STOP;
      }
    }
  
    // Backward
    if (backward) {
      if (this.state == State.RUN || this.state == State.WALK) { return State.STOP }
      if (this.state == State.BACK && !walk) { return State.STOP; }
      return walk ? State.BACK : State.FAST_BACK;
    }
  
    return State.STOP;
  }

  private hardTransitionToIdle() {
    let anim = this.scene.animations[AnimationId.IDLE];
    this.item.animState.setAnim(anim, anim.firstFrame);
    this.state = State.STOP;
  }

  private getStateAir() {
    let forward = this.input.forward;
    let action = this.input.action;
    let walk = this.input.walk;
  
    // Handle transitions from ground.
    if (!State.isJumping(this.state) && this.state != State.FALL) {
      // TODO(tom): Figure out how to do this properly
      if (this.state == State.FAST_BACK) {
        this.velocity[2] = -6;
      }
      let anim = this.scene.animations[AnimationId.START_DROP];
      this.item.animState.setAnim(anim, anim.firstFrame);
      return this.item.animState.anim.state;
    }
  
    if (this.velocity[1] > FALL_SPEED) {
      return State.FALL;
    }
  
    if ((this.state == State.REACH || this.state == State.JUMP_UP) && action) {
      let di = this.di;
      let dj = this.dj;
  
      let prevPos = this.prevGrabTestPosition;
      let currPos = this.currGrabTestPosition;
  
      // Get the adjacent sector in that direction.
      let grabDistance = this.radius + 32;
  
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
      let grabCeiling = grabSector.getCeilingAt(v);
  
      // If Lara passed by the grab point this frame, transition to the HANG state.
      let minY = Math.min(currPos[1], prevPos[1]);
      let maxY = Math.max(currPos[1], prevPos[1]);
      if (grabFloor > grabCeiling && minY <= grabFloor && maxY >= grabFloor) {
        // TODO(tom): Probably don't want to simply use HANG and the +15 frame
        // offset here. Figure out how these three animations should be used:
        //   29 "jump_up_catch_edge"
        //   96 "hang"
        //   150 "catch_edge_no_wall"
        let anim = this.scene.animations[AnimationId.HANG];
        let frame = anim.firstFrame;
        if (this.state == State.JUMP_UP) {
          frame += 15;
        }
        this.item.animState.setAnim(anim, frame);
        this.item.rotation[1] = Math.atan2(di, dj);
        grabSector.getNearestFloorPosition(this.item.position, this.item.position);
        // Snap Lara to the grab position
        this.item.position[0] -= this.radius * di;
        this.item.position[1] = grabFloor + HANG_OFFSET;
        this.item.position[2] -= this.radius * dj;
        this.velocity.fill(0);
        return State.HANG;
      }
    }
  
    let position = this.item.position;
    let floor = this.sector.getFloorAt(position);
    if (floor == position[1]) {
      if (forward) { return State.RUN; }
      return State.STOP;
    }
  
    if (action && this.state != State.JUMP_UP) { return State.REACH; }
  
    if (walk) { return State.SWAN_DIVE; }
  
    return this.state;
  }

  private getStateHang() {
    let forward = this.input.forward;
    let left = this.input.left;
    let right = this.input.right;
    let action = this.input.action;
    let walk = this.input.walk;
  
    // Get the sector that Lara is hanging from.
    let di = this.di;
    let dj = this.dj;
    let hy = this.currGrabTestPosition[1] - 64;
    let hi = this.i + di;
    let hj = this.j + dj;
    let currHangSector = this.sector.getResolvedSectorByGrid(hi, hj, hy);
    let currHangRoom = currHangSector.room;
  
    // Get the height of the floor at the point Lara is hanging from.
    let hangFloor = currHangSector.getFloorAt(this.item.position);
  
    // Determine whether Lara is currently, or about to start, shimmying left or
    // right. Favour checking her actual state over what the requested state is
    // based on the input state, to correctly handle the case where Lara is
    // partway through shimmying in one direction and the input is pointing in the
    // opposite direction.
    let checkLeft, checkRight;
    if (this.state == State.SHIMMY_LEFT || this.state == State.SHIMMY_RIGHT) {
      checkLeft = this.state == State.SHIMMY_LEFT;
      checkRight = this.state == State.SHIMMY_RIGHT;
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
        ni = this.i - dj;
        nj = this.j + di;
        nhi = hi - dj;
        nhj = hj + di;
      } else {
        ni = this.i + dj;
        nj = this.j - di;
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
        canShimmy = Math.abs(di * dz - dj * dx) > this.radius + 1;
      }
  
      // Check that the ground below Lara hasn't sloped up so much that it blocks
      // the shimmy.
      if (canShimmy) {
        let ahead = vec3.newFromVec(this.item.position);
        if (checkLeft) {
          ahead[0] -= this.radius * dj;
          ahead[2] += this.radius * di;
        } else {
          ahead[0] += this.radius * dj;
          ahead[2] -= this.radius * di;
        }
        let aheadFloor = this.sector.getFloorAt(ahead);
        let aheadHang = currHangSector.getFloorAt(ahead);
        canShimmy = aheadHang + HANG_OFFSET < aheadFloor;
      }
    }
  
    if (this.state == State.SHIMMY_LEFT || this.state == State.SHIMMY_RIGHT) {
      this.item.position[1] = hangFloor + HANG_OFFSET;
  
      if (!canShimmy) {
        vec3.setFromValues(this.velocity, 0, 0, 0);
        let anim = this.scene.animations[AnimationId.HANG];
        this.item.animState.setAnim(anim, anim.firstFrame + 21);
        return State.HANG;
      }
  
      if (this.state == State.SHIMMY_LEFT) {
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
          this.sector.getCeilingAt(this.item.position));
      if (hangCeiling - hangFloor < -this.height) {
        return walk ? State.HANDSTAND : State.HANG_UP;
      }
    }
    if (left && canShimmy) { return State.SHIMMY_LEFT; }
    if (right && canShimmy) { return State.SHIMMY_RIGHT; }
  
    if (action || this.state == State.HANG_UP || this.state == State.HANDSTAND ||
        this.state == State.WATER_OUT) {
      return State.HANG;
    }
  
    // Let go.
    vec3.setFromValues(this.velocity, 0, 0, 0);
    this.item.position[1] += 128;
    let anim = this.scene.animations[AnimationId.JUMP_UP];
    this.item.animState.setAnim(anim, anim.firstFrame);
    this.locomotionType = LocomotionType.AIR;
    return State.JUMP_UP;
  }

  private getStateSlide() {
    let jump = this.input.jump;
  
    // Starting a jump from slide takes a few frames so don't do any state
    // handling during that time, otherwise we may mess up the transition to
    // the actual jump.
    if (this.item.animState.anim.id == AnimationId.START_JUMP_FORWARD ||
        this.item.animState.anim.id == AnimationId.START_JUMP_BACK) {
      return this.state;
    }
  
    let back: boolean;
    let sx = this.sector.floorData.floorSlope[0];
    let sz = this.sector.floorData.floorSlope[1];
    let dx = this.item.animState.transform[8];
    let dz = this.item.animState.transform[10];
    if (Math.abs(sx) > Math.abs(sz)) {
      back = (dx * sx) > 0;
      if (back) {
        this.item.rotation[1] = ((sx > 0) ? 0.5 : 1.5) * Math.PI;
      } else {
        this.item.rotation[1] = ((sx > 0) ? 1.5 : 0.5) * Math.PI;
      }
    } else {
      back = (dz * sz) > 0;
      if (back) {
        this.item.rotation[1] = ((sz > 0) ? 0 : 1) * Math.PI;
      } else {
        this.item.rotation[1] = ((sz > 0) ? 1 : 0) * Math.PI;
      }
    }

    if (back) {
      if (this.state != State.SLIDE_BACK) {
        let anim = this.scene.animations[AnimationId.START_BACK_SLIDE];
        this.item.animState.setAnim(anim, anim.firstFrame);
        this.state = State.SLIDE_BACK;
      }
    } else {
      if (this.state != State.SLIDE) {
        let anim = this.scene.animations[AnimationId.SLIDE];
        this.item.animState.setAnim(anim, anim.firstFrame);
        this.state = State.SLIDE;
      }
    }
  
    if (jump) {
      if (this.state == State.SLIDE_BACK) {
        return State.JUMP_BACK;
      } else if (this.state == State.SLIDE) {
        return State.JUMP_FORWARD;
      }
    }
  
    return this.state;
  }

  private getStateSwim() {
    if (this.input.action) {
      let state = this.tryInteraction();
      if (state != State.NONE) {
        return state;
      }
    }

    if (this.state == State.STOP && this.locomotionType == LocomotionType.SWIM) {
      let anim = this.scene.animations[AnimationId.SWIM_STOP];
      this.item.animState.setAnim(anim, anim.firstFrame);
      return State.SWIM_STOP;
    }

    // Handle transition from fall or jump.
    if (this.state == State.FALL || State.isJumping(this.state)) {
      let anim;
      if (this.item.animState.anim.id == AnimationId.SWAN_DIVE) {
        anim = this.scene.animations[AnimationId.SWAN_DIVE_TO_SWIM];
      } else {
        anim = this.scene.animations[AnimationId.DROP_TO_SWIM];
      }
      this.item.animState.setAnim(anim, anim.firstFrame);
      return State.SWIM;
    }
  
    let jump = this.input.jump;
    if (jump) {
      return State.SWIM;
    }
    
    if (this.state == State.SWIM_INERTIA || this.state == State.STOP) {
      return State.SWIM_STOP;
    }
  
    return State.SWIM_INERTIA;
  }

  private getStateTreadWater() {
    // Handle transition from swim.
    if (this.state == State.SWIM ||
        this.state == State.SWIM_INERTIA ||
        this.state == State.SWIM_STOP ) {
      if (this.item.room.isUnderwater()) {
        this.item.room = this.sector.roomAbove;
        this.sector = this.item.room.getSectorByPosition(this.item.position);
      }
      let anim = this.scene.animations[AnimationId.SWIM_TO_TREAD_WATER];
      this.item.animState.setAnim(anim, anim.firstFrame);
      this.item.rotation[0] = 0;
      vec3.setFromValues(this.velocity, 0, 0, 0);
      this.item.position[1] = this.sector.floor - 32;
    }
  
    if (this.grabSector != null &&
        this.input.forward && this.input.action) {
      let anim = this.scene.animations[AnimationId.LEAVE_WATER];
      this.alignToAxis();
      this.item.animState.setAnim(anim, anim.firstFrame);
      this.grabSector.getNearestFloorPosition(
          this.item.position, this.item.position);
      this.item.position[0] += 0.75 * this.radius * this.di;
      this.item.position[2] += 0.75 * this.radius * this.dj;
      return State.WATER_OUT;
    }
  
    if (this.input.forward) { return State.TREAD_WATER_FORWARD; }
    if (this.input.backward) { return State.TREAD_WATER_BACK; }
    if (this.input.stepLeft) { return State.TREAD_WATER_LEFT; }
    if (this.input.stepRight) { return State.TREAD_WATER_RIGHT; }
    if (this.input.jump &&
        this.item.animState.anim.id != AnimationId.SWIM_TO_TREAD_WATER) {
      let anim = this.scene.animations[AnimationId.TREAD_WATER_TO_SWIM];
      this.item.animState.setAnim(anim, anim.firstFrame);
      this.item.position[1] = this.sector.floor + 1;
      this.item.room = this.sector.getResolvedSectorByPosition(
          this.item.position).room;
      return State.DIVE;
    }
  
    return State.TREAD_WATER_STOP;
  }
  
  private getStateDefault() {
    if (this.state == State.SWAN_DIVE || this.state == State.RUN) {
      return this.state;
    }
    return this.state;
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
  
  private updateState(dt: number) {
    // Try and change Lara's state.
    let targetState = this.getStateFuncs[this.locomotionType]();
    if (targetState != this.item.animState.anim.state) {
      if (!this.item.animState.tryChangeState(targetState)) {
        let defaultState = this.getStateDefault();
        if (defaultState != this.state && defaultState != targetState) {
          console.log(
              `can\'t transition from ${State[this.state]} to` +
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
      // that she's fully inside her sector after the updateSector() call. For
      // now, just fudge the offset position.
      offset[2] += 1;
      mat4.mulVec(offset, animState.transform, offset);
      vec3.add(this.item.position, offset, this.item.position);
      this.updateSector();
    }

    // TODO(tom): Remove this cached copy of the anim state.
    this.state = this.item.animState.anim.state;
  }

  protected onAnimFrameChange() {
    let animState = this.item.animState;
    if (this.state == State.PICK_UP) {
      let frame = this.item.room.isUnderwater() ? PICK_UP_FRAME_UNDERWATER :
                                                  PICK_UP_FRAME_NORMAL;
      if (animState.frameIdx - animState.anim.firstFrame == frame) {
        this.interactingItem.controller.deactivate();
        this.interactingItem.visible = false;
      }
    }
  }

  private updateVelocity(dt: number) {
    let animState = this.item.animState;
  
    // Calculate turning.
    let turn = 0;
    if (this.input.left) {
      turn -= 1;
    }
    if (this.input.right) {
      turn += 1;
    }
    switch (this.state) {
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
    this.item.rotation[1] = (this.item.rotation[1] + dt * turn) % (2 * Math.PI);
  
    // Calculate pitch.
    // TODO(tom): need to continue rotating during swan dive.
    if (State.isSwimming(this.state)) {
      let pitch = 0;
      if (this.input.forward) {
        pitch -= TURN_WATER_SLOW;
      }
      if (this.input.backward) {
        pitch += TURN_WATER_SLOW;
      }
      
      this.item.rotation[0] += dt * pitch;
      this.item.rotation[0] =
          Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.item.rotation[0]));
    } else if (animState.anim.id == AnimationId.TREAD_WATER_TO_SWIM) {
      this.item.rotation[0] =
          -(animState.frameIdx - animState.anim.firstFrame + animState.frameOfs) / 25;
    } else if (this.state != State.DIVE) {
      this.item.rotation[0] = 0;
    }
  
    let speedX = 0;
    let speedZ = 0;
    if (this.locomotionType == LocomotionType.AIR) {
      if (this.velocity[1] < 0) {
        let sector = this.item.room.getSectorByGrid(this.i, this.j);
        let ceiling = sector.getCeilingAt(this.item.position);
        if (this.item.position[1] - this.height < ceiling) {
          this.velocity[1] = 0;
        }
      }
      this.velocity[1] += GRAVITY * dt;
    } else if (this.locomotionType == LocomotionType.SWIM) {
      // Calculate a framerate independent scale factor.
      let scale = Math.exp(dt * Math.log(0.06));
      vec3.scale(this.velocity, scale, this.velocity);
      if (this.state == State.SWIM || this.state == State.DIVE) {
        this.velocity[2] = Math.min(45, this.velocity[2] + 150 * dt);
      }
    } else if (this.locomotionType == LocomotionType.TREAD_WATER) {
      // Calculate a framerate independent scale factor.
      let scale = Math.exp(dt * Math.log(0.06));
      vec3.scale(this.velocity, scale, this.velocity);
      switch (this.state) {
        case State.TREAD_WATER_FORWARD:
          this.velocity[2] = Math.min(20, this.velocity[2] + 40 * dt);
          break;
        case State.TREAD_WATER_BACK:
          this.velocity[2] = Math.max(-10, this.velocity[2] - 20 * dt);
          break;
        case State.TREAD_WATER_LEFT:
          this.velocity[0] = Math.max(-15, this.velocity[0] - 30 * dt);
          break;
        case State.TREAD_WATER_RIGHT:
          this.velocity[0] = Math.min(15, this.velocity[0] + 30 * dt);
          break;
      }
    } else {
      let frameNum = animState.frameIdx - animState.anim.firstFrame;
      //let numFrames = 1 + animState.anim.lastFrame - animState.anim.firstFrame;
      let t = (frameNum + animState.frameOfs);
      let speed = animState.anim.speed + t * animState.anim.accel;
      switch (this.state) {
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
      this.velocity[0] = speedX;
      this.velocity[1] = 0;
      this.velocity[2] = speedZ;
    }
  
    let jump = this.animStateCommand.jump;
    if (jump[0] != 0) {
      speedZ = jump[1];
      switch (this.state) {
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
      this.velocity[0] = speedX;
      this.velocity[1] = jump[0];
      this.velocity[2] = speedZ;
    }
  }

  private updatePosition(dt: number) {
    let item = this.item;
    this.move(dt);
  
    let floor = this.sector.getFloorAt(item.position);
    let ceiling = this.sector.getCeilingAt(item.position);
    switch (this.locomotionType) {
      case LocomotionType.GROUND:
        this.stepUpDown(floor, dt);
        break;
  
      case LocomotionType.SLIDE:
        item.position[1] = floor;
        break;
  
      case LocomotionType.SWIM:
        item.position[1] += FPS * dt * this.velocity[1];
        item.position[1] = Math.min(floor - this.radius, item.position[1]);
        item.position[1] = Math.max(ceiling + this.radius, item.position[1]);
        break;
  
      default:
        item.position[1] = Math.min(
            item.position[1] + FPS * dt * this.velocity[1], floor);
        break;
    }
  
    item.animState.updateTransform(item.position, item.rotation);
  
    // Calculate Lara's sector grid row and column.
    this.i = Math.floor(this.item.position[0] / 1024);
    this.j = Math.floor(this.item.position[2] / 1024);
  
    // Figure out the primary cartesian direction Lara is facing.
    let dx = item.animState.transform[8];
    let dz = item.animState.transform[10];
  
    this.di = 0;
    this.dj = 0;
    if (Math.abs(dx) > Math.abs(dz)) {
      this.di = Math.sign(dx);
    } else {
      this.dj = Math.sign(dz);
    }
  
    this.findGrabSector();
  }

  private stepUpDown(floor: number, dt: number) {
    // Don't apply step up/down rules when pushing or pulling blocks, since
    // the block changes the height of the sector that Lara is standing on before
    // the animation finishes.
    if (this.state == State.PUSH_BLOCK ||
        this.state == State.PULL_BLOCK) {
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
      if (floorDelta >= 128 && (this.state == State.WALK || this.state == State.RUN)) {
        if (onLeftFoot) {
          stepId = this.state == State.WALK ? AnimationId.WALK_STEP_UP_L : AnimationId.RUN_STEP_UP_L;
        } else {
          stepId = this.state == State.WALK ? AnimationId.WALK_STEP_UP_R : AnimationId.RUN_STEP_UP_R;
        }
      }
    } else if (floor> item.position[1]) {
      item.position[1] = Math.min(
          floor, item.position[1] + STEP_UP_DOWN_SPEED * dt);
      if (floorDelta >= 128 && (this.state == State.WALK || this.state == State.BACK)) {
        if (onLeftFoot) {
          stepId = this.state == State.WALK ? AnimationId.WALK_STEP_DOWN_L : AnimationId.BACKSTEP_DOWN_L;
        } else {
          stepId = this.state == State.WALK ? AnimationId.WALK_STEP_DOWN_R : AnimationId.BACKSTEP_DOWN_L;
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
  
  private updateSector() {
    let room = this.item.room;
    let position = this.item.position;
  
    this.sector = this.sector.getResolvedSectorByPosition(position);
    this.item.room = this.sector.room;
  
    if (this.sector != this.prevSector) {
      this.logFloorData();
      this.prevSector = this.sector;
    }
  }

  private logFloorData() {
    let sector = this.sector.getResolvedFloorSector();
    let floorData = sector.floorData;

    let lines = [];
    if (floorData.kill) {
      lines.push('KILL');
    }
    if (floorData.climbableWalls) {
      lines.push(`CLIMB:${floorData.climbableWalls}`);
    }

    let trigger = floorData.trigger;
    if (trigger != null) {
      lines.push(`TRIGGER type:${Trigger.Type[trigger.type]} ` +
                 `timer:${trigger.timer} ` +
                 `mask:0x${trigger.mask.toString(16)} ` +
                 `oneShot:${trigger.oneShot}`);

      for (let action of trigger.actions) {
        let line: string;

        switch (action.type) {
          case Trigger.Action.Type.ACTIVATE:
            line = `action:ACTIVATE idx:${action.parameter}`;
            if (action.parameter < this.scene.items.length) {
              let itemType = this.scene.items[action.parameter].type;
              let typeName = EntityType[itemType];
              if (typeName == null) { typeName = `UNDEFINED<${itemType}>`; }
              line += ` type:${typeName}`;
            } else {
              line += ` out of range (${this.scene.items.length})`;
            }
            line += ` mask:0x${this.scene.items[action.parameter].activeMask.toString(16)}`;
            break;

          case Trigger.Action.Type.PLAY_MUSIC:
            line = `action:PLAY_MUSIC track:${action.parameter}`;
            break;

          case Trigger.Action.Type.SECRET:
            line = `action:SECRET idx:${action.parameter}`;
            break;

          case Trigger.Action.Type.CAMERA_SWITCH:
            let time = action.parameter2 & 0xff;
            let once = ((action.parameter2 >> 8) & 1) == 0;
            let moveTimer = (action.parameter2 >> 9) & 0x1f;
            line = `action:CAMERA idx:${action.parameter} time:${time} once:${once} move:${moveTimer}`;
            break;

          case Trigger.Action.Type.FLIP_EFFECT:
          case Trigger.Action.Type.UNDERWATER_CURRENT:
          case Trigger.Action.Type.FLIP_MAP:
          case Trigger.Action.Type.FLIP_ON:
          case Trigger.Action.Type.FLIP_OFF:
          case Trigger.Action.Type.LOOK_AT:
          case Trigger.Action.Type.END_LEVEL:
            line = `action:${Trigger.Action.Type[action.type]} 0x${action.parameter.toString(16)}`;
            break;

          default:
            line = `action:UNKNOWN<${action}> 0x${action.parameter.toString(16)}`;
            break;
        }

        lines.push('    ' + line);
      }
    }
  
    if (lines.length != 0) {
      console.log(lines.join('\n'));
    }
  }

  private updateTriggers() {
    let sector = this.sector.getResolvedFloorSector();
    let trigger = sector.floorData.trigger;
    if (trigger == null) {
      return;
    }

    let actionStart = 0;
    let runActions = false;

    switch (trigger.type) {
      case Trigger.Type.TRIGGER_ON:
        runActions = true;
        break;

      case Trigger.Type.PAD_ON:
      case Trigger.Type.PAD_OFF:
        // Skip pad triggers if Lara isn't on the ground.
        if (this.locomotionType != LocomotionType.GROUND) {
          return;
        }
        runActions = true;
        break;

      case Trigger.Type.SWITCH:
        // TODO(tom): write a proper interaction test function
        if (!this.input.action ||
            !this.nearSectorEdge(this.radius + 16)) {
          return;
        }

        // Stop immediately if Lara runs into a switch with the action button
        // pressed. This makes the switch behaviour match the vaulting
        // behaviour, but differs from the original game (in which Lara would
        // first play a stopping animation).
        if (this.state == State.WALK || this.state == State.RUN) {
          this.hardTransitionToIdle();
        }

        actionStart = 1;
        let switchItem = this.scene.items[trigger.actions[0].parameter];
        let laraState, switchState: number;
        if (switchItem.animState.anim.state == Switch.State.DOWN) {
          switchState = Switch.State.UP;
          // Like normal switches, underwater switches have both an "up" and
          // a "down" state, however there Lara only has an underwater
          // "pull down" animation.
          if (this.locomotionType == LocomotionType.GROUND) {
            laraState = State.SWITCH_UP;
          } else {
            laraState = State.SWITCH_DOWN;
          }
        } else {
          switchState = Switch.State.DOWN;
          laraState = State.SWITCH_DOWN;
        }
        if (switchItem.animState.canChangeState(switchState) &&
            this.item.animState.tryChangeState(laraState)) {
          this.alignToAxis();
          switchItem.controller.activate();
        }
        // We don't run actions for the switch here. Instead, actions are run
        // when the switch deactivates at the end of its animation.
        break;

      case Trigger.Type.KEY:
        runActions = true;
        break;

      case Trigger.Type.PICK_UP:
        if (this.scene.items[trigger.actions[0].parameter] != this.interactingItem ||
            this.interactingItem.visible) {
          return;
        }
        actionStart = 1;
        runActions = true;
        break;

      case Trigger.Type.HEAVY_TRIGGER:
        return;

      case Trigger.Type.COMBAT:
      case Trigger.Type.DUMMY:
      case Trigger.Type.TRIGGER_OFF:
      case Trigger.Type.HEAVY_SWITCH:
      case Trigger.Type.HEAVY_TRIGGER_OFF:
      case Trigger.Type.MONKEY:
      case Trigger.Type.SKELETON:
      case Trigger.Type.TIGHTROPE:
      case Trigger.Type.CRAWL:
      case Trigger.Type.CLIMB:
        // TODO(tom)
        console.log(`IGNORING TRIGGER ${Trigger.Type[trigger.type]}`);
        return;
    }

    if (runActions) {
      this.scene.runActions(trigger, actionStart);
    }
  }

  toString() {
    let locomotion = LocomotionType[this.locomotionType];
    let vel = this.velocity;
    let parts = [
        super.toString(),
        '',
        `di:${this.di} dj: ${this.dj}`,
        `locomotion:${locomotion}`,
        `velocity: ${vel[0].toFixed(1)} ${vel[1].toFixed(1)} ${vel[2].toFixed(1)}`,
    ];
    return parts.join('\n');
  }
}

export function isLara(controller: Controller): controller is Lara {
  return controller.item.type == EntityType.LARA;
}
