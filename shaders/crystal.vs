uniform mat4 worldView;
uniform mat4 worldViewProj;
uniform vec3 tint;

in vec3 normal;
in vec3 position;

out vec3 v_color;
out vec3 v_normal;

void main(void) {
  v_normal = (worldView * vec4(normal, 0)).xyz;
  v_color = tint;
  gl_Position = worldViewProj * vec4(position, 1);
}

