// Based on: https://csantosbh.wordpress.com/tag/nearest-neighbor-sampling/
// Samples the texture using anti-aliased nearest-neighbour filtering.
vec4 sampleAann(sampler2D tex, vec2 uv) {
  vec2 texSize = vec2(textureSize(tex, 0));
  vec2 duvDx = dFdx(uv);
  vec2 duvDy = dFdy(uv);
  uv *= texSize;
  vec2 aduvDx = abs(duvDx) * texSize;
  vec2 aduvDy = abs(duvDy) * texSize;
  vec2 duv = vec2(max(aduvDx.x, aduvDy.x), max(aduvDx.y, aduvDy.y));

  vec2 flUv = floor(uv);
  vec2 frUv = fract(uv);
  vec2 fw = 0.8 / duv;
  frUv = clamp(fw * frUv, vec2(0), vec2(0.5)) +
         clamp(fw * (frUv - 1.0) + 0.5, vec2(0), vec2(0.5));

  return textureGrad(tex, (flUv + frUv) / texSize, duvDx, duvDy);
}
