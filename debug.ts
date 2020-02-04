import * as mat4 from 'toybox/math/mat4';
import * as vec3 from 'toybox/math/vec3';
import * as vec4 from 'toybox/math/vec4';

import {Context} from 'toybox/gl/context';
import {GL} from 'toybox/gl/constants';
import {DynamicDraw} from 'toybox/gl/dynamic_draw';

import {AnimCommand} from 'animation';
import {Lara} from 'controllers/lara';
import {Room} from 'scene';
import {VisibleRoom} from 'visibility';

// TODO(tom): move tweakObject into main app
import {TweakObject} from 'toybox/app/tweaks';

class Line {
  constructor(public a: vec3.Type, public b: vec3.Type, public col: vec4.Type) {}
}

class Sphere {
  constructor(public p: vec3.Type, public r: number, public col: vec4.Type) {}
}

let ctx: Context;
let lines: Line[] = [];
let spheres: Sphere[] = [];
let log: HTMLElement = null;

const CYAN = vec4.newFromValues(0, 1, 1, 1);
const MAGENTA = vec4.newFromValues(1, 0, 1, 1);
const GREEN = vec4.newFromValues(0, 1, 0, 1);
const BLUE = vec4.newFromValues(0, 0, 1, 1);
const YELLOW = vec4.newFromValues(1, 1, 0, 1);
const ORANGE = vec4.newFromValues(1, 0.5, 0, 1);
const PORTAL_BLUE = vec4.newFromValues(0, 0, 0.8, 0.3);
const FLOOR_FLAT = vec4.newFromValues(0, 1, 0, 0.2);
const FLOOR_SLOPE_X = vec4.newFromValues(1, 0, 0, 0.2);
const FLOOR_SLOPE_Z = vec4.newFromValues(0, 0, 1, 0.2);
const COLLISION_CYAN = vec4.newFromValues(0, 1, 1, 0.2);
const BOX_RED = vec4.newFromValues(1, 0, 0, 0.5);

export let draw: DynamicDraw = null;
export let tweak: TweakObject = null;

export let options = {
  animState: true,
  collision: false,
  fogStart: 4096,
  fogDensity: 0.065,
  lights: false,
  moveables: false,
  portals: false,
  triggers: false,
  slowMotion: false,
  sprites: false,
  staticMeshes: true,
  stencilPortals: true,
};

// TODO(tom): don't draw anim state when log isn't in view.

export function init(context: Context) {
  ctx = context;
  draw = new DynamicDraw(ctx);
  log = document.getElementById('log');

  let elem = document.getElementById('options');
  tweak = new TweakObject(elem, options, [
    {
      prop: 'animState',
      onChange: (newValue) => {
        if (!newValue) {
          log.innerHTML = '';
        }
      },
    },
    {prop: 'collision'},
    {prop: 'fogStart', min: 0, max: 1024 * 16},
    {prop: 'fogDensity', min: 0, max: 1, squash: 2},
    {prop: 'lights'},
    {prop: 'moveables'},
    {prop: 'portals'},
    {prop: 'triggers'},
    {prop: 'slowMotion'},
    {prop: 'sprites'},
    {prop: 'staticMeshes'},
    {prop: 'stencilPortals'},
  ]);
}

export function drawLine(a: vec3.Type, b: vec3.Type, col: vec4.Type) {
  lines.push(new Line(a, b, col));
}

export function drawWireSphere(p: vec3.Type, r: number, col: vec4.Type) {
  spheres.push(new Sphere(p, r, col));
}

// TODO(tom): rename to something else. In fact, just create a proper log.
function drawAnimState(cameraRoom: Room, lara: Lara, visibleRooms: VisibleRoom[]) {
  // let item = (window as any)['app'].scene.items[10];
  // let animState = item.animState;
  // let parts = [];
  // let anim = animState.anim;
  // parts.push(
  //   `idx:${(animState.frameIdx - anim.firstFrame)} ofs:${animState.frameOfs.toFixed(2)}`,
  //   anim.toString(), '', 'Commands:');
  // for (let command of anim.commands) {
  //   parts.push(
  //       `op: ${AnimCommand.Op[command.op]} [${command.operands.join(', ')}]`);
  // }

  let animState = lara.item.animState;
  let anim = animState.anim;

  let parts = [`cam room:${cameraRoom.id}`, lara.toString()];
  let roomIds = [];
  for (let visibleRoom of visibleRooms) {
    roomIds.push(visibleRoom.room.id);
  }

  parts.push(
    `visibleRooms: [${roomIds.join(', ')}]`,
    `idx:${(animState.frameIdx - anim.firstFrame)} ofs:${animState.frameOfs.toFixed(2)}`,
    anim.toString(), '', 'Commands:');
  for (let command of anim.commands) {
    parts.push(
        `op: ${AnimCommand.Op[command.op]} [${command.operands.join(', ')}]`);
  }

  log.innerText = parts.join('\n');
}

function drawPortals(viewProj: mat4.Type, visibleRooms: VisibleRoom[]) {
  ctx.disable(GL.DEPTH_TEST);
  for (let visibleRoom of visibleRooms) {
    for (let portal of visibleRoom.room.portals) {
      // Portals face away from the room, so we have to reverse the winding order.
      let v = portal.vertices;
      draw.polygon([v[3], v[2], v[1], v[0]], PORTAL_BLUE);
    }
  }
  draw.flush(viewProj, 0.1);
  ctx.enable(GL.DEPTH_TEST);
}

function drawLights(room: Room, viewProj: mat4.Type) {
  for (let light of room.lights) {
    draw.wireSphere(
        light.position, light.fade,
        [light.intensity, light.intensity, light.intensity]);
  }
  draw.flush(viewProj, 0.1);

  for (let light of room.lights) {
    draw.wireSphere(
        light.position, light.fade,
        [light.intensity, light.intensity, light.intensity, 0.2]);
  }
  ctx.disable(GL.DEPTH_TEST);
  draw.flush(viewProj, 0.1);
  ctx.enable(GL.DEPTH_TEST);
}

 
function drawLaraCollisions(lara: Lara, viewProj: mat4.Type) {
  for (let collision of lara.collisions) {
    draw.wireSphere(collision.p, 64, ORANGE);
  }

  ctx.disable(GL.DEPTH_TEST);
  draw.flush(viewProj, 0.1);
  ctx.enable(GL.DEPTH_TEST);
}

function drawSprites(viewProj: mat4.Type, visibleRooms: VisibleRoom[]) {
  let transform = mat4.newZero();
  for (let visibleRoom of visibleRooms) {
    for (let item of visibleRoom.spriteSequences) {
      mat4.setRotateY(transform, item.rotation[1]);
      mat4.setRowValues(
          transform, 3,
          item.position[0], item.position[1], item.position[2], 1);
      draw.axis(transform, 512);
    }
  }

  ctx.disable(GL.DEPTH_TEST);
  draw.flush(viewProj, 0.1);
  ctx.enable(GL.DEPTH_TEST);
}

function drawStaticMeshes(viewProj: mat4.Type, visibleRooms: VisibleRoom[]) {
  let min = vec3.newZero();
  let max = vec3.newZero();
  for (let visibleRoom of visibleRooms) {
    for (let mesh of visibleRoom.room.staticMeshes) {
      let vb = mesh.staticMesh.visibilityBox;
      draw.obb(mesh.transform,
               vec3.setFromValues(min, vb[0], vb[2], vb[4]),
               vec3.setFromValues(max, vb[1], vb[3], vb[5]),
               MAGENTA);

      let p = mesh.position;
      let cb = mesh.staticMesh.collisionBox;
      draw.obb(mesh.transform,
               vec3.setFromValues(min, cb[0], cb[2], cb[4]),
               vec3.setFromValues(max, cb[1], cb[3], cb[5]),
               mesh.staticMesh.flags == 3 ? YELLOW : CYAN);
    }
  }

  draw.flush(viewProj, 0.1);
}

function drawMoveables(viewProj: mat4.Type, visibleRooms: VisibleRoom[]) {
  for (let visibleRoom of visibleRooms) {
    for (let item of visibleRoom.moveables) {
      let moveable = item.moveable;
      for (let i = 0; i < moveable.meshes.length; ++i) {
        let mesh = moveable.meshes[i];
        if (mesh == null) {
          continue;
        }
        let transform = item.animState.meshTransforms[i];
        draw.axis(transform, 64);
      }

      if (item.animState != null) {
        let frame = item.animState.frame;
        draw.obb(item.animState.transform, frame.min, frame.max, BLUE);
      }
    }
  }

  ctx.disable(GL.DEPTH_TEST);
  draw.flush(viewProj, 0.1);
  ctx.enable(GL.DEPTH_TEST);

  for (let visibleRoom of visibleRooms) {
    for (let item of visibleRoom.moveables) {
      let transform = item.animState.meshTransforms[0];
      draw.wireSphere(
          [transform[12], transform[13], transform[14]], 64, GREEN);
      draw.wireSphere(item.position, 128, YELLOW);
    }
  }
  draw.flush(viewProj, 0.1);
}

function drawCollision(room: Room, viewProj: mat4.Type) {
  let basei = room.x / 1024;
  let basej = room.z / 1024;
  for (let j = basej; j < basej + room.sectorTableHeight; ++j) {
    for (let i = basei; i < basei + room.sectorTableWidth; ++i) {
      let sector = room.getSectorByGrid(i, j);

      let idx = 0;
      if (sector.roomBelow == null && sector.quadCollision.length > 0) {
        let col = FLOOR_FLAT;
        let sx = Math.abs(sector.floorData.floorSlope[0]);
        let sz = Math.abs(sector.floorData.floorSlope[1]);
        if (sx > 512 || sz > 512) {
          if (sx >= sz) {
            col = FLOOR_SLOPE_X;
          } else if (sx < sz) {
            col = FLOOR_SLOPE_Z;
          }
        }
        draw.outlinePolygon(sector.quadCollision[idx++], col);
      }

      while (idx < sector.quadCollision.length) {
        draw.outlinePolygon(sector.quadCollision[idx++], COLLISION_CYAN);
      }
      for (let collision of sector.triCollision) {
        draw.outlinePolygon(collision, COLLISION_CYAN);
      }
    }
  }

  /*
  let boxes = new Set<Box>();
  for (let j = basej; j < basej + room.sectorTableHeight; ++j) {
    for (let i = basei; i < basei + room.sectorTableWidth; ++i) {
      let sector = room.getSectorByGrid(i, j);
      if (sector.boxIdx != 0xffff) {
        boxes.add((window as any)['app'].scene.boxes[sector.boxIdx]);
      }
    }
  }
  for (let box of boxes.values()) {
    let poly = [
      vec3.newFromValues(box.zmin, box.floor, box.zmin),
      vec3.newFromValues(box.zmax, box.floor, box.zmin),
      vec3.newFromValues(box.zmax, box.floor, box.zmax),
      vec3.newFromValues(box.zmin, box.floor, box.zmax),
    ];
    draw.outlinePolygon(poly, BOX_RED);
  }
  */

  draw.flush(viewProj, 0.1);
}

function drawTriggers(room: Room, viewProj: mat4.Type) {
  let a = vec3.newZero();
  let b = vec3.newZero();
  let c = vec3.newZero();
  let d = vec3.newZero();
  let v = [a, b, c, d];

  let basei = room.x / 1024;
  let basej = room.z / 1024;
  for (let j = basej; j < basej + room.sectorTableHeight; ++j) {
    for (let i = basei; i < basei + room.sectorTableWidth; ++i) {
      let sector = room.getSectorByGrid(i, j);
      if (sector.floorData.portal != null) {
        continue;
      }
      if (sector.floorData.funcs.length > 0) {
        sector.getFloorVertex(0, 0, a);
        sector.getFloorVertex(1, 0, b);
        sector.getFloorVertex(0, 1, c);
        sector.getFloorVertex(1, 1, d);
        draw.line(v[0], v[1], YELLOW);
        draw.line(v[2], v[3], YELLOW);
        draw.line(v[0], v[2], YELLOW);
        draw.line(v[1], v[3], YELLOW);
      }
    }
  }
  draw.flush(viewProj, 0.1);
}

export function render(
    lara: Lara, cameraRoom: Room, rooms: Room[], viewProj: mat4.Type, visibleRooms: VisibleRoom[]) {
  ctx.depthMask(false);
  ctx.blendFunc(GL.ONE, GL.ONE_MINUS_SRC_ALPHA);
  ctx.enable(GL.BLEND);

  if (options.animState) {
    drawAnimState(cameraRoom, lara, visibleRooms);
  }
  if (options.collision) {
    drawCollision(cameraRoom, viewProj);
  }

  if (options.lights) {
    drawLights(cameraRoom, viewProj);
  }
  if (options.triggers) {
    for (let room of rooms) {
      drawTriggers(room, viewProj);
    }
  }
  if (options.portals) {
    drawPortals(viewProj, visibleRooms);
  }
  if (options.sprites) {
    drawSprites(viewProj, visibleRooms);
  }
  if (options.moveables) {
    drawMoveables(viewProj, visibleRooms);
    drawLaraCollisions(lara, viewProj);
  }
  if (options.staticMeshes) {
    drawStaticMeshes(viewProj, visibleRooms);
  }

  if (lines.length > 0 || spheres.length > 0) {
    for (let line of lines) {
      draw.line(line.a, line.b, line.col);
    }
    for (let sphere of spheres) {
      draw.wireSphere(sphere.p, sphere.r, sphere.col);
    }
    draw.flush(viewProj, 0.1);
    lines = [];
    spheres = [];
  }

  ctx.disable(GL.BLEND);
  ctx.depthMask(true);
}
