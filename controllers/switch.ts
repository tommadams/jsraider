import {AnimationId} from 'animation';
import {Controller} from 'controllers/controller';
import {Item, ItemType, Scene, Sector, TriggerType} from 'scene';
import {State} from 'state';

export class Switch extends Controller {
  private sector: Sector;

  constructor(item: Item, scene: Scene) {
    super(item, scene);
    // TODO(tom): move sector into Controller base class (and remove Lara.sector).
    this.sector = this.item.room.getSectorByPosition(this.item.position);
  }

  update(dt: number) {
    super.update(dt);
  }

  protected onAnimFrameChange() {
    let anim = this.item.animState.anim;
    if (anim.firstFrame == anim.lastFrame) {
      let func = this.sector.getTrigger(TriggerType.SWITCH);
      // Skip the first 2 actions: the first action, which are the trigger
      // and switch data.
      this.scene.runFloorFunc(func, 2, 1 - anim.state);
    }
  }
}

export function isSwitch(controller: Controller): controller is Switch {
  return (controller.item.type == ItemType.SWITCH ||
          controller.item.type == ItemType.UNDERWATER_SWITCH);
}
