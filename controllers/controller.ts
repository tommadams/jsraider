import * as mat4 from 'toybox/math/mat4'
import * as vec3 from 'toybox/math/vec3'

import {AnimCommand, AnimState} from 'animation'
import {EntityType} from 'entity/entity';
import {Item, Scene} from 'scene'
import {resolveRoomByPosition} from 'collision'

export class Controller {
  protected animStateCommand = new AnimState.Command();

  constructor(public item: Item, public scene: Scene) {
    this.item.controller = this;
  }

  update(dt: number) {
    let item = this.item;
    let animState = item.animState;
    if (animState == null) {
      return;
    }
    let prevFrameIdx = animState.frameIdx;

    // Advance the animation state.
    animState.advance(dt, this.animStateCommand);

    if (this.animStateCommand.kill) {
      this.deactivate();
    }

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

  activate() {
    // console.log(`activate idx:${this.item.id} type:${EntityType[this.item.type]} mask:${this.item.activeMask.toString(16)}`);
    this.item.visible = true;
    for (let component of this.item.components) {
      component.activate();
    }
    return true;
  }

  deactivate() {
    // TODO(tom): maybe the active bit should live on the controller not the item.
    for (let comp of this.item.components) {
      comp.deactivate();
    }
  }

  changeState(state: number) {
    if (this.item.animState.tryChangeState(state) != AnimState.StateChangeResult.OK) {
      throw new Error(`Couldn't change ${EntityType[this.item.type]} state to ${state}`);
    }
  }

  toString() {
    let item = this.item;
    let pos = this.item.position;
    let rot = this.item.rotation;
    let animState = item.animState;

    let i = Math.floor(pos[0] / 1024);
    let j = Math.floor(pos[2] / 1024);
    let type = EntityType[item.type];
    if (type == null) {
      type = `UNKNOWN<${item.type}>`;
    }
    let lines: string[] = [
      `type:${type}`,
      `room:${item.room.id}`,
      `i:${i} j:${j}`,
      `position:[${pos[0].toFixed(1)}, ${pos[1].toFixed(1)}, ${pos[2].toFixed(1)}]`,
      `rotation:[${rot[0].toFixed(2)}, ${rot[1].toFixed(2)}, ${rot[2].toFixed(2)}]`,
      `activeMask:${item.activeMask.toString(2).padStart(5, '0')}`,
    ];

    if (animState != null) {
      lines.push(animState.toString());
    }

    return lines.join('\n');
  }

  protected onAnimFrameChange() {}
}
