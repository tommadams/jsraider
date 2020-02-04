import * as mat4 from 'toybox/math/mat4'
import * as vec3 from 'toybox/math/vec3'

import {AnimState} from 'animation'
import {Item, Scene} from 'scene'
import {resolveRoomByPosition} from 'collision'

export class Controller {
  private pendingState = -1;
  protected animStateCommand = new AnimState.Command();

  constructor(public item: Item, public scene: Scene) {
    this.item.controller = this;
  }

  update(dt: number) {
    let item = this.item;
    let animState = item.animState;
    let prevFrameIdx = animState.frameIdx;

    if (this.pendingState != -1 &&
        animState.tryChangeState(this.pendingState)) {
      this.pendingState = -1;
    }

    // Advance the animation state.
    animState.advance(dt, this.animStateCommand);

    // Apply an offset to position if one triggered during animation.
    let offset = this.animStateCommand.offset;
    if (offset[0] != 0 || offset[1] != 0 || offset[2] != 0) {
      mat4.mulVec(offset, animState.transform, offset);
      vec3.add(item.position, offset, item.position);
      item.room = resolveRoomByPosition(item.room, item.position);
    }

    // Update the item's root transform.
    animState.updateTransform(item.position, item.rotation);

    // Update the item's mesh transforms.
    animState.anim.getFrame(
        animState.frameIdx, animState.frameOfs, animState.frame);
    animState.setMeshTransforms(
        item.moveable.meshCount, item.moveable.meshTree, this.scene.meshTrees);
    if (animState.frameIdx != prevFrameIdx) {
      this.onAnimFrameChange();
    }
  }

  changeState(state: number) {
    let animState = this.item.animState;
    if (!animState.tryChangeState(state)) {
      this.pendingState = state;
    }
  }

  protected onAnimFrameChange() {}
}
