import {Controller} from 'controllers/controller';
import {Item, Scene} from 'scene';

export class Door extends Controller {
  update(dt: number) {
    super.update(dt);
    let targetState = this.item.activeMask == 0x1f ? Door.State.OPEN : Door.State.CLOSED;
    if (targetState != this.item.animState.anim.state) {
      this.item.animState.tryChangeState(targetState);
    }
  }
}

export namespace Door {
  export enum State {
    CLOSED,
    OPEN,
  }
}
