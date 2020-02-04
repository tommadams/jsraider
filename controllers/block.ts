import {Controller} from 'controllers/controller';
import {Item, ItemType, Scene, Sector} from 'scene';

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
    var oldSector = this.item.room.getSectorByPosition(this.item.position);
    super.update(dt);
    // TODO(tom): store block & bridge state in the sector somehow instead of
    // directly modifying the floor (which breaks the projection shadow).
    if (this.animStateCommand.offset[2] != 0) {
      var newSector = this.item.room.getSectorByPosition(this.item.position);
      oldSector.floor += 1024;
      newSector.floor -= 1024;
    }
  }
}

export function isBlock(controller: Controller): controller is Block {
  return (controller.item.type == ItemType.BLOCK_1 ||
          controller.item.type == ItemType.BLOCK_2);
}
