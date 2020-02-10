import * as vec2 from 'toybox/math/vec2';

import {Door} from 'controllers/door';
import {Component, EntityType} from 'entity/entity';
import {Item, Scene, Sector} from 'scene';

export class Bridge extends Component {
  slope = vec2.newZero();
  floor: number;

  constructor(item: Item) {
    super(item);

    let slope = 0;
    if (item.type == EntityType.BRIDGE_SLOPE_1) {
      slope = 256;
    } else if (item.type == EntityType.BRIDGE_SLOPE_2) {
      slope = 512;
    }

    let dir = (item.rawRotation / 16384)|0;
    dir = dir % 4;
    if (dir < 0) { dir += 4; }

    switch (dir) {
      case 0: this.slope[0] = slope; break;
      case 1: this.slope[1] = -slope; break;
      case 2: this.slope[0] = -slope; break;
      case 3: this.slope[1] = slope; break;
    }

    this.floor = item.position[1];
  }

  activate() {
    let door = this.item.getComponent(Door);
    let activate = (door == null ||
                    door.item.animState.anim.state == Door.State.CLOSED);
    let floorData = this.item.getSector().getResolvedFloorSector().floorData;
    if (door == null || door.item.animState.anim.state == Door.State.CLOSED) {
      floorData.bridge = this;
    } else {
      floorData.bridge = null;
    }
    return super.activate();
  }
}

