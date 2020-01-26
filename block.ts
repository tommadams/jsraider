import {Controller} from 'controller';
import {Item, Scene, Sector} from 'scene';

export const enum BlockState {
  STOP = 1,
  PUSH = 2,
  PULL = 3
}

export class Block extends Controller {
  constructor(item: Item, scene: Scene) {
    super(item, scene);
    let sector = this.item.room.getSectorByPosition(this.item.position);
    this.offsetSector_(sector, -1024);
  }

  update(dt: number) {
    var oldSector = this.item.room.getSectorByPosition(this.item.position);
    super.update(dt);
    if (this.animStateCommand.offset[2] != 0) {
      var newSector = this.item.room.getSectorByPosition(this.item.position);
      this.offsetSector_(oldSector, 1024);
      this.offsetSector_(newSector, -1024);
    }
  }

  private offsetSector_(sector: Sector, offset: number) {
    sector.floor += offset;
  }
}
