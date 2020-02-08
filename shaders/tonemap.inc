vec3 tonemap(vec3 color) {
  float brightness = -0.052;
  return clamp(color + brightness, vec3(0), vec3(1));
}
