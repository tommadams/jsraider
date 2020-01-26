varying vec3 v_position;
varying vec4 v_color;

void main(void) {
  gl_FragColor = v_color;
  gl_FragColor.xyz *= v_color.w;
}

