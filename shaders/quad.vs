#include "shaders/lighting.inc"

uniform mat4 world;
uniform mat4 worldViewProj;
uniform vec4 tint;

in vec3 normal;
in vec3 position;
in vec4 pp1;
in vec4 p2p3;
in vec4 uv;
in vec2 lightUv;

out vec4 v_color;
out vec2 v_lightUv;
out vec4 v_pp1;
out vec4 v_p2p3;
out vec4 v_texBounds;

void main(void) {
  v_pp1 = pp1;
  v_p2p3 = p2p3;
  v_texBounds = uv;
  v_color = tint;
  v_color.xyz *= calculateLighting(normalize((world * vec4(normal, 0)).xyz));
  v_lightUv = lightUv;
  gl_Position = worldViewProj * vec4(position, 1);
}
