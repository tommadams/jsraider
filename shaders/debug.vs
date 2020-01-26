varying vec3 v_position;
varying vec4 v_color;

attribute vec4 color;
attribute vec3 position;

uniform mat4 viewProj;
uniform float offset;

void main(void) {
  v_position = position;
  v_color = color;
  gl_Position = viewProj * vec4(position, 1);

  // Offset the vertices a little.
  gl_Position.w += offset;
}
