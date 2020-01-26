varying vec2 v_uv;

uniform sampler2D tex;
uniform bool show_alpha;
uniform vec2 duv;

void main(void) {
  vec4 v = texture2D(tex, v_uv);

  vec4 a = texture2D(tex, v_uv + vec2(duv.x, 0));
  vec4 b = texture2D(tex, v_uv - vec2(duv.x, 0));
  vec4 c = texture2D(tex, v_uv + vec2(0, duv.y));
  vec4 d = texture2D(tex, v_uv - vec2(0, duv.y));
  vec4 sharp = 5.0 * v - (a + b + c + d);
  gl_FragColor = mix(v, sharp, 0.06);
  gl_FragColor.w = 1.0;

  if (show_alpha) {
    gl_FragColor.xyz = v.www;
  }
}

