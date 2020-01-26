// MISSING entries are those that aren't present in Lara's animation graph (at
// least on the levels I've tested).
export enum State {
  NONE = -1,

  WALK = 0,
  RUN = 1,
  STOP = 2,
  JUMP_FORWARD = 3,
  MISSING_4 = 4,
  FAST_BACK = 5,
  TURN_RIGHT = 6,
  TURN_LEFT = 7,
  DEATH = 8,
  FALL = 9,
  HANG = 10,
  REACH = 11,
  SPLAT = 12,
  SWIM_STOP = 13,
  MISSING_14 = 14,
  COMPRESS = 15,
  BACK = 16,
  SWIM = 17,
  SWIM_INERTIA = 18,
  HANG_UP = 19,
  TURN_FAST = 20,
  STEP_RIGHT = 21,
  STEP_LEFT = 22,
  ROLL_1 = 23,
  SLIDE = 24,
  JUMP_BACK = 25,
  JUMP_RIGHT = 26,
  JUMP_LEFT = 27,
  JUMP_UP = 28,
  FALL_BACK = 29,
  SHIMMY_LEFT = 30,
  SHIMMY_RIGHT = 31,
  SLIDE_BACK = 32,
  TREAD_WATER_STOP = 33,
  TREAD_WATER_FORWARD = 34,
  DIVE = 35,
  PUSH_BLOCK = 36,
  PULL_BLOCK = 37,
  PUSH_READY = 38,
  PICK_UP = 39,
  SWITCH_DOWN = 40,
  SWITCH_UP = 41,
  USE_KEY = 42,
  USE_PUZZLE = 43,
  UNDERWATER_DEATH = 44,
  ROLL_2 = 45,
  SPECIAL = 46,
  TREAD_WATER_BACK = 47,
  TREAD_WATER_LEFT = 48,
  TREAD_WATER_RIGHT = 49,
  MISSING_50 = 50,
  MISSING_51 = 51,
  SWAN_DIVE = 52,
  FAST_DIVE = 53,
  HANDSTAND = 54,
  WATER_OUT = 55
}

export namespace State {
  export function isJumping(state: State) {
    switch (state) {
      case State.JUMP_UP:
      case State.JUMP_FORWARD:
      case State.JUMP_BACK:
      case State.JUMP_LEFT:
      case State.JUMP_RIGHT:
      case State.REACH:
      case State.SWAN_DIVE:
        return true;
    }
    return false;
  }


  export function isWalking(state: State) {
    switch (state) {
      case State.WALK:
      case State.BACK:
        return true;
    }
    return false;
  }


  export function isSideStepping(state: State) {
    switch (state) {
      case State.STEP_RIGHT:
      case State.STEP_LEFT:
        return true;
    }
    return false;
  }


  export function isHanging(state: State) {
    switch (state) {
      case State.HANG:
      case State.HANG_UP:
      case State.SHIMMY_LEFT:
      case State.SHIMMY_RIGHT:
      case State.HANDSTAND:
      case State.WATER_OUT:
        return true;
    }
    return false;
  }


  export function isSwimming(state: State) {
    switch (state) {
      case State.SWIM:
      case State.SWIM_STOP:
      case State.SWIM_INERTIA:
        return true;
    }
    return false;
  }


  export function isTreadingWater(state: State) {
    switch (state) {
      case State.TREAD_WATER_STOP:
      case State.TREAD_WATER_FORWARD:
      case State.TREAD_WATER_BACK:
      case State.TREAD_WATER_LEFT:
      case State.TREAD_WATER_RIGHT:
        return true;
    }
    return false;
  }
}
