//! NAMESPACE=raider.shaders
//! CLASS=TaaResolve


//! COMMON

precision highp float;

varying vec2 v_uv;


//! VERTEX

attribute vec2 position;

void main(void) {
  v_uv = position;
  gl_Position = vec4(2.0 * position - 1.0, 0, 1);
}


//! FRAGMENT

uniform sampler2D prevColorTex;
uniform sampler2D currColorTex;
uniform sampler2D currDepthTex;
uniform sampler2D velocityTex;

uniform float blend;
uniform vec2 duv;

uniform float contrastScale;
uniform float velocityScale;
uniform float minBlend;
uniform float maxBlend;

// Returns the UV coordinates of the fragment in the 1-ring neighborhood of uv
// that is closest to the camera.
vec2 getNearestUv(vec2 uv) {
  vec2 nearUv = uv;
  float nearDepth = texture2D(currDepthTex, uv).x;

  vec2 uvs[4];
  uvs[0] = uv + vec2(-duv.x, -duv.y);
  uvs[1] = uv + vec2(+duv.x, -duv.y);
  uvs[2] = uv + vec2(-duv.x, +duv.y);
  uvs[3] = uv + vec2(+duv.x, +duv.y);
  for (int i = 0; i < 4; ++i) {
    float depth = texture2D(currDepthTex, uvs[i]).x;
    nearUv = depth < nearDepth ? uvs[i] : nearUv;
    nearDepth = depth < nearDepth ? depth : nearDepth;
  }
/*
  vec2 uvs[8];
  uvs[0] = uv + vec2(-duv.x, -duv.y);
  uvs[1] = uv + vec2( duv.x, -duv.y);
  uvs[2] = uv + vec2(+duv.x, -duv.y);
  uvs[3] = uv + vec2(-duv.x,  duv.y);
  uvs[4] = uv + vec2(+duv.x,  duv.y);
  uvs[5] = uv + vec2(-duv.x, +duv.y);
  uvs[6] = uv + vec2( duv.x, +duv.y);
  uvs[7] = uv + vec2(+duv.x, +duv.y);
  for (int i = 0; i < 8; ++i) {
    float depth = texture2D(currDepthTex, uvs[i]).x;
    nearUv = depth < nearDepth ? uvs[i] : nearUv;
    nearDepth = depth < nearDepth ? depth : nearDepth;
  }
*/

  return nearUv;
}

vec3 RgbToYCgCo(vec3 rgb) {
  // float Y =   0.25 * r + 0.5 * g + 0.25 * b;
  // float Cg = -0.25 * r + 0.5 * g - 0.25 * b;
  // float Co =  0.50 * r           - 0.50 * b;
  // return vec3(Y, Cg, Co);
  float a = 0.25 * (rgb.x + rgb.z);
  float b = 0.5 * rgb.y;
  return vec3(b + a, b - a, 0.5 * (rgb.x - rgb.z));
}

vec3 YCgCoToRgb(vec3 YCgCo) {
  float Y = YCgCo.x;
  float Cg = YCgCo.y;
  float Co = YCgCo.z;
  float tmp = Y - Cg;
  return vec3(tmp + Co, Y + Cg, tmp - Co);
}

vec3 SrgbToLinear(vec3 srgb) {
//return srgb;
  return pow(srgb, vec3(1.0 / 2.2));
}

vec3 LinearToSrgb(vec3 linear) {
//return linear;
  return pow(linear, vec3(2.2));
}

void main(void) {
  // In order to antialias pixels of edges moving perpendicularly to their
  // direction, use the velocity of the pixel in the 1-ring neighborhood of
  // v_uv that's closest to the camera.
  // TODO(tom): If the difference in velocities at v_uv and getNearestUv(u_uv)
  // is small enough (i.e. this pixel isn't an edge), use the velocity of v_uv
  // directly for improved accuracy.
  vec2 velocity = texture2D(velocityTex, getNearestUv(v_uv)).xy;

  //vec2 velocity = texture2D(velocityTex, v_uv).xy;

  // Perform resolve in linear color space.
  // TODO(tom): Maybe do everything in linear color space?

  vec2 prevUv = v_uv - velocity;
  vec3 prev = texture2D(prevColorTex, prevUv).xyz;

  vec2 currUv = v_uv;
  vec3 curr = texture2D(currColorTex, currUv).xyz;

  prev = SrgbToLinear(prev);
  curr = SrgbToLinear(curr);


/*
  vec3 samples[8];
  samples[0] = texture2D(currColorTex, currUv + vec2(-duv.x, -duv.y)).xyz;
  samples[1] = texture2D(currColorTex, currUv + vec2( duv.x, -duv.y)).xyz;
  samples[2] = texture2D(currColorTex, currUv + vec2(+duv.x, -duv.y)).xyz;
  samples[3] = texture2D(currColorTex, currUv + vec2(-duv.x,  duv.y)).xyz;
  samples[4] = texture2D(currColorTex, currUv + vec2(+duv.x,  duv.y)).xyz;
  samples[5] = texture2D(currColorTex, currUv + vec2(-duv.x, +duv.y)).xyz;
  samples[6] = texture2D(currColorTex, currUv + vec2( duv.x, +duv.y)).xyz;
  samples[7] = texture2D(currColorTex, currUv + vec2(+duv.x, +duv.y)).xyz;

  for (int i = 0; i < 8; ++i) {
    samples[i] = RgbToYCgCo(SrgbToLinear(samples[i]));
  }
  vec3 currMin = RgbToYCgCo(curr);
  vec3 currMax = currMin;
  for (int i = 0; i < 8; ++i) {
    vec3 s = samples[i];
    currMin = min(currMin, s);
    currMax = max(currMax, s);
  }
*/


  vec3 samples[4];
  samples[0] = texture2D(currColorTex, currUv + vec2(-duv.x, 0)).xyz;
  samples[1] = texture2D(currColorTex, currUv + vec2(+duv.x, 0)).xyz;
  samples[2] = texture2D(currColorTex, currUv + vec2(0, -duv.y)).xyz;
  samples[3] = texture2D(currColorTex, currUv + vec2(0, +duv.y)).xyz;

  for (int i = 0; i < 4; ++i) {
    samples[i] = RgbToYCgCo(SrgbToLinear(samples[i]));
  }
  vec3 currMin = RgbToYCgCo(curr);
  vec3 currMax = currMin;
  for (int i = 0; i < 4; ++i) {
    vec3 s = samples[i];
    currMin = min(currMin, s);
    currMax = max(currMax, s);
  }


  prev = YCgCoToRgb(clamp(RgbToYCgCo(prev), currMin, currMax));
  
/*
  float vl = length(velocity / duv);
  float feedback = clamp(vl, 0.02, 0.2);
*/


  float c_lum = RgbToYCgCo(curr).x;
  float p_lum = RgbToYCgCo(prev).x;
  float unbiased_diff = abs(c_lum - p_lum) / max(c_lum, max(p_lum, 0.01));
  float unbiased_weight = 1.0 - unbiased_diff;
  float unbiased_weight_sqr = unbiased_weight * unbiased_weight;
  float feedback = mix(0.87, 0.98, unbiased_weight_sqr);

  gl_FragColor.xyz = LinearToSrgb(mix(curr, prev, feedback));
  gl_FragColor.w = feedback;  // for debugging
}

