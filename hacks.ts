import {Bridge} from 'entity/bridge'
import {Scene, Trigger} from 'scene'

export let stencilRooms: boolean[] = [];

function maybeSwapLara_(levelName: string, scene: Scene) {
  // Swap Lara's mesh when at home.
  if (levelName == 'GYM.PHD') {
    let src = scene.moveables[5];
    let dst = scene.moveables[0];
    for (let i = 0; i < dst.meshes.length; ++i) {
      if (src.meshes[i] != null) {
        dst.meshes[i] = src.meshes[i];
      }
    }
  }
}

export function applyPostLoadHacks(levelName: string, scene: Scene) {
  switch (levelName) {
    case 'LEVLE02.PHD':
      // Room 8 in City of Vilcabamba has two overlapping sprites.
      // Remove one of them.
      let room = scene.rooms[8];
      room.sprites = new Uint16Array([room.sprites[0], room.sprites[1]]);
    break;

    case 'LEVEL03A.PHD':
      // The broken bridge pieces are buried under the ground several world
      // units, which is too far to fix by applying a polygonOffset when
      // rendering without causing other artifacts. Instead, we nudge their
      // position a bit.
      scene.items[48].position[1] -= 8;
      scene.items[49].position[1] -= 8;
      break;
  }
}

export function applyPostInitHacks(levelName: string, scene: Scene) {
  maybeSwapLara_(levelName, scene);

  // Some rooms overlap in space (e.g. the views from the windows in Lara's
  // house). This was fine in the original Tomb Raider engine because each
  // polygon is clipped to the active portal area. We don't bother doing that,
  // which can cause rendering issues for these overlapping rooms.
  // To fix known bad rooms, we mask out the exact pixels that should be draw
  // by generating a stencil mask from the room's portals.
  switch (levelName) {
    // The views from several windows in Lara's house overlap each other.
    case 'GYM.PHD':
      // Music room windows.
      stencilRooms[2] = true;
      stencilRooms[6] = true;

      // Gym windows.
      stencilRooms[3] = true;
      stencilRooms[4] = true;
      stencilRooms[5] = true;

      // Front windows.
      stencilRooms[16] = true;
      stencilRooms[17] = true;
      stencilRooms[18] = true;
      break;

    case 'LEVEL02.PHD':
      // Part of the underwater section of City of Vilcabamba overlaps the first
      // hub area.
      stencilRooms[26] = true;
      break;

    case 'LEVEL03A.PHD':
      // There's one broken fallen piece that that doesn't have proper
      // collision. The reason is that the engine only supports one bridge piece
      // in each sector and there's a real bridge above the fallen one. Fix this
      // by moving the fallen piece to a neighbouring sector and adding
      // collision.
      let fd = scene.rooms[56].sectorTable[16].floorData;
      let trigger = scene.rooms[56].sectorTable[16].floorData.trigger;
      trigger.actions.push({type: Trigger.Action.Type.ACTIVATE, parameter: 45});
      scene.items[45].position[2] += 2048;
      scene.items[45].getComponent(Bridge).activate();
      scene.items[45].controller.update(0);
      break;
  }
}
