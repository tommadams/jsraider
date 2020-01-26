import {Rect} from 'toybox/math/rect'

export class TextureAtlas {
  private shelfBottom_ = 0;
  private shelfWidth_ = 0;
  private shelfHeight_ = 0;
  data: Uint8Array;

  constructor(public width: number, public height: number, public padding: number) {
    this.data = new Uint8Array(width * height * 4);
  }

  add(w: number, h: number, data: Uint8Array, bounds: Rect) {
    if (w * h * 4 != data.length) {
      throw ':(';
    }
    let wPad = w + this.padding * 2;
    let hPad = h + this.padding * 2;
    if (wPad > this.width || hPad > this.height) {
      throw 'Can\'t fix texture of size (' + w + ', ' + h +
          ') in atlas of size (' + this.width + ', ' + this.height + ')';
    }

    if (this.shelfWidth_ + wPad >= this.width) {
      this.shelfBottom_ += this.shelfHeight_;
      this.shelfWidth_ = 0;
      this.shelfHeight_ = 0;
    }
    if (this.shelfBottom_ + h > this.height) {
      throw 'Texture atlas is full';
    }

    let x = this.shelfWidth_;
    let y = this.shelfBottom_;

    for (let dstJ = 0; dstJ < hPad; ++dstJ) {
      let srcJ = dstJ - this.padding;
      if (srcJ < 0) { srcJ = 0; } else if (srcJ >= h) { srcJ = h - 1; }
      for (let dstI = 0; dstI < wPad; ++dstI) {
        let srcI = dstI - this.padding;
        if (srcI < 0) { srcI = 0; } else if (srcI >= w) { srcI = w - 1; }
        let srcIdx = 4 * (srcI + srcJ * w);
        let dstIdx = 4 * (dstI + x + (dstJ + y) * this.width);
        this.data[dstIdx++] = data[srcIdx++];
        this.data[dstIdx++] = data[srcIdx++];
        this.data[dstIdx++] = data[srcIdx++];
        this.data[dstIdx++] = data[srcIdx++];
      }
    }

    this.shelfWidth_ += wPad;
    this.shelfHeight_ = Math.max(this.shelfHeight_, hPad);

    bounds.left = (x + this.padding) / this.width;
    bounds.top = (y + this.padding) / this.height;
    bounds.width = w / this.width;
    bounds.height = h / this.height;
  };


  // Set the RGB values of all transparent pixels to the average RGB of
  // neighbouring opaque pixels (if any).
  // This can fix bilinear filtering artifacts when using alpha testing or
  // non-premultiplied alpha blending.
  dilateOpaque() {
    let w = this.width;
    let h = this.height;
    let data = this.data;

    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    let sample = function(i: number, j: number) { 
      if (i >= 0 && i < w && j >= 0 && j < h) {
        let idx = 4 * (i + j * w);
        if (data[idx + 3]) {
          r += data[idx++];
          g += data[idx++];
          b += data[idx++];
          n += 1;
        }
      }
    };

    for (let j = 0; j < h; ++j) {
      for (let i = 0; i < w; ++i) {
        r = 0;
        g = 0;
        b = 0;
        n = 0;
        sample(i, j);
        if (n == 0) {
          sample(i - 1, j);
          sample(i + 1, j);
          sample(i, j - 1);
          sample(i, j + 1);
          if (n > 0) {
            let idx = 4 * (i + j * w);
            data[idx++] = r / n;
            data[idx++] = g / n;
            data[idx++] = b / n;
          }
        }
      }
    }
  }
}
