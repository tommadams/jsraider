uniform mat4 worldViewProj;

in vec3 position;

void main() {
  gl_Position = worldViewProj * vec4(position, 1);
}

