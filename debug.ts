import * as mat4 from 'toybox/math/mat4';
import * as vec3 from 'toybox/math/vec3';
import * as vec4 from 'toybox/math/vec4';

import {Context} from 'toybox/gl/context';
import {GL} from 'toybox/gl/constants';
import {DynamicDraw} from 'toybox/gl/dynamic_draw';

import {AnimCommand} from 'animation';
import {Lara} from 'lara';
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

export let draw: DynamicDraw = null;
export let tweak: TweakObject = null;

export let options = {
  animState: false,
  collision: false,
  fogStart: 8192,
  fogDensity: 0.13,
  lights: false,
  moveables: false,
  portals: false,
  triggers: false,
  slowMotion: false,
  sprites: false,
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
    {prop: 'fogStart', min: 0, max: 1024 * 64},
    {prop: 'fogDensity', min: 0, max: 1},
    {prop: 'lights'},
    {prop: 'moveables'},
    {prop: 'portals'},
    {prop: 'triggers'},
    {prop: 'slowMotion'},
    {prop: 'sprites'},
    {prop: 'stencilPortals'},
  ]);
}

export function drawLine(a: vec3.Type, b: vec3.Type, col: vec4.Type) {
  lines.push(new Line(a, b, col));
}

export function drawWireSphere(p: vec3.Type, r: number, col: vec4.Type) {
  spheres.push(new Sphere(p, r, col));
}

function drawOutlinePoly(verts: vec3.Type[], col: number[]) {
  draw.polygon(verts, col);
  let j = verts.length - 1;
  for (let i = 0; i < verts.length; ++i) {
    draw.line(verts[j], verts[i], [0, 0, 0]);
    j = i;
  }
}

function drawAnimState(lara: Lara) {
  if (lara.item.animState == null) {
    return;
  }
  let animState = lara.item.animState;
  let parts = [lara.debugString()];

  let numFrames = 1 + animState.anim.lastFrame - animState.anim.firstFrame;
  let frameNum = animState.frameIdx - animState.anim.firstFrame;
  let onLeftFoot = frameNum < numFrames / 2;
  parts.push('onLeftFoot: ' + onLeftFoot);

  let anim = animState.anim;
  parts.push(
    'idx:' + (animState.frameIdx - anim.firstFrame) + ' ofs:'+ animState.frameOfs,
    anim.toString(), '', 'Commands:');
  for (let command of anim.commands) {
    parts.push(
        `op: ${AnimCommand.Op[command.op]} [${command.operands.join(', ')}]`);
  }

  log.innerHTML = parts.join('\n');
}

function drawPortals(viewProj: mat4.Type, visibleRooms: VisibleRoom[]) {
  for (let visibleRoom of visibleRooms) {
    for (let portal of visibleRoom.room.portals) {
      // Portals face away from the room, so we have to reverse the winding order.
      let v = portal.vertices;
      draw.polygon([v[3], v[2], v[1], v[0]], [1, 0.5, 0, 0.4]);
    }
  }
  draw.flush(viewProj, 0.1);
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
    draw.wireSphere(collision.p, 64, [1, 0.5, 0]);
  }

  ctx.disable(GL.DEPTH_TEST);
  draw.flush(viewProj, 0.1);
  ctx.enable(GL.DEPTH_TEST);
}

function drawSprites(viewProj: mat4.Type, visibleRooms: VisibleRoom[]) {
  /*
  let transform = mat4.create();
  for (let item of app.scene_.items) {
    mat4.makeRotateY(transform, item.rotation[1]);
    mat4.setColumnValues(
        transform, 3,
        item.position[0], item.position[1], item.position[2], 1);
    this.debugDraw_.drawAxis(transform, 256);
  }
  */

  let transform = mat4.newZero();
  for (let visibleRoom of visibleRooms) {
    for (let item of visibleRoom.spriteSequences) {
      mat4.setRotateY(transform, item.rotation[1]);
      mat4.setColValues(
          transform, 3,
          item.position[0], item.position[1], item.position[2], 1);
      draw.axis(transform, 512);
    }
  }

  ctx.disable(GL.DEPTH_TEST);
  draw.flush(viewProj, 0.1);
  ctx.enable(GL.DEPTH_TEST);
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
        draw.obb(item.animState.transform, frame.min, frame.max, [0, 0, 1]);
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
          [transform[12], transform[13], transform[14]], 64, [0, 1, 0]);
      draw.wireSphere(item.position, 128, [1, 1, 0]);
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
        let col = [0, 1, 0, 0.2];
        let sx = Math.abs(sector.floorData.floorSlope[0]);
        let sz = Math.abs(sector.floorData.floorSlope[1]);
        if (sx > 512 || sz > 512) {
          if (sx >= sz) {
            col = [1, 0, 0, 0.2];
          } else if (sx < sz) {
            col = [0, 0, 1, 0.2];
          }
        }
        drawOutlinePoly(sector.quadCollision[idx++], col);
      }

      while (idx < sector.quadCollision.length) {
        drawOutlinePoly(sector.quadCollision[idx++], [0, 1, 1, 0.2]);
      }
      for (let collision of sector.triCollision) {
        drawOutlinePoly(collision, [0, 1, 1, 0.2]);
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
    drawOutlinePoly(poly, [1, 0, 0, 0.5]);
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
        draw.line(v[0], v[1], [1, 1, 0]);
        draw.line(v[2], v[3], [1, 1, 0]);
        draw.line(v[0], v[2], [1, 1, 0]);
        draw.line(v[1], v[3], [1, 1, 0]);
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
    drawAnimState(lara);
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
