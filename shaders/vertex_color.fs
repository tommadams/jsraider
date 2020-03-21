#include "shaders/util.inc"

in vec3 v_color;

out vec4 o_color;

void main() {
  o_color = vec4(finalizeColor(v_color), 1);
}

