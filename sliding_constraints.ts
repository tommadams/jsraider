import * as vec3 from 'toybox/math/vec3';

import {EPSILON} from 'toybox/math/constants';

let tmp = vec3.newZero();

/**
 * Implements constraints for sliding an object along a surface.
 * Similar in principle to the method described in:
 *   http://arxiv.org/pdf/1211.0059.pdf
 * But fixes common cases where the method in the paper gets stuck.
 */
export class SlidingConstraints {
  private v = vec3.newZero();
  private normals: vec3.Type[] = [];

  constructor(v: vec3.Type) {
    this.reset(v);
  }

  reset(v: vec3.Type) {
    vec3.setFromVec(this.v, v);
  }

  add(n: vec3.Type) {
    let unique = true;
    for (let i = 0; i < this.normals.length; ++i) {
      if (vec3.distanceSqr(this.normals[i], n) <= EPSILON * EPSILON) {
        unique = false;
        break;
      }
    }
    if (unique) {
      this.normals.push(vec3.newFromVec(n));
    }
    this.updateConstraints_();
  }

  apply(v: vec3.Type) {
    let n = this.normals;
    switch (n.length) {
      case 0:
        // No constraints: nothing to do.
        break;

      case 1:
        // One constraint: slide the vector along the surface normal.
        vec3.add(v, v, vec3.scale(tmp, -vec3.dot(n[0], v), n[0]));
        break;

      case 2:
        // Two constraints: slide along the crease they form.
        vec3.cross(tmp, n[0], n[1]);
        vec3.normalize(tmp, tmp);
        vec3.scale(v, vec3.dot(tmp, v), tmp);
        break;

      default:
        // Three or more constraints: we're stuck.
        vec3.setFromValues(v, 0, 0, 0);
        break;
    }
  }

  private updateConstraints_() {
    let bestNormals = null;
    let bestMaxDot = -Infinity;

    // TODO(tom): remove temp allocation.
    let projected = vec3.newZero();

    for (let i = 0; i < this.normals.length; ++i) {
      let n = this.normals[i];
      let d = -vec3.dot(n, this.v);
      vec3.add(projected, this.v, vec3.scale(projected, d, n));

      let candidates = [n];
      let maxDot = -1;
      for (let j = 0; j < this.normals.length; ++j) {
        if (i == j) {
          continue;
        }

        let dot = vec3.dot(projected, this.normals[j]);
        maxDot = Math.max(dot, maxDot);
        if (dot <= 0) {
          candidates.push(this.normals[j]);
        }
      }

      if (bestNormals == null ||
          candidates.length < bestNormals.length ||
          candidates.length == bestNormals.length && maxDot > bestMaxDot) {
        bestMaxDot = maxDot;
        bestNormals = candidates;
      }
    }

    this.normals = bestNormals || [];
  }
}
