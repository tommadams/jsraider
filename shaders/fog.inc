uniform vec2 fogStartDensity;

vec3 applyFog(vec3 color) {
  float d = max(0.0, gl_FragCoord.z / gl_FragCoord.w - fogStartDensity.x);
  return color * exp(-d * fogStartDensity.y);
}
