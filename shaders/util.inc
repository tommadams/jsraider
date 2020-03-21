uniform vec2 fogStartDensity;

vec3 applyFog(vec3 color) {
  float d = max(0.0, gl_FragCoord.z / gl_FragCoord.w - fogStartDensity.x);
  return color * exp(-d * fogStartDensity.y);
}

vec3 tonemap(vec3 color) {
  float brightness = -0.052;
  return clamp(color + brightness, vec3(0), vec3(1));
}

vec3 finalizeColor(vec3 color) {
  return tonemap(applyFog(color));
}

