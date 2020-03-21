import * as sh3 from 'toybox/math/sh3';
import * as vec3 from 'toybox/math/vec3';

import {DynamicCubeMap, FORWARD, RIGHT, UP} from 'toybox/gl/dynamic_cube_map';
import {Light, Room} from 'scene';

// Temporary SH used when sampling;
let tmp0 = sh3.newZero();
let tmp1 = sh3.newZero();
let tmp2 = sh3.newZero();
let tmp3 = sh3.newZero();

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

export class Probe {
  sh = sh3.newZero();
  dir = vec3.newZero();
  col = vec3.newZero();

  constructor(public y: number, lightDir: vec3.Type, cubeMap: DynamicCubeMap) {
    let size = cubeMap.size;
    let duv = 1 / size;
    let col = vec3.newZero();
    let dir = vec3.newZero();
    let n = vec3.newZero();
    let lum = vec3.newFromValues(1/3, 1/3, 1/3);
    let safeDir = vec3.newFromValues(0, 1, 0);
    let colNorm = 0;
    let minDist = 100;
    for (let i = 0; i < 6; ++i) {
      let bounce = cubeMap.faces[i].pixels[0];
      let direct = cubeMap.faces[i].pixels[1];
      let normal = cubeMap.faces[i].pixels[2];

      let forward = FORWARD[i];
      let right = RIGHT[i];
      let up = UP[i];
      let idx = 0;
      let r, g, b: number;
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

          vec3.setFromValues(n, normal[idx] - 127.5, normal[idx + 1] - 127.5, normal[idx + 2] - 127.5);
          vec3.normalize(n, n);

          r = w * Math.pow(bounce[idx] / 255, 2.2);
          g = w * Math.pow(bounce[idx + 1] / 255, 2.2);
          b = w * Math.pow(bounce[idx + 2] / 255, 2.2);
          vec3.setFromValues(col, r, g, b);
          sh3.project(this.sh, col, dir);

          let distance = normal[idx + 3] / 255;
          if (distance < minDist) {
            vec3.setFromValues(col, direct[idx], direct[idx+1], direct[idx+2]);
          }
          let dw = w / (distance * distance);
          colNorm += dw;
          r = dw * Math.pow(direct[idx] / 255, 2.2);
          g = dw * Math.pow(direct[idx + 1] / 255, 2.2);
          b = dw * Math.pow(direct[idx + 2] / 255, 2.2);

          vec3.setFromValues(col, r, g, b);
          vec3.add(this.col, this.col, col);

          let lw = dw * vec3.dot(col, lum);
          vec3.addScaled(this.dir, this.dir, n, lw);

          idx += 4;
        }
      }
    }

    vec3.scale(this.col, 1 / colNorm, this.col);

    vec3.safeNormalize(this.dir, this.dir, safeDir);

    vec3.safeNormalize(this.dir, lightDir, safeDir);

    sh3.radianceToIrradiance(this.sh, this.sh);
  }
}

//// /**
////  * Projects a cube map into a spherical harmonic irradiance map.
////  * @param dst destination probe
////  * @param cubeMap cube map to project
////  */
//// export function projectIrradiance(dst: Probe, cubeMap: DynamicCubeMap) {
////   sh3.setZero(dst);
////
////   let size = cubeMap.size;
////   let duv = 1 / size;
////   let col = vec3.newZero();
////   let dir = vec3.newZero();
////   let n = vec3.newZero();
////   for (let i = 0; i < 6; ++i) {
////     let bounce = cubeMap.faces[i].pixels[0];
////     let direct = cubeMap.faces[i].pixels[1];
////     let normal = cubeMap.faces[i].pixels[2];
////
////     let forward = FORWARD[i];
////     let right = RIGHT[i];
////     let up = UP[i];
////     let idx = 0;
////     let r, g, b: number;
////     for (let j = 0; j < size; ++j) {
////       let v = (2 * (j + 0.5) * duv) - 1;
////       for (let i = 0; i < size; ++i) {
////         let u = (2 * (i + 0.5) * duv) - 1;
////
////         vec3.addScaled(dir, forward, up, u);
////         vec3.addScaled(dir, dir, right, u);
////         vec3.normalize(dir, dir);
////
////         // The division by pi bakes in the normalization factor required to
////         // make the diffuse lighting model energy conserving.
////         let w = solidAngle(u, v, duv) / Math.PI;
////
////         vec3.setFromValues(n, normal[idx] - 127.5, normal[idx + 1] - 127.5, normal[idx + 2] - 127.5);
////         vec3.normalize(n, n);
////
////         r = w * Math.pow(bounce[idx] / 255, 2.2);
////         g = w * Math.pow(bounce[idx + 1] / 255, 2.2);
////         b = w * Math.pow(bounce[idx + 2] / 255, 2.2);
////         vec3.setFromValues(col, r, g, b);
////         sh3.project(dst, col, dir);
////
////         vec3.reflect(dir, dir, n);
////         dir[1] = -Math.abs(dir[1]);
////         r = 0.5 * w * Math.pow(direct[idx] / 255, 2.2);
////         g = 0.5 * w * Math.pow(direct[idx + 1] / 255, 2.2);
////         b = 0.5 * w * Math.pow(direct[idx + 2] / 255, 2.2);
////         vec3.setFromValues(col, r, g, b);
////         sh3.project(dst, col, dir);
////
////         idx += 4;
////       }
////     }
////   }
////
////   sh3.radianceToIrradiance(dst, dst);
//// }

export class ShProbeField {
  probes: Probe[][];
  lights: Light[] = [];

  constructor(public room: Room) {
    let width = this.room.sectorTableWidth;
    let height = this.room.sectorTableHeight;
    if (width < 2 || height < 2) {
      // This constraint is just for simplicity.
      throw new Error(`Width and height must be >= 2, got (${width}, ${height}`);
    }
    this.probes = new Array<Probe[]>(width * height);
    for (let i = 0; i < width * height; ++i) {
      this.probes[i] = [];
    }

    let adjacentRooms = new Set<Room>();
    adjacentRooms.add(room);
    for (let i = 0; i < width * height; ++i) {
      let sector = room.sectorTable[i];
      if (sector.roomAbove != null) {
        adjacentRooms.add(sector.roomAbove);
      }
      if (sector.roomBelow != null) {
        adjacentRooms.add(sector.roomBelow);
      }
      if (sector.floorData.portal != null) {
        adjacentRooms.add(sector.floorData.portal);
      }
    }
    for (let room of adjacentRooms.values()) {
      for (let light of room.lights) {
        this.lights.push(light);
      }
    }
  }

  insertProbe(i: number, j: number, y: number, cubeMap: DynamicCubeMap) {
    let probes = this.probes[i + j * this.room.sectorTableWidth];
    if (probes.length > 0 && y <= probes[probes.length - 1].y) {
      throw new Error('Probes must be added in increasing Y order');
    }
    let pos = vec3.newFromValues(
        i * 1024 + 512 + this.room.x,
        y + 512,
        j * 1024 + 512 + this.room.z);
    let d = vec3.newZero();
    let lightDir = vec3.newZero();
    for (let light of this.lights) {
      vec3.sub(d, light.position, pos);
      let disSqr = vec3.dot(d, d);
      vec3.normalize(d, d);
      vec3.addScaled(lightDir, lightDir, d, light.intensity / disSqr);
    }
    vec3.normalize(lightDir, lightDir);
    let probe = new Probe(y, lightDir, cubeMap);
    probes.push(probe);
  }

  sample(dst: sh3.Type, pos: vec3.Type) {
    let i = ((pos[0] - this.room.x) / 1024 - 0.5) | 0;
    let u: number;
    if (i < 0) {
      i = 0;
      u = 0;
    } else if (i > this.room.sectorTableWidth - 2) {
      i = this.room.sectorTableWidth - 2;
      u = 1;
    } else {
      let x = pos[0] / 1024 - 0.5;
      u = x - Math.floor(x);
    }

    let j = ((pos[2] - this.room.z) / 1024 - 0.5) | 0;
    let v: number;
    if (j < 0) {
      j = 0;
      v = 0;
    } else if (j > this.room.sectorTableHeight - 2) {
      j = this.room.sectorTableHeight - 2;
      u = 1;
    } else {
      let z = pos[2] / 1024 - 0.5;
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
    let probes = this.probes[i + j * this.room.sectorTableWidth];
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
