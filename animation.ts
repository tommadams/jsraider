import * as quat from 'toybox/math/quat'
import * as mat4 from 'toybox/math/mat4'
import * as vec2 from 'toybox/math/vec2'
import * as vec3 from 'toybox/math/vec3'

import * as audio from 'audio'
import {State} from 'state'
import {Stream} from 'toybox/util/stream'

let tmp = mat4.newZero();

export class AnimCommand {
  constructor(public op: AnimCommand.Op, public operands: Float32Array) {};
}

export namespace AnimCommand {
  export enum Op {
    NONE = 0,
    OFFSET = 1,
    JUMP = 2,
    EMPTY_HANDS = 3,
    KILL = 4,
    PLAY_SOUND = 5,
    ACTION = 6

    //MAYBE_CAM_1 = 14,  // Maybe camera control?
    //MAYBE_CAM_2 = 15,  // Maybe camera control?

    //CHANGE_CLOTHES = 20,

    //HIDE_OBJECT = 23,
    //SHOW_OBJECT = 24,

    //MAYBE_CAM_3 = 26,  // Maybe camera control?
  }
}

class AnimStack {
  stack_: mat4.Type[] = [];
  top_ = 0;

  push(m: mat4.Type) {
    if (this.top_ == this.stack_.length) {
      this.stack_.push(mat4.newZero());
    }
    mat4.setFromMat(this.stack_[this.top_++], m);
  }

  pop(m: mat4.Type) {
    if (this.top_ == 0) {
      throw new Error('AnimStack is empty');
    }
    mat4.setFromMat(m, this.stack_[--this.top_]);
  }

  clear() {
    this.top_ = 0;
  }
}
let animStack = new AnimStack();

export class AnimDispatch {
  /** Lowest frame in the range.  */
  low: number;

  /** Highest frame in the range.  */
  high: number;

  /** Animation to dispatch to.  */
  nextAnimId: number;

  /** Frame to dispatch to.  */
  nextFrame: number;

  constructor(stream: Stream) {
    /** Lowest frame in the range.  */
    this.low = stream.readInt16();

    /** Highest frame in the range.  */
    this.high = stream.readInt16();

    /** Animation to dispatch to.  */
    this.nextAnimId = stream.readInt16();

    /** Frame to dispatch to.  */
    this.nextFrame = stream.readInt16();
  }
}

// TODO(tom): AnimState should contain explicit data about the current
// animation & frame, and the next animation & frame, so flip blending and
// other stuff can be done.
/** Runtime state of a playing animation. */
export class AnimState {
  animations_: Animation[]
  anim: Animation;
  loopCount = 0;
  frame = new Frame();
  frameIdx = 0;
  frameOfs: number;
  transform = mat4.newZero();
  meshTransforms: mat4.Type[] = [mat4.newZero()];
  prevMeshTransforms: mat4.Type[] = [mat4.newZero()];
  rotationOfs = 0;

  constructor(animations: Animation[], animId: number,
              position: vec3.Type, rotation: vec3.Type) {
    this.animations_ = animations;
    this.anim = animations[animId];
    this.frameOfs = this.anim.firstFrame;
    this.updateTransform(position, rotation);
  }

  setAnim(anim: Animation, opt_frameIdx?: number, opt_frameOfs?: number) {
    if (this.anim != anim) {
      this.loopCount = 0;
    } else {
      this.loopCount += 1;
    }
    this.anim = anim;
    if (opt_frameIdx !== undefined) {
      this.frameIdx = opt_frameIdx;
    }
    if (opt_frameOfs !== undefined) {
      this.frameOfs = opt_frameOfs;
    }
  }

  updateTransform(position: vec3.Type, rotation: vec3.Type) {
    mat4.setRotateY(this.transform, rotation[1] + this.rotationOfs);
    mat4.rotateX(this.transform, rotation[0]);
    mat4.setRowValues(
        this.transform, 3,
        position[0], position[1], position[2], 1);
  }

  /**
   * @return {boolean} True if a transition to target state can take place at
   *     the current animation frame.
   */
  canChangeState(targetState: number) {
    for (let stateChange of this.anim.stateChanges) {
      if (stateChange.state != targetState) {
        continue;
      }
      for (let dispatch of stateChange.animDispatches) {
        if (this.frameIdx + 0.5 + this.frameOfs >= dispatch.low &&
            this.frameIdx + 0.5 + this.frameOfs <= dispatch.high) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * @param {number} targetState
   * @return {boolean} True if the animation has a transition to the target
   *     state. This does NOT mean that the transition took place.
   */
  tryChangeState(targetState: number) {
    let hasState = false;
    for (let stateChange of this.anim.stateChanges) {
      if (stateChange.state != targetState) {
        continue;
      }
      hasState = true;
      for (let dispatch of stateChange.animDispatches) {
        //console.log(dispatch.low, this.frameIdx, dispatch.high);
        if (this.frameIdx + 0.5 + this.frameOfs >= dispatch.low &&
            this.frameIdx + 0.5 + this.frameOfs <= dispatch.high) {
          this.setAnim(
              this.animations_[dispatch.nextAnimId], dispatch.nextFrame);
          return hasState;
        }
      }
    }
    return hasState;
  }

  toString() {
    let parts = [];
    let anim = this.anim;
    parts.push(
      `idx:${(this.frameIdx - anim.firstFrame)} ofs:${this.frameOfs.toFixed(2)}`,
      anim.toString(), '', 'Commands:');
    for (let command of anim.commands) {
      parts.push(
          `op: ${AnimCommand.Op[command.op]} [${command.operands.join(', ')}]`);
    }
    return parts.join('\n');
  }

  /**
   * Trigger any animation commands in the frame range [begin, end).
   */
  private triggerCommands_(frameIdx: number, out_command?: AnimState.Command) {
    for (let command of this.anim.commands) {

      /*
      for (let name in AnimCommand.Op) {
        // Don't log PLAY_SOUND commands.
        if (command.op == AnimCommand.Op.PLAY_SOUND) {
          continue;
        }
        if (command.op == AnimCommand.Op[name]) {
          console.log(name + ': ' + command.operands.join(', '));
        }
      }
      */

      switch (command.op) {
        case AnimCommand.Op.OFFSET:
          if (out_command) {
            console.log('offset : [' + command.operands.join(', ') + ']');
            vec3.setFromArray(out_command.offset, command.operands);
          }
          break;

        case AnimCommand.Op.PLAY_SOUND:
          if (frameIdx == command.operands[0]) {
            let x = this.transform[12];
            let y = this.transform[13];
            let z = this.transform[14];
            audio.playSample(command.operands[1], x, y, z);
          }
          break;

        case AnimCommand.Op.JUMP:
          if (out_command) {
            vec2.setFromArray(out_command.jump, command.operands);
          }
          break;

        case AnimCommand.Op.ACTION:
          if (out_command && frameIdx == command.operands[0]) {
            let action = command.operands[1] & 0x3fff;
            // TODO(tom): create a list of all actions
            if (action == 0) {
              out_command.flip = true;
            }
          }
          break;
      }
    }
  }

  advance(dt: number, command: AnimState.Command) {
    // Clear the command data before doing anything.
    if (command != null) {
      command.flip = false;
      command.jump.fill(0);
      command.offset.fill(0);
    }

    // TODO(tom): Define a global FPS constant.
    this.frameOfs += dt * 30;
    if (this.frameOfs < 1) {
      return;
    }

    this.frameIdx += 1;
    this.frameOfs %= 1;
    if (this.frameIdx + 0.5 + this.frameOfs > this.anim.lastFrame) {
    //if (this.frameIdx > this.anim.lastFrame) {
      this.triggerCommands_(this.frameIdx, command);
      this.setAnim(this.anim.nextAnim, this.anim.nextFrame);
    } else {
      this.triggerCommands_(this.frameIdx, null);
    }
  }

  setMeshTransforms(numMeshes: number, meshTreeStart: number,
                    meshTrees: Int32Array) {
    let frame = this.frame;
    animStack.clear();

    let oldLength = this.meshTransforms.length;
    this.meshTransforms.length = numMeshes;
    for (let i = oldLength; i < numMeshes; ++i) {
      this.meshTransforms[i] = mat4.newIdentity();
    }

    oldLength = this.prevMeshTransforms.length;
    this.prevMeshTransforms.length = numMeshes;
    for (let i = oldLength; i < numMeshes; ++i) {
      this.prevMeshTransforms[i] = mat4.newIdentity();
    }

    for (let i = 0; i < numMeshes; ++i) {
      mat4.setFromMat(this.prevMeshTransforms[i], this.meshTransforms[i]);
    }

    // Make a copy of the root transform to prevent stomping all over it.
    // TODO(tom): eliminate transform
    let transform = mat4.newFromMat(this.transform);
    mat4.translate(transform, frame.ofs[0], frame.ofs[1], frame.ofs[2]);
    let meshTreeIdx = meshTreeStart;
    for (let i = 0; i < numMeshes; ++i) {
      if (i < frame.rotations.length) {
        mat4.setFromQuat(tmp, frame.rotations[i]);
        mat4.mul(transform, transform, tmp);
      }

      mat4.setFromMat(this.meshTransforms[i], transform);

      if (meshTreeIdx >= meshTrees.length) {
        break;
      }

      let op = meshTrees[meshTreeIdx++];
      let x = meshTrees[meshTreeIdx++];
      let y = meshTrees[meshTreeIdx++];
      let z = meshTrees[meshTreeIdx++];

      if (op > 3) {
        throw new Error('Invalid op ' + op);
      }

      if ((op & 1) == 1) {
        animStack.pop(transform);
      }
      if ((op & 2) == 2) {
        animStack.push(transform);
      }

      mat4.translate(transform, x, y, z);
    }
  }
}

export namespace AnimState {
  export class Command {
    flip = false;
    jump = vec2.newZero();
    offset = vec3.newZero();
  }
}

export class Animation {
  id = -1;
  
  // Offset to start of shared frames array of the first frame.
  frameOffset: number;

  // Engine ticks per frame (30Hz).
  frameRate: number;

  // Number of uint16s used by this animation.
  frameSize: number;

  state: State;
  speed: number;
  accel: number;
  firstFrame: number;
  lastFrame: number;
  nextAnimId: number;
  nextFrame: number;
  stateChangeCount: number;
  stateChangeOffset: number;
  commandCount: number;
  commandOffset: number;
  nextAnim: Animation;
  stateChanges: StateChange[];
  commands: AnimCommand[];
  frames: Frame[] = [];
  offset: vec3.Type = null;

  constructor(stream: Stream) {
    this.id = -1;
    this.frameOffset = stream.readUint32();
    this.frameRate = stream.readUint8();
    this.frameSize = stream.readUint8();
    this.state = stream.readUint16();
    this.speed = stream.readInt32() / 65536;
    this.accel = stream.readInt32() / 65536;
    this.firstFrame = stream.readUint16();
    this.lastFrame = stream.readUint16();
    this.nextAnimId = stream.readUint16();
    this.nextFrame = stream.readUint16();
    this.stateChangeCount = stream.readUint16();
    this.stateChangeOffset = stream.readUint16();
    this.commandCount = stream.readUint16();
    this.commandOffset = stream.readUint16();
    this.nextAnim = this;
    this.stateChanges = new Array(this.stateChangeCount);
    this.commands = new Array(this.commandCount);
  }

  init(id:number, animations: Animation[], stateChanges: StateChange[],
       animCommands: Int16Array, frames: Frame[]) {
    this.id = id;
    this.nextAnim = animations[this.nextAnimId];

    for (let i = 0; i < this.stateChangeCount; ++i) {
      this.stateChanges[i] = stateChanges[i + this.stateChangeOffset];
    }
    this.frames = frames;

    let idx = this.commandOffset;
    for (let i = 0; i < this.commandCount; ++i) {
      let op = animCommands[idx++];
      let numOperands = 0;
      switch (op) {
        case AnimCommand.Op.EMPTY_HANDS:
        case AnimCommand.Op.KILL:
          break;

        case AnimCommand.Op.JUMP:
        case AnimCommand.Op.PLAY_SOUND:
        case AnimCommand.Op.ACTION:
          numOperands = 2;
          break;

        case AnimCommand.Op.OFFSET:
          numOperands = 3;
          break;

        default:
          throw new Error('unrecognized anim command: ' + op);
      }
      let operands = new Float32Array(numOperands);
      for (let j = 0; j < numOperands; ++j) {
        operands[j] = animCommands[idx++];
      }
      this.commands[i] = new AnimCommand(op, operands);
    }

    this.offset = this.findOffset();
  }

  // TODO(tom): clean this up
  getFrame(frameIdx: number, frameOfs: number, result: Frame) {
    if (frameIdx < this.firstFrame || frameIdx > this.lastFrame) {
      throw new Error(
          'Frame ' + frameIdx +
          ' out of range [' + this.firstFrame + ', ' + this.lastFrame + ']');
    }

    let frameNum = frameIdx - this.firstFrame;

    let keyframe0 = Math.floor(frameNum / this.frameRate);
    let frame0 = this.frames[this.frameOffset + keyframe0];

    let n = this.firstFrame + keyframe0 * this.frameRate;
    let effectiveFrameRate = Math.min(1 + this.lastFrame - n, this.frameRate);
    let blend = (frameIdx - n + frameOfs) / effectiveFrameRate;

    // No interpolation needed.
    if ((this.firstFrame == this.lastFrame) || (blend == 0)) {
      result.set(frame0);
      return;
    }

    let frame1;
    let last = Math.floor((this.lastFrame - this.firstFrame) / this.frameRate);
    if (keyframe0 + 1 > last) {
      let f = Math.floor((this.nextFrame - this.firstFrame) / this.frameRate);
      if (this.nextAnim == this && f == keyframe0) {
        result.set(frame0);
        return;
      } else {
        frame1 = result;
        this.nextAnim.getFrame(this.nextFrame, 0, frame1);
        if (this.offset) {
          vec3.add(frame1.ofs, this.offset, frame1.ofs);
        }
      }
    } else {
      frame1 = this.frames[this.frameOffset + keyframe0 + 1];
    }

    Frame.lerp(frame0, frame1, blend, result);
  }

  findOffset() {
    for (let command of this.commands) {
      if (command.op == AnimCommand.Op.OFFSET) {
        return command.operands;
      }
    }
    return null;
  }

  toString() {
    let lines = [
      'anim: ' + Animation.getName(this.id) +
      ' [0, ' + (1 + this.lastFrame - this.firstFrame) + ') state: ' +
      '(' + this.state + ') ' + State[this.state],
      'speed: ' + this.speed.toFixed(1) +
      ' accel: ' + this.accel.toFixed(1)
    ];

    for (let stateChange of this.stateChanges) {
      for (let dispatch of stateChange.animDispatches) {
        lines.push(
            '  state: (' + stateChange.state + ') ' +
            State[stateChange.state] +
            ' [' + (dispatch.low - this.firstFrame) +
            ', ' + (dispatch.high - this.firstFrame) + ')' +
            ' -> ' + Animation.getName(dispatch.nextAnimId));
      }
    }
    if (this.nextAnim != this) {
      lines.push('  next -> ' + Animation.getName(this.nextAnimId));
    }

    return lines.join('\n');
  }

  /**
   * @return {boolean} True if the animation has an outgoing edge to the given
   *     animation.
   */
  hasOutgoingEdge(animId: AnimationId) {
    if (this.nextAnimId == animId) {
      return true;
    }
    for (let stateChange of this.stateChanges) {
      for (let dispatch of stateChange.animDispatches) {
        if (dispatch.nextAnimId == animId) {
          return true;
        }
      }
    }
    return false;
  }
}

/**
 * Dumps the graph of animations to the console, starting at the given root.
 */
export function dumpAnimGraph(animations: Animation[], root: number) {
  let found = [];
  let pending = [];
  pending.push(root);
  found[root] = true;
  while (pending.length > 0) {
    let anim = animations[pending[0]];
    pending = pending.slice(1);

    for (let stateChange of anim.stateChanges) {
      for (let dispatch of stateChange.animDispatches) {
        if (!found[dispatch.nextAnimId]) {
          pending.push(dispatch.nextAnimId);
          found[dispatch.nextAnimId] = true;
        }
      }
    }
    if (!found[anim.nextAnimId]) {
      pending.push(anim.nextAnimId);
      found[anim.nextAnimId] = true;
    }
  }

  for (let animIdx = 0; animIdx < found.length; ++animIdx) {
    if (!found[animIdx]) {
      continue;
    }
    console.log(animations[animIdx].toString());
  }
}

export class Frame {
  min = vec3.newZero();
  max = vec3.newZero();
  ofs = vec3.newZero();
  rotations: quat.Type[] = [];

  constructor(opt_min?: vec3.Type, opt_max?: vec3.Type, opt_ofs?: vec3.Type) {
    if (opt_min) { vec3.setFromVec(this.min, opt_min); }
    if (opt_max) { vec3.setFromVec(this.max, opt_max); }
    if (opt_ofs) { vec3.setFromVec(this.ofs, opt_ofs); }
  }

  /** Copies this given frame into this one. */
  set(f: Frame) {
    vec3.setFromVec(this.min, f.min);
    vec3.setFromVec(this.max, f.max);
    vec3.setFromVec(this.ofs, f.ofs);

    // Resize the result's rotations array to the required length.
    let oldLength = this.rotations.length;
    this.rotations.length = f.rotations.length;
    for (let i = oldLength; i < f.rotations.length; ++i) {
      this.rotations[i] = quat.newZero();
    }

    for (let i = 0; i < f.rotations.length; ++i) {
      quat.setFromQuat(this.rotations[i], f.rotations[i]);
    }
  }
}

export namespace Frame {
  /**
   * Linearly interpolates between two frames and stores the result in the given
   * frame.
   * @param a
   * @param b
   * @param f Blend factor in the range [0, 1].
   * @param result The result of the interpolation. May be a or b.
   */
  export function lerp(a: Frame, b: Frame, f: number, result: Frame) {
    if (a.rotations.length != b.rotations.length) {
      console.log(a);
      console.log(b);
      throw new Error(
          'Can\'t interpolate between frames of different numbers of rotations');
    }

    vec3.lerp(result.min, a.min, b.min, f);
    vec3.lerp(result.max, a.max, b.max, f);
    vec3.lerp(result.ofs, a.ofs, b.ofs, f);

    // Resize the result's rotations array to the required length.
    let oldLength = result.rotations.length;
    result.rotations.length = a.rotations.length;
    for (let i = oldLength; i < a.rotations.length; ++i) {
      result.rotations[i] = quat.newZero();
    }

    for (let i = 0; i < result.rotations.length; ++i) {
      quat.slerp(result.rotations[i], a.rotations[i], b.rotations[i], f);
    }
  }
}

export class ParsedFrames {
  constructor(public remap: number[], public frames: Frame[]) {}
}


/**
 * Rotation should be applied in the order Y, X, Z.
 * @param raw Raw frame data.
 * @param frameIdx
 * @param rot
 * @return {number} The offset for the next value in the animtion frame.
 */
function parseAnimRotation_(raw: Uint16Array, frameIdx: number, rot: vec3.Type) {
  let a = raw[frameIdx++];
  let b = raw[frameIdx++];
  let anim = a | (b << 16);

  rot[2] = ((anim >> 0) & 0x3ff) * Math.PI / 512;
  rot[1] = ((anim >> 10) & 0x3ff) * Math.PI / 512;
  rot[0] = ((anim >> 20) & 0x3ff) * Math.PI / 512;

  return frameIdx;
};

export function parseFrames(raw: Uint16Array) {
  let parsed = [];

  // Frame data is stored as uint16, but the vector data should be interpreted
  // as int16.
  let makeSigned = function(v: vec3.Type) {
    for (let i = 0; i < 3; ++i) {
      if (v[i] & 0x8000) {
        v[i] -= 65536;
      }
    }
  };

  let rot = vec3.newZero();
  let min = vec3.newZero();
  let max = vec3.newZero();
  let ofs = vec3.newZero();

  /**
   * A map from original floor(frameOffset/2) value to index into the
   * parsed frames array. Offsets that don't correspond to the start of a
   * frame are left undefined.
   */
  let remap = new Array<number>(raw.length);

  let tmpQuat = quat.newZero();
  let xAxis = vec3.newFromValues(1, 0, 0);
  let yAxis = vec3.newFromValues(0, 1, 0);
  let zAxis = vec3.newFromValues(0, 0, 1);

  let frameIdx = 0;
  while (frameIdx < raw.length) {
    remap[frameIdx] = parsed.length;

    for (let i = 0; i < 3; ++i) {
      min[i] = raw[frameIdx++];
      max[i] = raw[frameIdx++];
    }
    for (let i = 0; i < 3; ++i) {
      ofs[i] = raw[frameIdx++];
    }
    makeSigned(min);
    makeSigned(max);
    makeSigned(ofs);

    let frame = new Frame(min, max, ofs);
    let numValues = raw[frameIdx++];
    for (let i = 0; i < numValues; ++i) {
      frameIdx = parseAnimRotation_(raw, frameIdx, rot);

      let q = quat.newFromAxisAngle(yAxis, rot[1]);
      quat.mul(q, q, quat.setFromAxisAngle(tmpQuat, xAxis, rot[0]));
      quat.mul(q, q, quat.setFromAxisAngle(tmpQuat, zAxis, rot[2]));
      frame.rotations.push(q);
    }
    parsed.push(frame);
  }

  return new ParsedFrames(remap, parsed);
};

export class StateChange {
  state: number;
  animDispatchCount: number;
  animDispatchOffset: number;
  animDispatches: AnimDispatch[];

  constructor(stream: Stream) {
    this.state = stream.readUint16();
    this.animDispatchCount = stream.readUint16();
    this.animDispatchOffset = stream.readUint16();
    this.animDispatches = new Array(this.animDispatchCount);
  }

  init(animDispatches: AnimDispatch[]) {
    for (let i = 0; i < this.animDispatchCount; ++i) {
      this.animDispatches[i] = animDispatches[i + this.animDispatchOffset];
    }
  }
}

export enum AnimationId {
  NONE = -1,

  RUN = 0,
  WALK = 1,
  STOP_WALKING_L = 2,
  STOP_WALKING_R = 3,
  WALK_TO_RUN_L = 4,
  WALK_TO_RUN_R = 5,
  START_RUN = 6,
  RUN_TO_WALK_L = 7,
  STOP_RUNNING_L = 8,
  RUN_TO_WALK_R = 9,
  STOP_RUNNING_R = 10,
  STAND_1_FRAME = 11,
  TURN_RIGHT = 12,
  TURN_LEFT = 13,

  START_RUNNING_JUMP_R = 16,
  RUNNING_JUMP_R = 17,
  START_RUNNING_JUMP_L = 18,
  RUNNING_JUMP_L = 19,
  START_WALK = 20,
  START_WALK_CONTINUED = 21,
  START_FALLING = 22,
  FALLING = 23,
  LAND_DEEP = 24,
  DIE_FROM_FALL = 25,
  PREPARE_JUMP_UP_GRAB = 26,
  JUMP_UP_GRAB = 27,
  JUMP_UP = 28,
  JUMP_UP_CATCH_EDGE = 29,

  DROP_FROM_GRAB = 30,

  JUMP_UP_LAND = 31,
  HIT_WALL = 32,
  HIT_WALL_CONTINUED = 33,
  START_DROP = 34,
  DROP = 35,
  DROP_TO_FALL = 36,
  HANG_TO_FALL = 37,
  STOP_BACKSTEP_L = 38,
  STOP_BACKSTEP_R = 39,
  BACKSTEP = 40,
  START_BACKSTEP = 41,
  VAULT_UP_MED = 42,

  DROP_FORWARDS = 43,

  FAST_TURN_RIGHT = 44,
  JUMP_FORWARD_TO_FALL = 45,

  FINISH_TUMBLE = 47,

  VAULT_UP_LOW = 50,
  VAULT_UP_LOW_END = 51,

  HIT_WALL_LEFT = 53,
  HIT_WALL_RIGHT = 54,

  RUN_STEP_UP_L = 55,
  RUN_STEP_UP_R = 56,
  WALK_STEP_UP_L = 57,
  WALK_STEP_UP_R = 58,
  WALK_STEP_DOWN_L = 59,
  WALK_STEP_DOWN_R = 60,
  BACKSTEP_DOWN_L = 61,
  BACKSTEP_DOWN_R = 62,

  PULL_SWITCH_DOWN = 63,
  PULL_SWITCH_UP = 64,
  STEP_LEFT = 65,
  STEP_LEFT_END = 66,
  STEP_RIGHT = 67,
  STEP_RIGHT_END = 68,
  FAST_TURN_LEFT = 69,

  SLIDE = 70,
  SLIDE_STOP = 71,
  SLIDE_RECOVER = 72,

  PREPARE_JUMP = 73,
  START_JUMP_BACK = 74,
  JUMP_BACKWARD = 75,
  START_JUMP_FORWARD = 76,
  JUMP_FORWARD = 77,
  START_JUMP_LEFT = 78,
  JUMP_LEFT = 79,
  START_JUMP_RIGHT = 80,
  JUMP_RIGHT = 81,
  LAND = 82,
  JUMP_BACKWARD_TO_FALL = 83,
  JUMP_LEFT_TO_FALL = 84,
  JUMP_RIGHT_TO_FALL = 85,
  SWIM = 86,
  SWIM_TRANSITION_SINGLE_FRAME = 87,
  START_HOP_BACK = 88,
  HOP_BACK = 89,
  END_HOP_BACK = 90,
  START_JUMP_UP = 91,
  LAND_TO_RUN = 92,

  JUMP_FORWARD_GRAB = 95,
  HANG = 96,

  PULL_UP = 97,

  FINISH_PULL_UP = 102,
  IDLE = 103,
  START_BACK_SLIDE = 104,
  BACK_SLIDE = 105,
  STOP_BACK_SLIDE = 106,

  SWIM_STOP = 108,
  SWIM_STOP_TO_FORWARD = 109,
  TREAD_WATER = 110,
  LEAVE_WATER = 111,
  DROP_TO_SWIM = 112,

  SWIM_TO_TREAD_WATER = 114,

  TREAD_WATER_FORWARD = 118,
  TREAD_WATER_TO_SWIM = 119,
  PREPARE_PUSH = 120,
  RELEASE_PUSH = 121,

  DIE_SWIMMING = 124,

  PULL_BLOCK = 122,
  PUSH_BLOCK = 123,

  SWIM_SWITCH = 129,
  SWIM_PICK_UP = 130,
  USE_KEY = 131,
  DIE_TREAD_WATER = 133,
  DIE_RUNNING = 133,
  INSERT_OBJECT = 134,
  PICK_UP = 135,
  SHIMMY_LEFT = 136,
  SHIMMY_RIGHT = 137,
  DIE_STANDING = 138,

  TREAD_WATER_BACK = 140,

  TREAD_WATER_LEFT = 143,
  TREAD_WATER_RIGHT = 144,
  DIE_WHEN_LANDING = 145,

  CATCH_EDGE_NO_WALL = 150,
  SWAN_DIVE_TO_LAND = 151,
  SWAN_DIVE_TO_SWIM = 152,
  SWAN_DIVE_TO_VERTICAL = 153,

  SWAN_DIVE_TO_DIE = 155,
  START_SWAN_DIVE_START_L = 156,
  START_SWAN_DIVE_START_R = 157,
  SWAN_DIVE = 158,
  HANDSTAND_PULL_UP = 159,
}

export namespace Animation {
  const names: string[] = function() {
    let names = [];
    for (let k in AnimationId) {
      let id = parseInt(AnimationId[k]);
      if (id >= 0) {
        names[id] = k.toLowerCase().replace(/^_+|_+$/g, '');
      }
    }
    return names;
  }();

  export function getName(id: number) {
    let name = names[id];
    if (name == undefined) {
      name = '(UNDEFINED)';
    }
    return '(' + id + ') ' + name;
  };
}
