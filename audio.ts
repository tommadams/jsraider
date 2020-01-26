import {SoundDetails} from 'scene'
import * as mat4 from 'toybox/math/mat4'
import {bytesToBase64} from 'toybox/util/base64'


let music_ = new Audio();
let secret_ = new Audio();
let samples_: HTMLAudioElement[] = [];
let soundMap_ = new Int16Array(0);
let soundDetails_: SoundDetails[] = [];
let listenerTransform_ = mat4.newZero();

let pendingTrack = -1;

// Browsers these days prevent audio from playing before the user has interacted
// with the page.
let userInteracted = false;
let listeners = [
  'mousemove', 'mousedown', 'scroll', 'keydown', 'click', 'touchstart',
];

function detectInteraction() {
  console.log('interaction!')
  userInteracted = true;
  for (let listener of listeners) {
    document.body.removeEventListener(listener, detectInteraction);
  }
  if (pendingTrack != -1) {
    playTrackImpl(pendingTrack);
    pendingTrack = -1;
  }
}

export function init(soundMap: Int16Array, soundDetails: SoundDetails[],
                     samples: Uint8Array, sampleIndices: Uint32Array) {
  soundMap_ = soundMap;
  soundDetails_ = soundDetails;

  samples_ = [];
  for (let i = 0; i < sampleIndices.length; ++i) {
    let begin = sampleIndices[i];
    let end;
    if (i + 1 < sampleIndices.length) {
      end = sampleIndices[i + 1];
    } else {
      end = samples.length;
    }
    let base64 = bytesToBase64(samples, begin, end - begin);

    let sample = new Audio();
    sample.src = 'data:audio/wav;base64,' + base64;
    samples_.push(sample);
  }

  for (let listener of listeners) {
    document.body.addEventListener(listener, detectInteraction);
  }
}


export function playSample(idx: number, x: number, y: number, z: number) {
  idx = soundMap_[idx];
  if (idx == -1) {
    console.log('Sample ' + idx + ' not found!');
    return;
  }
  let dx = x - listenerTransform_[12];
  let dy = y - listenerTransform_[13];
  let dz = z - listenerTransform_[14];
  let disSqr = dx * dx + dy * dy + dz * dz;

  // TODO(tom): maxDis should be taken from the sound details.
  let maxDis = 8 * 1024;
  let maxDisSqr = maxDis * maxDis;
  if (disSqr > maxDisSqr) {
    return;
  }
  let falloff = 1 / (1 + 16 * disSqr / maxDisSqr);
  let details = soundDetails_[idx];
  let numSamples = details.numSamples();
  idx = details.sample + Math.floor(Math.random() * numSamples);
  samples_[idx].volume = falloff * details.volume / 32767;
  samples_[idx].play();
}


/** Plays the secret found audio sting. */
export function playSecret() {
  secret_.src = 'music/13.mp3';
  secret_.play();
};


function playTrackImpl(idx: number) {
  music_.src = 'music/' + idx + '.mp3';
  music_.play();
}

/** Plays a music track with the given index.  */
export function playTrack(idx: number) {
  if (userInteracted) {
    playTrackImpl(idx);
  } else {
    pendingTrack = idx;
  }
};


export function setListenerTransform(transform: mat4.Type) {
  mat4.setFromMat(listenerTransform_, transform);
};
