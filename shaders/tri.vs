#include "shaders/lighting.inc"

uniform mat4 world;
uniform mat4 worldViewProj;
uniform vec3 tint;
uniform sampler2D lightTex;

in vec2 lightUv;
in vec2 uv;
in vec3 normal;
in vec3 position;

out vec3 v_color;
out vec2 v_uv;

void main(void) {
  v_uv = uv;
  v_color = 2.0 * tint * texture(lightTex, lightUv).xyz;
  v_color *= calculateLighting(normalize((world * vec4(normal, 0)).xyz));
  gl_Position = worldViewProj * vec4(position, 1);
}
