import {Component, EntityType} from 'entity/entity';
import {Item, Scene, Sector} from 'scene';

export class Door extends Component {
  update(dt: number) {
    super.update(dt);
    let targetState = this.item.isActive() ? Door.State.OPEN : Door.State.CLOSED;
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

