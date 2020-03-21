#include "shaders/util.inc"

uniform sampler2D tex;

in vec3 v_color;
in vec3 v_normal;

out vec4 o_color;

void main(void) {
  vec3 normal = normalize(v_normal);
  vec2 uv = vec2(-0.5, 0.5) * normal.xy + 0.5;
  o_color.xyz = v_color * texture(tex, uv).xyz;

  // Add a cheap Fresnel reflection effect.
  float fresnel = 1.0 - max(normal.z, 0.0);
  o_color.xyz += 0.2 * fresnel * fresnel;

  o_color.xyz = finalizeColor(o_color.xyz);
  o_color.w = 1.0;
}
