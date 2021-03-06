#if ENABLE_LIGHTING == 1
#define NUM_LIGHTS 4
uniform vec4 lights[NUM_LIGHTS];
uniform float ambient;
#endif

float calculateCaustics(vec3 position, float time) {
  vec3 s = vec3(5.234, 1.734, 0.234);
  float speed = 1.0 + 0.5 * sin(dot(position, s));
  float ofs = dot(position, vec3(1.303, 6.043, 9.41));
  return 0.8 + 0.25 * sin(4.0 * time * speed + ofs);
}

float calculateLighting(vec3 normal) {
#if ENABLE_LIGHTING == 1
  float light = ambient;
  for (int i = 0; i < NUM_LIGHTS; ++i) {
    float d = dot(lights[i].xyz, normal);
    //light += lights[i].w * (0.5 + 0.5 * d);
    light += lights[i].w * max(0.0, d);
    //light += max(0.0, dot(lights[i].xyz, n));
  }
  return light;
#else
  return 1.0;
#endif
}

vec3 unpackLightMap(vec3 col) {
  return 8.0 * (col - 0.5);
}

vec3 packLightMap(vec3 col) {
  return 0.125 * col + 0.5;
}
