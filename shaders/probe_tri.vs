#include "shaders/quad_st.inc"
#include "shaders/lighting.inc"

uniform mat4 world;
uniform mat4 worldViewProj;
uniform vec3 tint;
uniform sampler2D lightTex;

in vec3 normal;
in vec3 position;
in vec2 lightUv;
in vec2 uv;

out vec3 v_color;
out vec3 v_normal;
out vec2 v_uv;

void main(void) {
  float dynamicLight = calculateLighting(normalize((world * vec4(normal, 0)).xyz));
  vec3 lightMap = 2.0 * texture(lightTex, lightUv).xyz;

  v_color = tint * dynamicLight * lightMap;
  v_uv = uv;
  v_normal = normal;
  gl_Position = worldViewProj * vec4(position, 1);
}
