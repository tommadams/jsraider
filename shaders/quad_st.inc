float cross2(vec2 p0, vec2 p1) {
  return p0.x * p1.y - p0.y * p1.x;
}

// Inverse bilinear interpolation adapted from
// http://stackoverflow.com/posts/813702/revisions, with the following
// modifications:
//  - Removed all the range changes because p is always inside the quad.
//  - Removed code that calculates the second pair of (s, t) coordinates.
//  - Calculate t without a branch.
// Vertex order:
//   p0 --- p1
//    |     |
//    |     |
//   p3 --- p2
vec2 calculateST(vec2 p, vec2 p0, vec2 p1, vec2 p2, vec2 p3) {
  const float epsilon = 0.01;

  vec2 p0p = p0 - p;
  vec2 p1p = p1 - p;
  vec2 p0p3 = p0 - p3;
  vec2 p1p2 = p1 - p2;
  float a = cross2(p0p, p0p3);
  float b = 0.5 * (cross2(p0p, p1p2) + cross2(p1p, p0p3));
  float c = cross2(p1p, p1p2);

  float s, t;
  float am2bpc = a - 2.0 * b + c;
  if (abs(am2bpc) < epsilon) {
    s = a / (a-c);
  } else {
    float sqrtbsqmac = sqrt(b * b - a * c);
    float ab = a - b;
    // Which solution to the quadratic equation we want depends on the winding
    // order of the UVs.
    // TODO(tom): Figure out if we can calculate this more cheaply (maybe by
    // just looking at v_texBounds).
    if (cross2(p1, p2) >= 0.0) {
      s = (ab - sqrtbsqmac) / am2bpc;
    } else {
      s = (ab + sqrtbsqmac) / am2bpc;
    }
  }

  vec2 ps1 = mix(p0, p1, s);
  vec2 ps2 = mix(p3, p2, s);
  vec2 ps12 = ps2 - ps1;
  t = dot(p - ps1, ps12) / dot(ps12, ps12);

  // ST needs to be clamped to handle multisampling where the sample point
  // is outside the polygon. Centroid sampling doesn't work here for some
  // reason, perhaps because the final UV values are computed?
  // TODO(tom): look into why centroid sampling isn't sufficient.
  return clamp(vec2(s, t), vec2(0), vec2(1));
}
