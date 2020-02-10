import {Controller} from 'controllers/controller';
import {Item, Scene, Trigger} from 'scene';

export class Switch extends Controller {
  private timer = -1;
  private trigger: Trigger;

  constructor(item: Item, scene: Scene) {
    super(item, scene);
    this.trigger = this.item.getSector().floorData.trigger;
  }

  activate() {
    if (this.item.animState.anim.state == Switch.State.DOWN) {
      this.changeState(Switch.State.UP);
    } else {
      this.changeState(Switch.State.DOWN);
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
