#include "shaders/util.inc"

uniform samplerCube tex;

uniform vec3 eyePos;

in vec3 v_position;
in vec3 v_normal;

out vec4 o_color;

void main(void) {
  vec3 I = v_position - eyePos;
  vec3 N = normalize(v_normal);
  vec3 R = reflect(I, N);
  o_color.xyz = texture(tex, R).xyz;

  o_color.xyz = finalizeColor(o_color.xyz);
  o_color.w = 1.0;
}
