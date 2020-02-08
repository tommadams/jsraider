#include "shaders/sample_aann.inc"
#include "shaders/fog.inc"
#include "shaders/tonemap.inc"

uniform sampler2D tex;
uniform vec2 texSize;

in vec4 v_color;
in vec2 v_uv;

out vec4 o_color;

void main(void) {
  o_color = sampleAann(tex, texSize, v_uv) * v_color;
  // Alpha-to-coverage generates 17 distinct dither patterns (on my NVIDIA 750M
  // at least). Only 5 of these patterns (0, 0.25, 0.5, 0.7, 1) don't cause any
  // dithering after multisampling is resolved.
  // Clamp the output alpha to these levels so that no dithering shows up on the
  // edges alpha-tested texels.
  o_color.w = floor(o_color.w * 5.0) / 4.0;
  if (o_color.w == 0.0) {
    discard;
  }

  o_color.xyz = applyFog(o_color.xyz);
  o_color.xyz = tonemap(o_color.xyz);
}
