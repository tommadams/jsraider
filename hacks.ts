import {Scene} from 'scene'

export let stencilRooms: boolean[] = [];

function maybeSwapLara_(levelName: string, scene: Scene) {
  // Swap Lara's mesh when at home.
  if (levelName == 'GYM.PHD') {
    var src = scene.moveables[5];
    var dst = scene.moveables[0];
    for (var i = 0; i < dst.meshes.length; ++i) {
      if (src.meshes[i] != null) {
        dst.meshes[i] = src.meshes[i];
      }
    }
  }
}

export function applyPostLoadHacks(levelName: string, scene: Scene) {
  if (levelName == 'LEVEL02.PHD') {
    // Room 8 in City of Vilcabamba has two overlapping sprites.
    // Remove one of them.
    var room = scene.rooms[8];
    room.sprites = new Uint16Array([room.sprites[0], room.sprites[1]]);
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
  }
}
