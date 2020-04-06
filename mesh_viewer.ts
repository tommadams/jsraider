import * as mat4 from 'toybox/math/mat4';
import * as vec3 from 'toybox/math/vec3';

import * as hacks from 'hacks';

import {GL} from 'toybox/gl/constants';
import {Context} from 'toybox/gl/context';
import {DynamicDraw} from 'toybox/gl/dynamic_draw';
import {ShaderProgram} from 'toybox/gl/shader';
import {Texture} from 'toybox/gl/texture';

import {Camera} from 'camera';
import {FlyCamera} from 'fly_camera';
import {Item, Scene} from 'scene';


let params = new URLSearchParams(window.location.search);
let level = params.get('level');

let scene: Scene = null;
let draw: DynamicDraw = null;
let ctx: Context = null;
let atlasTex: Texture;
let lightTex: Texture;
let shaders: {[key: string]: ShaderProgram};
let activeShader = 'quad';
let rotY = 0;
let rotZ = 0;

let moveables: Item[] = [];

let moveableIdx = 0;
let meshIdx = 0;
let meshMin = vec3.newZero();
let meshMax = vec3.newZero();

function render() {
  let moveable = moveables[moveableIdx].moveable;
  let mesh = moveable.meshes[moveable.renderableMeshIndices[meshIdx]];

  let cy = Math.cos(rotY * Math.PI / 180);
  let sy = Math.sin(rotY * Math.PI / 180);
  let cz = Math.cos(rotZ * Math.PI / 180);
  let sz = Math.sin(rotZ * Math.PI / 180);
  let x = 0.5 * (meshMax[0] + meshMin[0]);
  let y = 0.5 * (meshMax[1] + meshMin[1]);
  let z = 0.5 * (meshMax[2] + meshMin[2]);
  let r = 1.5 * Math.max(meshMax[0] - meshMin[0], meshMax[1] - meshMin[1], meshMax[2] - meshMin[2]);

  let fov = 60 * Math.PI / 180;
  let aspectRatio = ctx.canvas.width / ctx.canvas.height;
  let view = mat4.newLookAt([r * sy * cz + x, -r * sz + y, r * cy * cz + z], [x, y, z], [0, -1, 0]);
  let proj = mat4.newPerspective(fov, aspectRatio, 1, 2 * r);
  let viewProj = mat4.mul(mat4.newZero(), proj, view);

  ctx.resizeCanvas();
  ctx.bindFramebuffer(null);
  ctx.colorMask(true, true, true, true);
  ctx.depthMask(true);
  ctx.disable(GL.BLEND);
  ctx.enable(GL.CULL_FACE);
  ctx.enable(GL.DEPTH_TEST);
  ctx.clearColor(0, 0, 0.2, 1);
  ctx.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT | GL.STENCIL_BUFFER_BIT);
  ctx.colorMask(true, true, true, false);

  draw.axis(mat4.newIdentity(), r);
  draw.flush(viewProj);

  ctx.useProgram(shaders[activeShader]);
  ctx.bindTexture('tex', atlasTex);
  ctx.bindTexture('lightTex', lightTex);
  ctx.setUniform('viewProj', viewProj);
  ctx.setUniform('fogStartDensity', 0, 0);
  ctx.setUniform('world', mat4.newIdentity());
  ctx.setUniform('ambient', 1);
  ctx.setUniform('lights', new Float32Array(16));
  ctx.setUniform('tint', 1, 1, 1);

  let batches = activeShader == 'tri' ? mesh.triBatches : mesh.quadBatches;
  for (let batch of batches) { ctx.draw(batch.va); }
}

function updateMeshBounds() {
  console.log(`moveable: ${moveableIdx}  mesh: ${meshIdx}`);
  let mesh = moveables[moveableIdx].moveable.meshes[meshIdx];
  let p = mesh.positions;
  vec3.setFromValues(meshMin, p[0], p[1], p[2]);
  vec3.setFromValues(meshMax, p[0], p[1], p[2]);
  let tmp = vec3.newZero();
  for (let i = 3; i < p.length; i += 3) {
    vec3.setFromValues(tmp, p[i], p[i+1], p[i+2]);
    vec3.min(meshMin, meshMin, tmp);
    vec3.max(meshMax, meshMax, tmp);
  }
}

function init(levelData: ArrayBuffer) {
  let canvasElem = document.getElementById('canvas') as HTMLCanvasElement;
  ctx = new Context(canvasElem, {
    antialias: true,
    depth: true,
    stencil: true,
    requiredExtensions: [
      'EXT_texture_filter_anisotropic',
    ],
  });

  draw = new DynamicDraw(ctx);
  scene = new Scene(level, levelData, ctx);
  hacks.applyPostInitHacks(level, scene);

  atlasTex = ctx.newTexture2D({
    width: scene.atlasTex.width,
    height: scene.atlasTex.height,
    data: scene.atlasTex.data,
    filter: GL.LINEAR_MIPMAP_LINEAR,
    wrap: GL.CLAMP_TO_EDGE,
    format: GL.RGBA8});
  ctx.generateMipmap(GL.TEXTURE_2D);

  lightTex = ctx.newTexture2D({
    width: scene.lightTex.width,
    height: scene.lightTex.height,
    data: scene.lightTex.data,
    filter: GL.LINEAR,
    wrap: GL.CLAMP_TO_EDGE,
    format: GL.RGB10_A2,
  });

  shaders = {
      quad: ctx.newShaderProgram('shaders/quad.vs', 'shaders/quad.fs',
                                 {defines: {ENABLE_LIGHTING: 1}}),
      tri: ctx.newShaderProgram('shaders/tri.vs', 'shaders/tri.fs',
                                {defines: {ENABLE_LIGHTING: 1}}),
  };

  (window as any).scene = scene;

  ctx.onInit(render);
  ctx.init();

  for (let item of scene.items) {
    if (item.moveable != null && item.moveable.meshes.length != 0) {
      if (item == scene.lara.item) {
        moveableIdx = moveables.length;
      }
      moveables.push(item);
    }
  }
  updateMeshBounds();

  document.addEventListener('keypress', (e) => {
    switch (e.key) {
      case 'm':
        activeShader = activeShader == 'quad' ? 'tri' : 'quad';
        console.log(`shader: ${activeShader}`);
        break;

      case '[':
        if (--meshIdx == -1) {
          if (--moveableIdx == -1) {
            moveableIdx = moveables.length - 1;
          }
          meshIdx = moveables[moveableIdx].moveable.renderableMeshIndices.length - 1;
        }
        updateMeshBounds();
        break;

      case ']':
        if (++meshIdx == moveables[moveableIdx].moveable.renderableMeshIndices.length) {
          if (++moveableIdx == moveables.length) {
            moveableIdx = 0;
          }
          meshIdx = 0;
        }
        updateMeshBounds();
        break;

      default:
        return;
    }

    render();
  });

  canvasElem.addEventListener('mousemove', (e) => {
    if (e.buttons & 1) {
      rotY += e.movementX;
      rotZ += e.movementY;
      render();
    }
  });
}

let req = new XMLHttpRequest();
req.open('GET', 'levels/' + level, true);
req.responseType = 'arraybuffer';
req.onload = () => {
  if (req.status != 200) {
    throw new Error(
         'Failed to load "' + req.responseURL + '" : (' +
          req.status + ') ' + req.statusText);
  }

  init(req.response);
};
req.send(null);
