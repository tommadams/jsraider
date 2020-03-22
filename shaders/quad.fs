#include "shaders/quad_st.inc"
#include "shaders/sample_aann.inc"
#include "shaders/util.inc"

uniform mat4 proj;
uniform sampler2D tex;
uniform sampler2D lightTex;

in vec3 v_color;
in vec2 v_lightUv;
in vec4 v_pp1;
in vec4 v_p2p3;
in vec4 v_texBounds;

out vec4 o_color;

void main(void) {
  vec2 st = calculateST(v_pp1.xy, vec2(0), v_pp1.zw, v_p2p3.xy, v_p2p3.zw);
  vec2 uv = v_texBounds.xy + st * v_texBounds.zw;
  o_color = sampleAann(tex, uv);

  // Alpha-to-coverage generates 17 distinct dither patterns (on my NVIDIA 750M
  // at least). Only 5 of these patterns (0, 0.25, 0.5, 0.75, 1) don't cause any
  // dithering after multisampling is resolved.
  // Clamp the output alpha to these levels so that no dithering shows up on the
  // edges alpha-tested texels.
  o_color.w = floor(o_color.w * 5.0) / 4.0;
  if (o_color.w == 0.0) {
    discard;
  }

  vec2 lightMapUv = v_lightUv + st / vec2(textureSize(lightTex, 0));
  vec3 lightMap = 2.0 * texture(lightTex, lightMapUv).xyz;

  o_color.xyz *= v_color * lightMap;
  o_color.xyz = finalizeColor(o_color.xyz);

  // float A = proj[2].z - 1.0;
  // float B = proj[3].z - 1.0;
  // float linDepth = (B - 2.0 * gl_FragCoord.z / gl_FragCoord.w) / A;
  // o_color.xyz *= 0.001;
  // o_color.xyz += linDepth / (16.0 * 1024.0);
}

