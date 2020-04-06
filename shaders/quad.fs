#include "shaders/quad_st.inc"
#include "shaders/sample_aann.inc"
#include "shaders/util.inc"
#include "shaders/lighting.inc"

uniform float time;
uniform mat4 proj;
uniform sampler2D tex;
uniform sampler2D lightTex;

in vec3 v_position;
in vec3 v_color;
in vec2 v_lightUv;
in vec4 v_pp1;
in vec4 v_p2p3;
in vec4 v_texBounds;

out vec4 o_color;

float SINGLE(vec3 position) {
  float t = time / 1000.0;
  vec3 p = vec3(position.x, position.y + position.z, position.z);// / 1024.0;
  vec3 s = vec3(5.234, 1.734, 0.234);
  float speed = 1.0 + 0.5 * sin(dot(p, s));
  float ofs = dot(p, vec3(1.303, 6.043, 9.41));
  return 0.8 + 0.25 * sin(4.0 * t * speed + ofs);
}

float FOO(vec3 position) {
  position /= 1024.0;
  vec3 p = floor(position);
  vec3 fr = position - p;

  float a = SINGLE(p + vec3(0, 0, 0));
  float b = SINGLE(p + vec3(1, 0, 0));
  float c = SINGLE(p + vec3(0, 1, 0));
  float d = SINGLE(p + vec3(1, 1, 0));

  float e = SINGLE(p + vec3(0, 0, 1));
  float f = SINGLE(p + vec3(1, 0, 1));
  float g = SINGLE(p + vec3(0, 1, 1));
  float h = SINGLE(p + vec3(1, 1, 1));

  vec4 t0 = mix(vec4(a, c, e, g), vec4(b, d, f, h), fr.x);
  vec2 t1 = mix(t0.xy, t0.zw, fr.z);
  return mix(t1.x, t1.y, fr.y);
}

void main(void) {
  vec2 st = calculateSTrel(v_pp1.xy, v_pp1.zw, v_p2p3.xy, v_p2p3.zw);
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
  vec3 lightMap = unpackLightMap(texture(lightTex, lightMapUv).xyz);

  o_color.xyz *= v_color * lightMap * FOO(v_position);
  o_color.xyz = finalizeColor(o_color.xyz);

  // o_color.xyz *= 0.01;
  // o_color.xy += abs(v_pp1.xy) * 50.0 / 1024.0;
  // o_color.xy += st;
}

