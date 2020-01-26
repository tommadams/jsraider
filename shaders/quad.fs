#include "shaders/quad_st.inc"
#include "shaders/sample_aann.inc"
#include "shaders/fog.inc"

uniform sampler2D tex;
uniform vec2 texSize;
uniform sampler2D lightTex;
uniform vec2 lightTexSize;
uniform float gamma;

in vec4 v_color;
in vec2 v_lightUv;
in vec4 v_pp1;
in vec4 v_p2p3;
in vec4 v_texBounds;

out vec4 o_color;

void main(void) {
  vec2 st = calculateST(v_pp1.xy, vec2(0), v_pp1.zw, v_p2p3.xy, v_p2p3.zw);
  vec2 uv = v_texBounds.xy + st * v_texBounds.zw;
  vec2 lightMapUv = v_lightUv + st / lightTexSize;
  o_color = sampleAann(tex, texSize, uv) * v_color;
  // Alpha-to-coverage generates 17 distinct dither patterns (on my NVIDIA 750M
  // at least). Only 5 of these patterns (0, 0.25, 0.5, 0.75, 1) don't cause any
  // dithering after multisampling is resolved.
  // Clamp the output alpha to these levels so that no dithering shows up on the
  // edges alpha-tested texels.
  o_color.w = floor(o_color.w * 5.0) / 4.0;
  if (o_color.w == 0.0) {
    discard;
  }

  o_color.xyz *= 2.0 * texture(lightTex, lightMapUv).xyz;
  o_color.xyz = applyFog(o_color.xyz);

  o_color.xyz = pow(o_color.xyz, vec3(gamma));
}

