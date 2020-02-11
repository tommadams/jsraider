import {AnimState} from 'animation';
import {Component, EntityType} from 'entity/entity';
import {Item, Scene, Trigger} from 'scene';

export class Switch extends Component {
  private timer = -1;
  private trigger: Trigger;

  constructor(item: Item, private scene: Scene) {
    super(item);
    this.trigger = this.item.getFloorSector().floorData.trigger;
  }

  activate() {
    let state: number;
    if (this.item.animState.anim.state == Switch.State.DOWN) {
      state = Switch.State.UP;
    } else {
      state = Switch.State.DOWN;
    }
    if (this.item.animState.tryChangeState(state) != AnimState.StateChangeResult.OK) {
      throw new Error(`Couldn't change ${EntityType[this.item.type]} state to ${state}`);
    }
    this.timer = this.trigger.timer || -1;
    return super.activate();
  }

  deactivate() {
    // Deactivate immediately if the switch is up, or the switch doesn't have
    // a timer.
    if (this.item.animState.anim.state == Switch.State.UP || this.timer == -1) {
      super.deactivate();
    }
    this.scene.runActions(this.trigger, 1);
  }

  update(dt: number) {
    super.update(dt);
    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = -1;
        this.deactivate();
      }
    }
  }
}

export namespace Switch {
  export enum State {
    DOWN,
    UP,
  }
}
