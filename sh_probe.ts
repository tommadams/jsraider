import * as sh3 from 'toybox/math/sh3';
import * as vec3 from 'toybox/math/vec3';

import {DynamicCubeMap, FORWARD, RIGHT, UP} from 'toybox/gl/dynamic_cube_map';

function areaElement(u: number, v: number) {
  return Math.atan2(u * v, Math.sqrt(u * u + v * v + 1));
}

function solidAngle(u: number, v: number, duv: number) {
  let u0 = u - duv;
  let v0 = v - duv;
  let u1 = u + duv;
  let v1 = v + duv;
  return areaElement(u0, v0) - areaElement(u0, v1) - areaElement(u1, v0) + areaElement(u1, v1);
}

/**
 * Projects a cube map into a spherical harmonic irradiance map.
 * @param dst destination spherical harmonics
 * @param cubeMap cube map to project
 */
export function projectIrradiance(dst: sh3.Type, cubeMap: DynamicCubeMap) {
  sh3.setZero(dst);

  let size = cubeMap.size;
  let duv = 1 / size;
  let col = vec3.newZero();
  let dir = vec3.newZero();
  for (let i = 0; i < 6; ++i) {
    let face = cubeMap.faces[i];
    let forward = FORWARD[i];
    let right = RIGHT[i];
    let up = UP[i];
    let idx = 0;
    for (let j = 0; j < size; ++j) {
      let v = (2 * (j + 0.5) * duv) - 1;
      for (let i = 0; i < size; ++i) {
        let u = (2 * (i + 0.5) * duv) - 1;
        vec3.addScaled(dir, forward, up, u);
        vec3.addScaled(dir, dir, right, u);
        vec3.normalize(dir, dir);

        // The division by pi bakes in the normalization factor required to
        // make the diffuse lighting model energy conserving.
        let w = solidAngle(u, v, duv) / Math.PI;

        let r = w * Math.pow(face.pixels[idx++] / 255, 2.2);
        let g = w * Math.pow(face.pixels[idx++] / 255, 2.2);
        let b = w * Math.pow(face.pixels[idx++] / 255, 2.2);
        idx += 1;
        vec3.setFromValues(col, r, g, b);

        sh3.project(dst, col, dir);
      }
    }
  }

  sh3.radianceToIrradiance(dst, dst);
}

// Temporary SH used when sampling;
let tmp0 = sh3.newZero();
let tmp1 = sh3.newZero();
let tmp2 = sh3.newZero();
let tmp3 = sh3.newZero();

class Probe {
  sh = sh3.newZero();
  constructor(public y: number) {}
}

export class ShProbeField {
  probes: Probe[][];

  constructor(public minX: number, public minZ: number, public cellSize: number,
              public width: number, public height: number) {
    if (width < 2 || height < 2) {
      // This constraint is just for simplicity.
      throw new Error(`Width and height must be >= 2, got (${width}, ${height}`);
    }
    this.probes = new Array<Probe[]>(width * height);
    for (let i = 0; i < width * height; ++i) {
      this.probes[i] = [];
    }
  }

  insertProbe(i: number, j: number, y: number) {
    let probes = this.probes[i + j * this.width];
    if (probes.length > 0 && y <= probes[probes.length - 1].y) {
      throw new Error('Probes must be added in increasing Y order');
    }
    let probe = new Probe(y);
    probes.push(probe);
    return probe;
  }

  sample(dst: sh3.Type, pos: vec3.Type) {
    let i = ((pos[0] - this.minX) / this.cellSize - 0.5) | 0;
    let u: number;
    if (i < 0) {
      i = 0;
      u = 0;
    } else if (i > this.width - 2) {
      i = this.width - 2;
      u = 1;
    } else {
      let x = pos[0] / this.cellSize - 0.5;
      u = x - Math.floor(x);
    }

    let j = ((pos[2] - this.minZ) / this.cellSize - 0.5) | 0;
    let v: number;
    if (j < 0) {
      j = 0;
      v = 0;
    } else if (j > this.height - 2) {
      j = this.height - 2;
      u = 1;
    } else {
      let z = pos[2] / this.cellSize - 0.5;
      v = z - Math.floor(z);
    }

    let y = pos[1];
    let a = tmp0;
    let b = tmp1;
    let c = tmp2;
    let d = tmp3;
    let aOk = this.sampleXz(a, i,     j,     y);
    let bOk = this.sampleXz(b, i + 1, j,     y);
    let cOk = this.sampleXz(c, i,     j + 1, y);
    let dOk = this.sampleXz(d, i + 1, j + 1, y);

    if (aOk) {
      if (bOk) {
        sh3.lerp(a, a, b, u);
      }
    } else if (bOk) {
      a = b;
      aOk = true;
    }

    if (cOk) {
      if (dOk) {
        sh3.lerp(c, c, d, u);
      }
    } else if (dOk) {
      c = d;
      cOk = true;
    }

    if (aOk) {
      if (cOk) {
        sh3.lerp(dst, a, c, v);
      } else {
        sh3.setFromSh(dst, a);
      }
    } else {
      sh3.setFromSh(dst, c);
    }
  }

  private sampleXz(dst: sh3.Type, i: number, j: number, y: number) {
    let probes = this.probes[i + j * this.width];
    if (probes.length == 0) {
      return false;
    }

    let idx = 0;
    while (idx < probes.length - 2) {
      if (y < probes[idx + 1].y) {
        break;
      }
      idx += 1;
    }

    let a = probes[idx];
    if (y <= a.y) {
      sh3.setFromSh(dst, a.sh);
    } else if (idx == probes.length - 1) {
      sh3.setFromSh(dst, probes[probes.length - 1].sh);
    } else {
      let b = probes[idx + 1];
      sh3.lerp(dst, a.sh, b.sh, (y - a.y) / (b.y - a.y));
    }
    return true;
  }
}
