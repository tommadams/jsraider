import * as mat4 from 'toybox/math/mat4';

import {Room} from 'scene';

export abstract class Camera {
  abstract getTransform(): mat4.Type;
  abstract getRoom(): Room;
}
