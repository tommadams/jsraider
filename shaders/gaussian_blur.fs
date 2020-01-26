uniform sampler2D tex;
uniform vec2 duv;

in vec2 v_uv;
 
out vec4 o_color;
 
 
void main(void) {
  float d[3] = float[](0.000, 1.384, 3.231);
  float w[3] = float[](0.227, 0.316, 0.070);

  o_color = texture(tex, v_uv) * w[0];
  for (int i = 1; i < 3; i++) {
    o_color += texture(tex, v_uv + d[i] * duv) * w[i];
    o_color += texture(tex, v_uv - d[i] * duv) * w[i];
  }
}

