#include "shaders/quad_st.inc"

uniform mat4 world;
uniform mat4 worldViewProj;
uniform vec3 tint;

in vec3 normal;
in vec3 position;
in vec2 lightUv;

in vec4 pp1;
in vec4 p2p3;
in vec4 uv;

uniform sampler2D lightTex;

out vec3 v_color;
out vec3 v_normal;
out vec2 v_uv;

void main(void) {
  vec2 st = calculateST(pp1.xy, vec2(0), pp1.zw, p2p3.xy, p2p3.zw);
  vec2 lightMapUv = lightUv + st / vec2(textureSize(lightTex, 0));
  vec3 lightMap = 2.0 * texture(lightTex, lightMapUv).xyz;

  v_color = tint * lightMap;
  v_uv = uv.xy + st * uv.zw;
  v_normal = normal;
  gl_Position = worldViewProj * vec4(position, 1);
}
