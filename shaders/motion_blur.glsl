//! NAMESPACE=raider.shaders
//! CLASS=MotionBlur


//! COMMON

precision mediump float;

varying vec2 v_uv;


//! VERTEX

attribute vec2 position;

void main(void) {
  v_uv = position;
  gl_Position = vec4(2.0 * position - 1.0, 0, 1);
}


//! FRAGMENT

uniform sampler2D colorTex;
uniform sampler2D velocityTex;

#define STEPS 16

void main(void) {
  vec2 velocity = texture2D(velocityTex, v_uv).xy / float(STEPS);
  vec2 uv = v_uv + velocity;
  vec4 result = vec4(0);
  for (int i = 0; i < STEPS; ++i) {
    result += texture2D(colorTex, uv);
    uv -= velocity;
  }
  gl_FragColor = result / float(STEPS);
}
