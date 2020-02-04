import {Controller} from 'controllers/controller';
import {Item, ItemType, Scene, Sector, TriggerType} from 'scene';

export const enum BlockState {
  STOP = 1,
  PUSH = 2,
  PULL = 3
}

export class Block extends Controller {
  constructor(item: Item, scene: Scene) {
    super(item, scene);
    let sector = this.item.room.getSectorByPosition(this.item.position);
    sector.floor -= 1024;
  }

  update(dt: number) {
    let oldSector = this.item.room.getSectorByPosition(this.item.position);
    super.update(dt);
    // TODO(tom): store block & bridge state in the sector somehow instead of
    // directly modifying the floor (which breaks the projection shadow).
    if (this.animStateCommand.offset[2] != 0) {
      // Offset the floor height at the end of the push.
      let sector = this.item.room.getSectorByPosition(this.item.position);
      sector.floor -= 1024;

      let func = sector.getTrigger(TriggerType.HEAVY_TRIGGER);
      if (func != null) {
        this.scene.runFloorFunc(func, 1, 1);
      }
    }
  }

  changeState(state: number) {
    super.changeState(state);

    // Reset the floor height when the block is pushed or pull.
    // We do this immediately the block gets pushed as kind of a hack: projection
    // shadows project onto collision generated from the floor data. Reseting
    // the floor height at the start ensures that Lara's shadow gets correctly
    // projected onto the ground under the block during a push.
    if (state == BlockState.PUSH || state == BlockState.PULL) {
      let sector = this.item.room.getSectorByPosition(this.item.position);
      sector.floor += 1024;
    }
  }
}

export function isBlock(controller: Controller): controller is Block {
  return (controller.item.type == ItemType.BLOCK_1 ||
          controller.item.type == ItemType.BLOCK_2);
}
