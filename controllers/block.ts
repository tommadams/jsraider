import {Controller} from 'controllers/controller';
import {Item, Scene, Trigger} from 'scene';

export class Block extends Controller {
  constructor(item: Item, scene: Scene) {
    super(item, scene);
    let sector = this.item.room.getSectorByPosition(this.item.position);
    sector.floor -= 1024;
  }

  update(dt: number) {
    super.update(dt);

    if (this.animStateCommand.offset[2] != 0) {
      // Offset the floor height at the end of the push.
      let sector = this.item.room.getSectorByPosition(this.item.position);
      sector.floor -= 1024;

      let trigger = sector.floorData.trigger;
      if (trigger != null && trigger.type == Trigger.Type.HEAVY_TRIGGER) {
        this.scene.runActions(trigger, 0);
      }
    }
  }

  changeState(state: number) {
    super.changeState(state);

    // Reset the floor height when the block is pushed or pull.
    // We do this immediately the block gets pushed as kind of a hack: projection
    // shadows project onto collision generated from the floor data. Resetting
    // the floor height at the start ensures that Lara's shadow gets correctly
    // projected onto the ground under the block during a push.
    if (state == Block.State.PUSH || state == Block.State.PULL) {
      let sector = this.item.room.getSectorByPosition(this.item.position);
      sector.floor += 1024;
    }
  }
}

export namespace Block {
  export enum State {
    STOP = 1,
    PUSH = 2,
    PULL = 3
  }
}
