uniform sampler2D tex;

in vec2 v_uv;

out vec4 o_color;

void main(void) {
  o_color = texture(tex, v_uv);
}
