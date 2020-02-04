uniform mat4 viewProj;
uniform mat4 shadowViewProj;

in vec3 position;

out vec2 v_uv;

void main() {
  vec4 pos4 = vec4(position, 1);
  gl_Position = viewProj * pos4;
  v_uv = (shadowViewProj * pos4).xy;
  v_uv = 0.5 + 0.5 * v_uv;
}

