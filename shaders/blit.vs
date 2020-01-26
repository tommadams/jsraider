uniform vec4 scaleOffset;

in vec2 uv;

out vec2 v_uv;

void main() {
  gl_Position = vec4(uv * scaleOffset.xy + scaleOffset.zw, -1, 1);
  v_uv = uv;
}
