import * as mat4 from 'toybox/math/mat4';
import * as vec2 from 'toybox/math/vec2';
import * as vec3 from 'toybox/math/vec3';
import * as vec4 from 'toybox/math/vec4';

import {Item, Room} from 'scene';

export class VisibleRoom {
  moveables: Item[] = [];
  spriteSequences: Item[] = [];

  constructor(public room: Room, public depth: number) {}
}

export class Culler {
  private rooms_: Room[];
  private items_: Item[];
  private roomVisibility_: Int32Array;
  private roomActive_: Uint8Array;
  private view_ = mat4.newZero();
  private proj_ = mat4.newZero();
  private visibleRooms_: VisibleRoom[] = [];
  private frustum_ = new Array<vec4.Type>(4);

  constructor(rooms: Room[], items: Item[]) {
    this.rooms_ = rooms;
    this.items_ = items;
    this.roomVisibility_ = new Int32Array(this.rooms_.length);
    this.roomActive_ = new Uint8Array(this.rooms_.length);
    for (let i = 0; i < 4; ++i) {
      this.frustum_[i] = vec4.newZero();
    }
  }

  // TODO(tom): Passing in both the fovY, aspect, and proj seems redundant.
  /**
   * @return {VisibleRoom[]} The list of visible rooms, sorted by depth in the
   *     portal graph from the camera.
   */
  cull(fovY: number, aspect: number, room: Room, view: mat4.Type, proj: mat4.Type) {
    // TODO(tom): decide how best to pass view, proj, and frustum.
    this.view_ = view;
    this.proj_ = proj;
    this.frustum_ = perspectiveFrustum_(fovY, aspect);

    this.visibleRooms_.length = 0;
    this.roomVisibility_.fill(-1);
    this.roomActive_.fill(0);

    if (room != null) {
      this.traverse_(
          room, vec2.newFromValues(-1, -1), vec2.newFromValues(1, 1), 0);
    }

    // Sort visible rooms by depth and recalculate mapping based on new order.
    this.visibleRooms_.sort(function(a, b) { return a.depth - b.depth; });
    for (let i = 0; i < this.visibleRooms_.length; ++i) {
      this.roomVisibility_[this.visibleRooms_[i].room.id] = i;
    }
    this.sortVisibleItems_();

    return this.visibleRooms_;
  }

  setAllVisible() {
    this.visibleRooms_.length = 0;
    for (let i = 0; i < this.rooms_.length; ++i) {
      this.roomVisibility_[i] = this.visibleRooms_.length;
      this.visibleRooms_.push(new VisibleRoom(this.rooms_[i], 0));
    }
    this.sortVisibleItems_();
    return this.visibleRooms_;
  }

  private traverse_(room: Room, min: vec2.Type, max: vec2.Type, depth: number) {
    if (this.roomVisibility_[room.id] == -1) {
      this.roomVisibility_[room.id] = this.visibleRooms_.length;
      this.visibleRooms_.push(new VisibleRoom(room, depth));
    } else {
      let idx = this.roomVisibility_[room.id];
      this.visibleRooms_[idx].depth = Math.min(
          this.visibleRooms_[idx].depth, depth);
    }
    this.roomActive_[room.id] = 1;

    let v = vec3.newZero();
    let portalMin = vec2.newZero();
    let portalMax = vec2.newZero();

    for (let portal of room.portals) {
      if (this.roomActive_[portal.adjoiningRoomIdx]) {
        // Already visited this room, skip it.
        continue;
      }

      // Transform portal vertices into view space.
      let clipped = new Array(4);
      for (let i = 0; i < 4; ++i) {
        clipped[i] = mat4.mulPos(vec3.newZero(), this.view_, portal.vertices[i]);
      }

      for (let plane of this.frustum_) {
        clipped = clipPoly_(clipped, plane);
        if (clipped.length == 0) {
          break;
        }
      }
      if (clipped.length == 0) {
        continue;
      }

      // Project clipped portal vertices into screen space and calculate bounds.
      vec2.setFromValues(portalMin, 1, 1);
      vec2.setFromValues(portalMax, -1, -1);
      for (let c of clipped) {
        mat4.mulPosProjective(v, this.proj_, c);
        vec2.min(portalMin, v, portalMin);
        vec2.max(portalMax, v, portalMax);
      }

      vec2.max(portalMin, min, portalMin);
      vec2.min(portalMax, max, portalMax);

      if (portalMin[0] < portalMax[0] && portalMin[1] < portalMax[1]) {
        this.traverse_(
            this.rooms_[portal.adjoiningRoomIdx], portalMin, portalMax,
            depth + 1);
      }
    }

    this.roomActive_[room.id] = 0;
  }

  private sortVisibleItems_() {
    for (let item of this.items_) {
      if (!item.renderable) {
        continue;
      }
      let visibleRoomIdx = this.roomVisibility_[item.room.id];
      if (visibleRoomIdx != -1) {
        if (item.moveable != null) {
          this.visibleRooms_[visibleRoomIdx].moveables.push(item);
        } else {
          this.visibleRooms_[visibleRoomIdx].spriteSequences.push(item);
        }
      }
    }
  }
}


/**
 * @param poly
 * @param plane
 * @return {vec3.Type[]} Poly clipped to plane.
 */
// TODO(tom): Factor some functions out into a maths library.
function clipPoly_(poly: vec3.Type[], plane: vec4.Type) {
  let clipped = [];
  let pq = vec3.newZero();
  let p = poly[poly.length - 1];
  let pd = vec3.dot(plane, p) + plane[3];
  for (let q of poly) {
    // Calculate distances to the plane.
    let qd = vec3.dot(plane, q) + plane[3];

    // Calculate intersection of plane and the line (p, q).
    vec3.sub(pq, q, p);
    let vn = vec3.dot(plane, pq);
    let det = -pd / vn;
    // TODO(tom): handle vn == 0.

    vec3.scale(pq, det, pq);
    vec3.add(pq, p, pq);

    if (pd >= 0) {
      if (qd >= 0) {
        clipped.push(q);
      } else {
        clipped.push(vec3.newFromVec(pq));
      }
    } else {
      if (qd >= 0) {
        clipped.push(vec3.newFromVec(pq));
        clipped.push(q);
      }
    }

    p = q;
    pd = qd;
  }

  return clipped;
}

// TODO(tom): Move this to some library in toybox
/**
 * @param fieldOfViewY Vertical field of view in radians.
 * @param aspect Aspect ratio.
 * @return {vec4.Type[]} Array of four planes forming a perspective frustum.
 */
function perspectiveFrustum_(fieldOfViewY: number, aspect: number) {
  let t = 0.5 * fieldOfViewY;
  let s = Math.sin(t);
  let c = Math.cos(t);
  let bottom = vec4.newFromValues(0, c, -s, 0);
  let top = vec4.newFromValues(0, -c, -s, 0);

  t = Math.atan(aspect * Math.tan(t));
  s = Math.sin(t);
  c = Math.cos(t);
  let left = vec4.newFromValues(c, 0, -s, 0);
  let right = vec4.newFromValues(-c, 0, -s, 0);

  return [top, bottom, left, right];
}
