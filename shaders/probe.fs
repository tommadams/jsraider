#include "shaders/util.inc"

uniform mat4 proj;
uniform sampler2D tex;

in vec3 v_color;
in vec3 v_normal;
in vec2 v_uv;

layout(location = 0) out vec4 o_color;
layout(location = 1) out vec4 o_direct_light;
layout(location = 2) out vec4 o_normal;

void main(void) {
  o_color = texture(tex, v_uv);
  if (o_color.w < 0.5) {
    discard;
  }

  // o_direct_light = vec4(max(vec3(0), 2.0 * v_color - 1.0), 1);
  o_direct_light = vec4(v_color, 1);

  float A = proj[2].z - 1.0;
  float B = proj[3].z - 1.0;
  float linDepth = (B - 2.0 * gl_FragCoord.z / gl_FragCoord.w) / A;

  o_normal = vec4(0.5 * v_normal + 0.5, 64.0 / 1024.0);

  o_color.xyz *= v_color;
  o_color.xyz = finalizeColor(o_color.xyz);
}
