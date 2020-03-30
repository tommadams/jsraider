import * as input from 'toybox/app/input';
import * as mat4 from 'toybox/math/mat4';
import * as vec3 from 'toybox/math/vec3';

import * as debug from 'debug';
import * as hacks from 'hacks';

import {GL} from 'toybox/gl/constants';
import {Context} from 'toybox/gl/context';
import {DynamicDraw} from 'toybox/gl/dynamic_draw';
import {ShaderProgram} from 'toybox/gl/shader';
import {Texture} from 'toybox/gl/texture';

import {Camera} from 'camera';
import {FlyCamera} from 'fly_camera';
import {Scene} from 'scene';


let params = new URLSearchParams(window.location.search);
let level = params.get('level');

let scene: Scene = null;
let draw: DynamicDraw = null;
let ctx: Context = null;
let atlasTex: Texture;
let lightTex: Texture;
let shaders: {[key: string]: ShaderProgram};
let activeShader = 'quad';

function render() {
  console.log(`shader: ${activeShader}`);

  let fov = 60 * Math.PI / 180;
  let aspectRatio = ctx.canvas.width / ctx.canvas.height;
  let view = mat4.newLookAt([16, -64, 256], [0, 0, 0], [0, -1, 0]);
  let proj = mat4.newPerspective(fov, aspectRatio, 1, 32 * 1024);
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

  draw.axis(mat4.newIdentity(), 128);
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
  let mesh = scene.lara.item.moveable.meshes[14];
  let batches = activeShader == 'tri' ? mesh.triBatches : mesh.quadBatches;
  for (let batch of batches) { ctx.draw(batch.va); }
}

document.addEventListener('keypress', (e) => {
  if (e.key == 'm') {
    activeShader = activeShader == 'quad' ? 'tri' : 'quad';
    render();
  }
});

let req = new XMLHttpRequest();
req.open('GET', 'levels/' + level, true);
req.responseType = 'arraybuffer';
req.onload = () => {
  if (req.status != 200) {
    throw new Error(
         'Failed to load "' + req.responseURL + '" : (' +
          req.status + ') ' + req.statusText);
  }

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
  scene = new Scene(level, req.response, ctx);
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
};
req.send(null);

input.enable();
