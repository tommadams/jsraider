import * as vec3 from 'toybox/math/vec3';

import {Bridge} from 'entity/bridge';
import {EntityType} from 'entity/entity';
import {Mesh, Scene, Trigger} from 'scene';

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
  fixSaveCrystalNormals(scene);

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
      // Starting room windows.
      stencilRooms[1] = true;
      stencilRooms[15] = true;

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

// The TR1 save crystal mesh is only made up of six triangles and their
// vertices have smoothed normals, which looks pretty bad.
// Calculate nicer normals for the mesh.
function fixSaveCrystalNormals(scene: Scene) {
  for (let moveable of scene.moveables) {
    if (moveable.type != EntityType.SAVE_CRYSTAL) { continue; }
    for (let i = 0; i < moveable.meshCount; ++i) {
      let mesh = scene.meshes[moveable.firstMesh + i];
      if (mesh.coloredTris.length == 0) {
        throw new Error('expected colored tris for save crystal');
      }
      let ps: vec3.Type[] = [];
      let ns: vec3.Type[] = [];
      let pab = vec3.newZero();
      let pac = vec3.newZero();
      for (let i = 0; i < mesh.coloredTris.length; i += 4) {
        let a = mesh.coloredTris[i] * 3;
        let b = mesh.coloredTris[i + 1] * 3;
        let c = mesh.coloredTris[i + 2] * 3;

        // Get the vertex positions.
        let pa = vec3.newFromValues(mesh.vertices[a], mesh.vertices[a + 1], mesh.vertices[a + 2]);
        let pb = vec3.newFromValues(mesh.vertices[b], mesh.vertices[b + 1], mesh.vertices[b + 2]);
        let pc = vec3.newFromValues(mesh.vertices[c], mesh.vertices[c + 1], mesh.vertices[c + 2]);

        // Get the vertex normals.
        let na = vec3.newFromValues(mesh.normals[a], mesh.normals[a + 1], mesh.normals[a + 2]);
        let nb = vec3.newFromValues(mesh.normals[b], mesh.normals[b + 1], mesh.normals[b + 2]);
        let nc = vec3.newFromValues(mesh.normals[c], mesh.normals[c + 1], mesh.normals[c + 2]);
        vec3.normalize(na, na);
        vec3.normalize(nb, nb);
        vec3.normalize(nc, nc);

        // Calculate the face normal.
        vec3.sub(pab, pb, pa);
        vec3.sub(pac, pc, pa);
        let nf = vec3.cross(vec3.newZero(), pac, pab);
        vec3.normalize(nf, nf);

        // Calculate new vertex normals.
        vec3.normalize(na, vec3.add(na, na, nf));
        vec3.normalize(nb, vec3.add(nb, nb, nf));
        vec3.normalize(nc, vec3.add(nc, nc, nf));

        ps.push(pa, pb, pc);
        ns.push(na, nb, nc);
      }

      // Fix up the mesh data.
      let vertices = new Int16Array(ps.length * 3);
      let normals = new Int16Array(ns.length * 3);
      let coloredTris = new Uint16Array(ps.length * 4);
      for (let i = 0; i < ps.length; ++i) {
        vertices[i * 3    ] = ps[i][0];
        vertices[i * 3 + 1] = ps[i][1];
        vertices[i * 3 + 2] = ps[i][2];
        normals[i * 3    ] = 16383 * ns[i][0];
        normals[i * 3 + 1] = 16383 * ns[i][1];
        normals[i * 3 + 2] = 16383 * ns[i][2];
        coloredTris[i * 4    ] = i * 3;
        coloredTris[i * 4 + 1] = i * 3 + 1;
        coloredTris[i * 4 + 2] = i * 3 + 2;
        coloredTris[i * 4 + 3] = mesh.coloredTris[i * 4 + 3];
      }
      mesh.vertices = vertices;
      mesh.normals = normals;
      mesh.coloredTris = coloredTris;
    }
  }

}

