uniform vec3 eyePos;
uniform vec3 translation;
uniform mat4 viewProj;

in vec2 uv;
in vec3 position;
in vec2 offset;
in vec3 color;

out vec2 v_uv;
out vec3 v_color;

void main(void) {
  v_uv = uv;
  v_color = color;
  //vec3 p = (world * vec4(position, 1)).xyz;
  vec3 p = position + translation;
  vec2 v = normalize(p.xz - eyePos.xz);
  p.xz += offset.x * vec2(-v.y, v.x);
  p.y += offset.y;
  gl_Position = viewProj * vec4(p, 1);
}
