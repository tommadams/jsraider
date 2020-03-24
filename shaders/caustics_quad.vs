#include "shaders/lighting.inc"
#include "shaders/quad_st.inc"

uniform sampler2D bakedLightTex;
uniform float time;

in vec3 position;
in vec2 lightUv;
in vec4 pp1;
in vec4 p2p3;

out vec4 v_color;

void main(void) {
  // TODO(tom): Do we really need to do the full ST calculation here? The vertex
  // is always at (0, 0), (0, 1), (1, 0), or (1, 1).
  vec2 st = calculateST(pp1.xy, vec2(0), pp1.zw, p2p3.xy, p2p3.zw);
  vec2 uv = lightUv + st / vec2(textureSize(bakedLightTex, 0));
  v_color = texture(bakedLightTex, uv) * calculateCaustics(position, time);
  gl_Position = vec4(uv * 2.0 - 1.0, 0, 1);
}
