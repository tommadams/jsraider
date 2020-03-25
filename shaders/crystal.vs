uniform mat4 world;
uniform mat4 view;
uniform mat4 viewProj;
uniform vec3 tint;

in vec3 normal;
in vec3 position;

out vec3 v_color;
out vec3 v_normal;

void main(void) {
  v_normal = (view * (world * vec4(normal, 0))).xyz;
  v_color = tint;
  gl_Position = viewProj * (world * vec4(position, 1));
}

