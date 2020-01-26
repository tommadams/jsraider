uniform sampler2D tex;

uniform float opacity;

in vec2 v_uv;

out vec4 o_color;

void main() {
  o_color = vec4(0, 0, 0, opacity * texture(tex, v_uv).x);
}

