uniform mat4 viewProj;

uniform vec3 center;
uniform float radius;

in vec3 position;

out vec3 v_position;
out vec3 v_normal;

void main(void) {
  v_normal = position;
  v_position = center + radius * position;
  gl_Position = viewProj * vec4(v_position, 1);
}

