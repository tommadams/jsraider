#include "shaders/lighting.inc"

uniform sampler2D bakedLightTex;
uniform float time;

in vec3 position;
in vec2 lightUv;

out vec3 v_color;

void main(void) {
  vec3 lightMap = unpackLightMap(texture(bakedLightTex, lightUv).xyz);
  v_color = packLightMap(lightMap * calculateCaustics(position, time));
  gl_Position = vec4(lightUv * 2.0 - 1.0, 0, 1);
}
