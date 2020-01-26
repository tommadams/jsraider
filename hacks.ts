import {Scene} from 'scene'

export let stencilRooms = new Uint8Array(0);

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
  stencilRooms = new Uint8Array(scene.rooms.length);
  switch (levelName) {
    case 'GYM.PHD':
      stencilRooms[3] = 1;
      stencilRooms[4] = 1;
      stencilRooms[5] = 1;
      stencilRooms[6] = 1;
      stencilRooms[16] = 1;
      stencilRooms[17] = 1;
      stencilRooms[18] = 1;
      break;
    case 'LEVEL02.PHD':
      stencilRooms[30] = 1;
      break;
  }
}
