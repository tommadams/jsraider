import * as intersect3d from 'toybox/math/intersect3d';
import * as intersect2d from 'toybox/math/intersect2d';
import * as mat4 from 'toybox/math/mat4';
import * as vec2 from 'toybox/math/vec2';
import * as vec3 from 'toybox/math/vec3';

import {Room, Sector} from 'scene';
import {State} from 'state';

export class Intersection {
  room: Room = null;
  geom = new intersect3d.Intersection3d();
}

/**
 * Based on A Fast Voxel Traversal Algorithm for Ray Tracing by
 * John Amanatides & Andrew Woo:
 *   http://www.cse.chalmers.se/edu/year/2011/course/TDA361_Computer_Graphics/grid.pdf
 */
export class SectorIterator {
  i = 0;
  j = 0;
  di = 0;
  dj = 0;
  ti = 0;
  tj = 0;
  dti = 0;
  dtj = 0;

  reset(x: number, z: number, dx: number, dz: number) {
    this.i = Math.floor(x / 1024);
    this.j = Math.floor(z / 1024);
    this.di = Math.sign(dx);
    this.dj = Math.sign(dz);

    let xFrac = x % 1024;
    let zFrac = z % 1024;
    if (dx == 0) {
      this.ti = Infinity;
      this.dti = Infinity;
    } else {
      this.ti = dx > 0 ? (1024 - xFrac) / dx : -xFrac / dx;
      this.dti = 1024 / Math.abs(dx);
    }
    if (dz == 0) {
      this.tj = Infinity;
      this.dtj = Infinity;
    } else {
      this.tj = dz > 0 ? (1024 - zFrac) / dz : -zFrac / dz;
      this.dtj = 1024 / Math.abs(dz);
    }
  }

  /** Step to the next sector. */
  step() {
    if (this.ti < this.tj) {
      this.ti += this.dti;
      this.i += this.di;
    } else {
      this.tj += this.dtj;
      this.j += this.dj;
    }
  }
}


/**
 * TODO(tom): Use Sector.prototype.getResolvedSectorByPositon instead
 * @return {Room} The resolved room. If the position is outside the
 *     given room's sector table, the original room is returned.
 */
export function resolveRoomByPosition(room: Room, position: vec3.Type) {
  let i = Math.floor(position[0] / 1024);
  let j = Math.floor(position[2] / 1024);
  return resolveRoomByGrid(room, i, j, position[1]);
}


/**
 * TODO(tom): Use Sector.prototype.getResolvedSectorByGrid instead
 * @return {Room} The resolved room. If (i, j) is outside the given
 *     room's sector table, the original room is returned.
 */
export function resolveRoomByGrid(room: Room, i: number, j: number, y: number) {
  let sector = room.getSectorByGrid(i, j);
  while (sector != null) {
    if (sector.floorData.portal != null) {
      room = sector.floorData.portal;
      sector = room.getSectorByGrid(i, j);
    }
    if (sector.roomBelow != null && y > sector.floor) {
      room = sector.roomBelow;
      sector = room.getSectorByGrid(i, j);
      continue;
    }
    if (sector.roomAbove != null && y < sector.ceiling) {
      room = sector.roomAbove;
      sector = room.getSectorByGrid(i, j);
      continue;
    }
    break;
  }

  return room;
}

/**
 * @param room
 * @param p
 * @param v
 * @param r
 * @param intersection room field is always set, even if there is no collision.
 * @return {boolean}
 */
export function sphereCast(room: Room, p: vec3.Type, v: vec3.Type, r: number,
                           intersection: Intersection) {
  let it = new SectorIterator();
  it.reset(p[0], p[2], v[0], v[2]);

  // Make sure we start from the correct room.
  room = resolveRoomByGrid(room, it.i, it.j, p[1]);

  let checkCollision = function(room: Room, sector: Sector,
                                intersection: Intersection) {
    let result = false;
    for (let quad of sector.quadCollision) {
      let oldT = intersection.geom.t;
      if (intersect3d.sweptSphereQuadrilateral(
            p, v, r, quad[0], quad[1], quad[2], quad[3], intersection.geom)) {
        intersection.geom.t = oldT;
          // TODO(tom): why is this second call necessary?
        intersect3d.sweptSphereQuadrilateral(
            p, v, r, quad[0], quad[1], quad[2], quad[3], intersection.geom);
        intersection.room = room;
        result = true;
      }
    }
    for (let tri of sector.triCollision) {
      if (intersect3d.sweptSphereTriangle(
              p, v, r, tri[0], tri[1], tri[2], intersection.geom)) {
        intersection.room = room;
        result = true;
      }
    }
    return result;
  };

  let t0 = 0.0;
  let y0 = p[1];
  let result = false;
  do {
    let t1 = Math.min(it.ti, it.tj);
    let y1 = p[1] + t1 * v[1];

    // TODO(tom): Don't need to always check all 8 neigbours.
    for (let jj = it.j - 1; jj <= it.j + 1; ++jj) {
      for (let ii = it.i - 1; ii <= it.i + 1; ++ii) {
        let sector = room.getSectorByGrid(ii, jj);
        if (sector == null) {
          continue;
        }
        let sectorRoom = room;
        if (sector.floorData.portal != null) {
          sectorRoom = sector.floorData.portal;
          sector = sector.floorData.portal.getSectorByGrid(ii, jj);
        }
        if (checkCollision(sectorRoom, sector, intersection)) {
          result = true;
        }
        if (sector.roomAbove != null &&
            Math.min(y0, y1) - r <= sector.ceiling) {
          let above = sector.roomAbove.getSectorByGrid(ii, jj);
          if (checkCollision(sector.roomAbove, above, intersection)) {
            result = true;
          }
        }
        if (sector.roomBelow != null &&
            Math.max(y0, y1) + r >= sector.floor) {
          let below = sector.roomBelow.getSectorByGrid(ii, jj);
          if (checkCollision(sector.roomBelow, below, intersection)) {
            result = true;
          }
        }
      }
    }

    if (result || t1 > intersection.geom.t) {
      // If we haven't hit anything, make sure we set the intersection position
      // anyway.
      if (!result) {
        vec3.addScaled(intersection.geom.p, p, v, intersection.geom.t);
      }
      // Always resolve the correct room for the intersection position to handle
      // the case where the intersection position is above or below the current
      // room.
      intersection.room = resolveRoomByPosition(room, intersection.geom.p);
      break;
    }

    it.step();
    t0 = t1;
    y0 = y1;

    room = resolveRoomByGrid(room, it.i, it.j, p[1] + t1 * v[1]);
    intersection.room = room;
  } while (room != null && room.getSectorByGrid(it.i, it.j) != null);

  return result;
}

export function moveCharacter(room: Room, p: vec3.Type, v: vec3.Type, r: number, h: number,
                              intersection: Intersection, state: State) {
  let result = false;

  let minY = -h;
  let maxY = 0;

  let stepUpThreshold = -256 - 128;
  let dropThreshold = Infinity;
  if (state == State.JUMP_UP) {
    stepUpThreshold = 0;
  } else if (State.isSwimming(state) || state == State.DIVE) {
    stepUpThreshold = 0;
    minY = -r;
    maxY = r;
  } else if (State.isTreadingWater(state)) {
    stepUpThreshold = 0;
    minY = -100;
    maxY = 700;
  } else if (State.isSideStepping(state)) {
    stepUpThreshold = -128;
    dropThreshold = 128;
  } else if (State.isWalking(state)) {
    dropThreshold = 256 + 128;
  }

  let p2 = vec2.newFromValues(p[0], p[2]);
  let v2 = vec2.newFromValues(v[0], v[2]);

  // Min & max coordinates of the sector bounds.
  let min = vec2.newZero();
  let max = vec2.newZero();

  let intersect = new intersect2d.Intersection2d();
  let candidates = [];

  // Check for intersections between all the neighboring sectors and the swept
  // circle that forms the path the character takes.
  // TODO(tom): A better approach would be to actually calculate the
  // axis-aligned rectangle that encompasses the swept circle and test all
  // sectors inside (except the current one).
  let oi = Math.floor(p[0] / 1024);
  let oj = Math.floor(p[2] / 1024);
  let originalSector = room.getSectorByGrid(oi, oj);
  for (let j = oj - 1; j <= oj + 1; ++j) {
    for (let i = oi - 1; i <= oi + 1; ++i) {
      let sector = originalSector.getResolvedSectorByGrid(i, j, p[1]);
      if (sector == null || sector == originalSector) {
        continue;
      }

      let x = i * 1024;
      let z = j * 1024;
      vec2.setFromValues(min, x, z);
      vec2.setFromValues(max, x + 1024, z + 1024);

      intersect.t = intersection.geom.t;
      if (intersect2d.sweptCircleSquare(
          p2, v2, r, min, max, intersect)) {
        if (vec2.dot(v2, intersect.n) < 0) {
          candidates.push({
            sector: sector,
            t: intersect.t,
            nx: intersect.n[0],
            nz: intersect.n[1],
            di: i - oi,
            dj: j - oj,
          });
        }
      }

    }
  }

  // Search through all the candidate intersections for the first one that halts
  // the character.
  let firstCandidate = null;
  let pos = vec3.newZero();
  for (let candidate of candidates) {
    if (firstCandidate != null && candidate.t > firstCandidate.t) {
      continue;
    }
    let slope = candidate.sector.floorData.floorSlope;
    if (State.isWalking(state) || State.isSideStepping(state)) {
      // If Lara is walking, don't let her walk onto any steep slopes.
      if (Math.abs(slope[0]) > 512 || Math.abs(slope[1]) > 512) {
        firstCandidate = candidate;
        continue;
      }
    } else if (state == State.RUN || state == State.FAST_BACK) {
      // If Lara is running, only allow her to run onto a steep slope if it's
      // downhill.
      if ((Math.abs(slope[0]) > 512 && candidate.di != -Math.sign(slope[0])) ||
          (Math.abs(slope[1]) > 512 && candidate.dj != -Math.sign(slope[1]))) {
        firstCandidate = candidate;
        continue;
      }
    }

    let x = p[0] + candidate.t * v[0];
    let y = p[1] + candidate.t * v[1];
    let z = p[2] + candidate.t * v[2];
    vec3.setFromValues(pos, x, y, z);
    let floor = candidate.sector.getFloorAt(pos);
    if (floor - p[1] < stepUpThreshold ||
        floor - p[1] > dropThreshold) {
      firstCandidate = candidate;
      continue;
    }
    let ceiling = candidate.sector.getCeilingAt(pos);
    if (p[1] + minY < ceiling ||
        maxY - minY > floor - ceiling) {
      firstCandidate = candidate;
      continue;
    }
  }

  let hit = firstCandidate != null;
  if (hit) {
    intersection.room = firstCandidate.sector.room;
    intersection.geom.t = firstCandidate.t;
    intersection.geom.n[0] = firstCandidate.nx;
    intersection.geom.n[1] = 0;
    intersection.geom.n[2] = firstCandidate.nz;
  } else {
    vec3.scale(pos, intersection.geom.t, v);
    vec3.add(pos, p, pos);
    intersection.room = resolveRoomByPosition(room, pos);
  }

  // Check if there's enough space to actually move to the destination.
  vec3.scale(pos, intersection.geom.t, v);
  vec3.add(pos, p, pos);
  let sector = intersection.room.getSectorByPosition(pos);
  let floor = sector.getFloorAt(pos);
  let ceiling = sector.getCeilingAt(pos);
  if (maxY - minY > floor - ceiling) {
    hit = true;
    intersection.room = room;
    intersection.geom.t = 0;
    intersection.geom.n[0] = -v[0];
    intersection.geom.n[1] = 0;
    intersection.geom.n[2] = -v[2];
    vec3.normalize(intersection.geom.n, intersection.geom.n);
  }

  return hit;
}
