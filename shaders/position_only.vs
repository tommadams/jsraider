uniform mat4 viewProj;

in vec3 position;

void main() {
  gl_Position = viewProj * vec4(position, 1);
}
