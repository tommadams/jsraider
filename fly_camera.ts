import * as mat4 from 'toybox/math/mat4';
import * as vec3 from 'toybox/math/vec3';

import {Camera} from 'camera'
import {Intersection, sphereCast} from 'collision'
import {Room} from 'scene'
import {SlidingConstraints} from 'sliding_constraints'

export class FlyCamera extends Camera {
  position: vec3.Type;
  rotation: vec3.Type;
  room: Room;
  transform: mat4.Type;

  constructor(room: Room, pos: vec3.Type, rot: vec3.Type) {
    super();

    this.position = vec3.newFromVec(pos);
    this.rotation = vec3.newFromVec(rot);
    this.room = room;

    this.transform = mat4.newZero();
    this.updateTransform();
  }

  getTransform() { return this.transform; }
  getRoom() { return this.room; }

  /**
   * @param dp Position delta.
   * @param dr Rotation delta.
   */
  update(dp: vec3.Type, dr: vec3.Type) {
    vec3.add(this.rotation, dr, this.rotation);
    let pitchRange = 0.5 * Math.PI - 0.001;

    this.rotation[0] = Math.max(this.rotation[0], -pitchRange);
    this.rotation[0] = Math.min(this.rotation[0], pitchRange);

    let v = mat4.mulVec(vec3.newZero(), this.transform, dp);

    let length = vec3.length(dp);
    if (length > 0) {
      let constraints = new SlidingConstraints(v);
      let intersection = new Intersection();
      let vv = vec3.newZero();

      for (let iter = 0; iter < 8; ++iter) {
        vec3.normalize(vv, v);
        intersection.geom.t = length;

        if (!sphereCast(this.room, this.position, vv, 100, intersection)) {
          vec3.add(this.position, v, this.position);
          break;
        }

        // Move to the intersection position.
        // TODO(tom): t - 0.1 is not really the correct thing to do.
        vec3.scale(vv, intersection.geom.t - 0.1, vv);
        vec3.add(this.position, vv, this.position);

        // Calculate the remaining movement vector and apply sliding constraits.
        vec3.scale(v, (length - intersection.geom.t) / length, v);
        constraints.add(intersection.geom.n);
        constraints.apply(v);

        length = vec3.length(v);
        if (length < 0.00001) {
          break;
        }
      }

      this.room = intersection.room;
    }

    this.updateTransform();
  }

  private updateTransform() {
    mat4.setRotateY(this.transform, this.rotation[1]);
    mat4.rotateX(this.transform, this.rotation[0]);
    mat4.rotateZ(this.transform, this.rotation[2]);
    mat4.setRowValues(
        this.transform, 3,
        this.position[0], this.position[1], this.position[2], 1);
  }
}
