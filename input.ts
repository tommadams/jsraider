import {keyDown, KeyCodes} from 'toybox/app/input'

export class Input {
  forward = false;
  backward = false;
  left = false;
  right = false;
  jump = false;
  walk = false;
  action = false;
  stepLeft = false;
  stepRight = false;

  update() {
    let up = keyDown(KeyCodes.W) || keyDown(KeyCodes.UP);
    let down = keyDown(KeyCodes.S) || keyDown(KeyCodes.DOWN);
    let left = keyDown(KeyCodes.A) || keyDown(KeyCodes.LEFT);
    let right = keyDown(KeyCodes.D) || keyDown(KeyCodes.RIGHT);
    this.forward = up && !down;
    this.backward = down && !up;
    this.left = left && !right;
    this.right = right && !left;
    this.jump = keyDown(KeyCodes.SPACE);
    this.walk = keyDown(KeyCodes.SHIFT);
    this.action = keyDown(KeyCodes.C);
    this.stepLeft = keyDown(KeyCodes.Q);
    this.stepRight = keyDown(KeyCodes.E);
  }
}
