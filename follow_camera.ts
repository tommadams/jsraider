import * as mat4 from 'toybox/math/mat4';
import * as vec3 from 'toybox/math/vec3';

import {Camera} from 'camera'
import {sphereCast, Intersection} from 'collision'
import {Item, Room} from 'scene'
import {SlidingConstraints} from 'sliding_constraints'

const up_ = vec3.newFromValues(0, -1, 0);
const tmp0_ = vec3.newZero();
const tmp1_ = vec3.newZero();

export class FollowCamera extends Camera {
  lookAtOffset: vec3.Type;
  positionOffset: vec3.Type;
  target: Item;
  meshIdx: number;
  lookAt: vec3.Type;
  position: vec3.Type;
  transform = mat4.newZero();
  room: Room;

  private rawLookAt0: vec3.Type;
  private rawLookAt1: vec3.Type;
  private rawPosition0: vec3.Type;
  private rawPosition1: vec3.Type;
  private intersection = new Intersection();
  private constraints = new SlidingConstraints(vec3.newZero());

  constructor(target: Item, meshIdx: number, lookAtOffset: vec3.Type,
              positionOffset: vec3.Type) {
    super();

    this.lookAtOffset = vec3.newFromVec(lookAtOffset);
    this.positionOffset = vec3.newFromVec(positionOffset);
    this.target = target;
    this.meshIdx = meshIdx;
    this.rawLookAt0 = vec3.newZero();
    this.rawPosition0 = vec3.newZero();

    this.updateRawPositions_();

    this.rawLookAt1 = vec3.newFromVec(this.rawLookAt0);
    this.rawPosition1 = vec3.newFromVec(this.rawPosition0);
    this.lookAt = vec3.newFromVec(this.rawLookAt0);
    this.position = vec3.newFromVec(this.rawPosition0);
    this.room = this.target.room;

    this.update();
  }

  getTransform() { return this.transform; }
  getRoom() { return this.room; }

  update() {
    let v = tmp0_;
    let startPos = tmp1_;

    let r = 8;

    this.updateRawPositions_();

    // TODO(tom): Make this framerate independent
    this.rawLookAt1[0] += 0.05 * (this.rawLookAt0[0] - this.rawLookAt1[0]);
    this.rawLookAt1[1] += 0.20 * (this.rawLookAt0[1] - this.rawLookAt1[1]);
    this.rawLookAt1[2] += 0.05 * (this.rawLookAt0[2] - this.rawLookAt1[2]);
    this.rawPosition1[0] += 0.05 * (this.rawPosition0[0] - this.rawPosition1[0]);
    this.rawPosition1[1] += 0.15 * (this.rawPosition0[1] - this.rawPosition1[1]);
    this.rawPosition1[2] += 0.05 * (this.rawPosition0[2] - this.rawPosition1[2]);

    // Get the target bone's position.
    mat4.getTranslation(
        startPos, this.target.animState.meshTransforms[this.meshIdx]);

    // Find the target bone's sector.
    let sector = this.target.room.getSectorByPosition(this.target.position);
    sector = sector.getResolvedSectorByPosition(startPos);

    let floor = sector.getFloorAt(startPos);
    let ceiling = sector.getCeilingAt(startPos);

    startPos[1] = Math.max(ceiling + r, Math.min(floor - r, this.rawPosition1[1]));
    sector = sector.getResolvedSectorByPosition(startPos);

    vec3.sub(v, this.rawPosition1, startPos);
    this.intersection.geom.t = vec3.length(v);
    if (this.intersection.geom.t > 0) {
      vec3.scale(v, 1 / this.intersection.geom.t, v);
      if (sphereCast(sector.room, startPos, v, r, this.intersection)) {
        vec3.setFromVec(this.position, this.intersection.geom.p);
      } else {
        vec3.setFromVec(this.position, this.rawPosition1);
      }
      if (this.intersection.room != null) {
        this.room = this.intersection.room;
      }
    }
    vec3.setFromVec(this.lookAt, this.rawLookAt1);

    sector = this.room.getSectorByPosition(this.position);
    floor = sector.getFloorAt(this.position);
    ceiling = sector.getCeilingAt(this.position);
    this.position[1] = Math.min(floor - 256, this.position[1]);
    this.position[1] = Math.max(ceiling + r, this.position[1]);
    this.room = sector.getResolvedSectorByPosition(this.position).room;

    mat4.setLookAt(
        this.transform, this.position, this.lookAt, up_);
    mat4.invert(this.transform, this.transform);
  }

  private updateRawPositions_() {
    // TODO(tom): Remove these temporaries
    let m = mat4.newRotateY(this.target.rotation[1]);
    let ofs = vec3.newZero();

    mat4.getTranslation(
        this.rawPosition0,
        this.target.animState.meshTransforms[this.meshIdx]);

    mat4.mulVec(ofs, m, this.lookAtOffset);
    vec3.add(this.rawLookAt0, this.rawPosition0, ofs);

    mat4.mulVec(ofs, m, this.positionOffset);
    vec3.add(this.rawPosition0, ofs, this.rawPosition0);
  }
}

