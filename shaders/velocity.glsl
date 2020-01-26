//! NAMESPACE=raider.shaders
//! CLASS=Velocity


//! COMMON

precision highp float;

varying vec4 v_prevPos;
varying vec4 v_currPos;


//! VERTEX

attribute vec3 position;

uniform mat4 prevWorldViewProj;
uniform mat4 currWorldViewProj;

void main(void) {
  vec4 pos4 = vec4(position, 1);
  v_prevPos = prevWorldViewProj * pos4;
  v_currPos = currWorldViewProj * pos4;
  gl_Position = v_currPos;
}


//! FRAGMENT

uniform vec2 prevProjOffset;
uniform vec2 currProjOffset;

void main(void) {
  vec2 prevPos = v_prevPos.xy / v_prevPos.w - prevProjOffset;
  vec2 currPos = v_currPos.xy / v_currPos.w - currProjOffset;
  vec2 vel = 0.5 * (currPos - prevPos);
  gl_FragColor = vec4(vel, 1, 1);
}

