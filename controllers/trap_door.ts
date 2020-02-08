import {Controller} from 'controllers/controller';
import {Door} from 'controllers/door';
import {Item, Scene, Sector} from 'scene';

// TODO(tom): Trap door with underwater switch in Vilcabamba is broken:
// if the trap door is shut when Lara surfaces, she will be teleported
// above the trap door.

// TODO(tom): Lara shouldn't be able to push blocks on to trap doors,
// e.g. at the start of the cistern.

export class TrapDoor extends Door {
  private floorSector: Sector;
  constructor(item: Item, scene: Scene) {
    super(item, scene);
    this.floorSector = this.getSector().getResolvedFloorSector();
    this.floorSector.floorData.bridge = this.item;
  }

  activate() {
    if (this.item.animState.anim.state == TrapDoor.State.CLOSED) {
      console.log('remove bridge');
      this.floorSector.floorData.bridge = null;
    } else {
      console.log('create bridge');
      this.floorSector.floorData.bridge = this.item;
    }
    return super.activate();
  }

  update(dt: number) {
    super.update(dt);
  }
}

export namespace TrapDoor {
  export enum State {
    CLOSED,
    OPEN,
  }
}
