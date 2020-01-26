in vec2 position;

out vec2 v_uv;

void main(void) {
  v_uv = position;
  gl_Position = vec4(2.0 * position - 1.0, 0, 1);
}
