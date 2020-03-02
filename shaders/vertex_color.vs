uniform mat4 viewProj;

in vec3 position;
in vec3 color;

out vec3 v_color;

void main() {
  gl_Position = viewProj * vec4(position, 1);
  v_color = color;
}

