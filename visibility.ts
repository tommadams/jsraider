import * as frustum from 'toybox/math/frustum';
import * as mat4 from 'toybox/math/mat4';
import * as vec2 from 'toybox/math/vec2';
import * as vec3 from 'toybox/math/vec3';
import * as vec4 from 'toybox/math/vec4';

import {Item, Room} from 'scene';

export class VisibleRoom {
  moveables: Item[] = [];
  spriteSequences: Item[] = [];

  // True if the camera is inside the room, or close enough to a portal that
  // the near plane would clip it.
  cameraInside = false;
 
  constructor(public room: Room, public depth: number) {}
}

export class Culler {
  // All rooms in the scene.
  private rooms: Room[];

  // All items in the scene.
  private items: Item[];

  // Map from room ID to index into visibleRooms of visible rooms.
  // Elements set to -1 if a room isn't visible.
  private roomVisibility: Int32Array;

  // Set of rooms currently being traversed during visibility computation.
  // roomActive[room.id] is 1 if the room is in the current portal traversal
  // path, 0 otherwise.
  private roomActive: Uint8Array;

  // If cameraInside[room.id] == 1, camera is either inside the room or has a
  // portal that the camera's near clip plane is intersecting or very close to.
  private cameraInside: Uint8Array;

  // View matrix.
  private view = mat4.newZero();

  // Project matrix.
  private proj = mat4.newZero();

  // Left, right, top, bottom planes of the view frustum.
  private frustum = frustum.newZero(frustum.Planes.LRTB);

  // Near clip plane.
  private near = 0;

  // List of visible rooms.
  private visibleRooms: VisibleRoom[] = [];

  constructor(rooms: Room[], items: Item[]) {
    this.rooms = rooms;
    this.items = items;
    this.roomVisibility = new Int32Array(this.rooms.length);
    this.roomActive = new Uint8Array(this.rooms.length);
    this.cameraInside = new Uint8Array(this.rooms.length);
    for (let i = 0; i < 4; ++i) {
      this.frustum[i] = vec4.newZero();
    }
  }

  /**
   * @return {VisibleRoom[]} The list of visible rooms, sorted by depth in the
   *     portal graph from the camera.
   */
  cull(room: Room, view: mat4.Type, proj: mat4.Type) {
    this.view = view;
    this.proj = proj;
    frustum.setNormalizedFromProj(this.frustum, proj);
    this.near = mat4.getPerspectiveNear(proj);

    this.visibleRooms.length = 0;
    this.roomVisibility.fill(-1);
    this.roomActive.fill(0);
    this.cameraInside.fill(0);

    // By definition, the camera is inside the given room.
    this.cameraInside[room.id] = 1;

    if (room != null) {
      this.traverse(
          room, vec2.newFromValues(-1, -1), vec2.newFromValues(1, 1), 0);
    }

    // Propagate the cameraInside flag.
    for (let visibleRoom of this.visibleRooms) {
      visibleRoom.cameraInside = this.cameraInside[visibleRoom.room.id] != 0;
    }

    // Sort visible rooms by depth and recalculate mapping based on new order.
    this.visibleRooms.sort(function(a, b) { return a.depth - b.depth; });
    for (let i = 0; i < this.visibleRooms.length; ++i) {
      this.roomVisibility[this.visibleRooms[i].room.id] = i;
    }
    this.sortVisibleItems();

    return this.visibleRooms;
  }

  setAllVisible() {
    this.visibleRooms.length = 0;
    for (let i = 0; i < this.rooms.length; ++i) {
      this.roomVisibility[i] = this.visibleRooms.length;
      this.visibleRooms.push(new VisibleRoom(this.rooms[i], 0));
    }
    this.sortVisibleItems();
    return this.visibleRooms;
  }

  // Traverses the portal graph, appending too visibleRooms and setting
  // cameraInside[room.id] if appropriate.
  private traverse(room: Room, min: vec2.Type, max: vec2.Type, depth: number) {
    let visibleRoom: VisibleRoom;

    if (this.roomVisibility[room.id] == -1) {
      this.roomVisibility[room.id] = this.visibleRooms.length;
      visibleRoom = new VisibleRoom(room, depth);
      this.visibleRooms.push(visibleRoom);
    } else {
      visibleRoom = this.visibleRooms[this.roomVisibility[room.id]];
      visibleRoom.depth = Math.min(visibleRoom.depth, depth);
    }
    this.roomActive[room.id] = 1;

    let v = vec3.newZero();
    let portalMin = vec2.newZero();
    let portalMax = vec2.newZero();

    for (let portal of room.portals) {
      if (this.roomActive[portal.adjoiningRoomId]) {
        // Already visited this room, skip it.
        continue;
      }

      // Transform portal vertices into view space.
      let clipped = new Array(4);
      for (let i = 0; i < 4; ++i) {
        clipped[i] = mat4.mulPos(vec3.newZero(), this.view, portal.vertices[i]);
      }

      // Clip the portal to the left, right, top, bottom frustum planes.
      for (let plane of this.frustum) {
        clipped = clipPoly(clipped, plane);
        if (clipped.length == 0) {
          break;
        }
      }
      if (clipped.length == 0) {
        continue;
      }

      // Check if any of the clipped portal's vertices are close to the near
      // clip plane.
      let closeToNearPlane = false;
      for (let c of clipped) {
        // Consider a portal close to the near plane if it's within 2x the near
        // clip value. We need to use some threshold slightly larger than the
        // real near clip value to avoid artifacts. Surprisingly it seems that
        // 10% larger than the near clip isn't sufficient.
        if (c[2] > -2 * this.near) {
          closeToNearPlane = true;
          break;
        }
      }

      if (closeToNearPlane) {
        this.cameraInside[room.id] = 1;
        this.cameraInside[portal.adjoiningRoomId] = 1;
      }

      // Project clipped portal vertices into screen space and calculate bounds.
      // If the portal is close (or intersecting) the clip plane, just assume
      // that covers the screen entirely.
      if (closeToNearPlane) {
        vec2.setFromValues(portalMin, -1, -1);
        vec2.setFromValues(portalMax, 1, 1);
      } else {
        vec2.setFromValues(portalMin, 1, 1);
        vec2.setFromValues(portalMax, -1, -1);
        for (let c of clipped) {
          mat4.mulPosProjective(v, this.proj, c);
          vec2.min(portalMin, v, portalMin);
          vec2.max(portalMax, v, portalMax);
        }
      }

      vec2.max(portalMin, min, portalMin);
      vec2.min(portalMax, max, portalMax);

      if (portalMin[0] < portalMax[0] && portalMin[1] < portalMax[1]) {
        this.traverse(
            this.rooms[portal.adjoiningRoomId], portalMin, portalMax,
            depth + 1);
      }
    }

    this.roomActive[room.id] = 0;
  }

  private sortVisibleItems() {
    for (let item of this.items) {
      if (!item.renderable) {
        continue;
      }
      let visibleRoomIdx = this.roomVisibility[item.room.id];
      if (visibleRoomIdx != -1) {
        if (item.moveable != null) {
          this.visibleRooms[visibleRoomIdx].moveables.push(item);
        } else {
          this.visibleRooms[visibleRoomIdx].spriteSequences.push(item);
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
function clipPoly(poly: vec3.Type[], plane: vec4.Type) {
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
