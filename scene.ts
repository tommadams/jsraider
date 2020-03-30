import * as mat4 from 'toybox/math/mat4';
import * as vec2 from 'toybox/math/vec2';
import * as vec3 from 'toybox/math/vec3';

import {Context} from 'toybox/gl/context';
import {TextureAtlas} from 'texture_atlas';
import {VertexArray} from 'toybox/gl/vertex_array';
import {Rect} from 'toybox/math/rect';
import {GL} from 'toybox/gl/constants';
import {TypedArray} from 'toybox/util/array';
import {Stream} from 'toybox/util/stream';

import {Animation, AnimCommand, AnimDispatch, AnimState, Frame, StateChange, parseFrames} from 'animation';
import {BatchBuilder} from 'batch_builder';
import {Block} from 'controllers/block';
import {Controller} from 'controllers/controller';
import {Lara, LaraBone, LocomotionType} from 'controllers/lara';
import {QuadBatch, TriBatch} from 'batch_builder';
import {Bridge} from 'entity/bridge';
import {Door} from 'entity/door';
import {Component, EntityType} from 'entity/entity';
import {Switch} from 'entity/switch';
import * as hacks from 'hacks';
import * as audio from 'audio';

export const TR1 = 0x20;
export const ACTIVE = 0x1f;

function convertLight(l: number) {
  return 2 - l / 4096;
}

export class AnimatedTexture {
  ids: Uint16Array;
  textures: AtlasObjectTexture[];

  constructor(numTextures: number) {
    this.ids = new Uint16Array(numTextures);
    this.textures = new Array(numTextures);
  }
}

export class Box {
  zmin: number;
  zmax: number;
  xmin: number;
  xmax: number;
  floor: number;
  overlapIndex: number;

  constructor(stream: Stream) {
    this.zmin = stream.readInt32();
    this.zmax = stream.readInt32();
    this.xmin = stream.readInt32();
    this.xmax = stream.readInt32();
    this.floor = stream.readInt16();
    this.overlapIndex = stream.readUint16();
  }
}

export class CinematicFrame {
  rotY: number;
  rotZ: number;
  rotZ2: number;
  posZ: number;
  posY: number;
  posX: number;
  fov: number;
  rotX: number;

  constructor(stream: Stream) {
    this.rotY = stream.readInt16();
    this.rotZ = stream.readInt16();
    this.rotZ2 = stream.readInt16();
    this.posZ = stream.readInt16();
    this.posY = stream.readInt16();
    this.posX = stream.readInt16();
    this.fov = stream.readInt16();
    this.rotX = stream.readInt16();
  }
}

export class SceneCamera {
  position: Int32Array;
  room: number;

  constructor(stream: Stream) {
    this.position = stream.readInt32Array(3);
    this.room = stream.readUint16();
    stream.readUint16();  // ???
  }
}

export class Item {
  id = -1;
  type: number;
  position: vec3.Type;
  rawRotation: number;
  rotation: vec3.Type;
  intensity: number;
  flags: number;
  moveable: Moveable = null;
  animState: AnimState = null;
  spriteSequence: SpriteSequence = null;
  room: Room;
  controller: Controller = null;
  reverse = false;
  visible = true;
  activationLocked = false;
  components: Component[] = [];

  constructor(rooms: Room[], stream: Stream) {
    this.type = stream.readUint16();

    let roomIdx = stream.readUint16();

    this.position = vec3.newZero();
    this.position[0] = stream.readInt32();
    this.position[1] = stream.readInt32();
    this.position[2] = stream.readInt32();
    this.rawRotation = stream.readInt16();
    this.rotation = vec3.newFromValues(
        0, this.rawRotation * Math.PI / 32768, 0);
    this.intensity = stream.readInt16();
    if (this.intensity == -1) {
      this.intensity = 1;
    } else {
      this.intensity = convertLight(this.intensity);
    }
    this.flags = stream.readUint16();

    this.room = rooms[roomIdx];
  }

  init(id: number, scene: Scene) {
    this.id = id;
    this.moveable = scene.moveables.find(a => a.type == this.type) || null;
    if (this.moveable != null) {
      this.animState = new AnimState(
          scene.animations, this.moveable.animId, this.position, this.rotation);
    }

    this.spriteSequence = scene.spriteSequences.find(a => a.type == this.type) || null;

    if (this.moveable != null && this.spriteSequence != null) {
      throw new Error(
          `Item ${this.type} has both a moveable and a sprite sequence`);
    } else if (this.moveable == null && this.spriteSequence == null) {
      throw new Error(
          `Item ${this.type} has neither a moveable nor a sprite sequence`);
    }
  }

  get invisible() {
    return (this.flags & 0x0100) != 0;
  }

  get activeMask(): number {
    return (this.flags & 0x3e00) >> 9;
  }
  set activeMask(value: number) {
    this.flags = (this.flags & ~0x3e00) | ((value << 9) & 0x3e00);
  }

  getComponent<T extends Component>(ctor: new(...args: any[]) => T): T {
    for (let comp of this.components) {
      if (comp.constructor == ctor) {
        return comp as T;
      }
    }
    return null;
  }

  getSector() {
    return this.room.getSectorByPosition(this.position);
  }

  getCeilingSector() {
    let sector = this.room.getSectorByPosition(this.position);
    while (sector.roomAbove != null) {
      sector = sector.roomAbove.getSectorByGrid(sector.i, sector.j);
    }
    return sector;
  }

  getFloorSector() {
    let sector = this.room.getSectorByPosition(this.position);
    while (sector.roomBelow != null) {
      sector = sector.roomBelow.getSectorByGrid(sector.i, sector.j);
    }
    return sector;
  }

  isActive() {
    return (this.activeMask == ACTIVE) != this.reverse;
  }

  // TODO(tom): make a controller type lookup table.
  isBlock() {
    return this.type >= EntityType.BLOCK_1 && this.type <= EntityType.BLOCK_4;
  }

  isBridge() {
    return this.type >= EntityType.BRIDGE_FLAT && this.type <= EntityType.BRIDGE_SLOPE_2;
  }

  isDoor() {
    return this.type >= EntityType.DOOR_1 && this.type <= EntityType.DOOR_8;
  }

  isLara() {
    return this.type == EntityType.LARA;
  }

  isPickup() {
    switch (this.type) {
      case EntityType.SHOTGUN:
      case EntityType.MAGNUMS:
      case EntityType.UZIS:
      case EntityType.PISTOL_AMMO:
      case EntityType.SHOTGUN_AMMO:
      case EntityType.MAGNUM_AMMO:
      case EntityType.UZI_AMMO:
      case EntityType.UNUSED_EXPLOSIVE:
      case EntityType.SMALL_MEDIPACK:
      case EntityType.LARGE_MEDIPACK:
      case EntityType.PUZZLE_1:
      case EntityType.PUZZLE_2:
      case EntityType.PUZZLE_3:
      case EntityType.PUZZLE_4:
      case EntityType.KEY_1:
      case EntityType.KEY_2:
      case EntityType.KEY_3:
      case EntityType.KEY_4:
        return true;
    }
    return false;
  }

  isSaveCrystal() {
    return this.type == EntityType.SAVE_CRYSTAL;
  }

  isSwitch() {
    return (this.type == EntityType.SWITCH ||
            this.type == EntityType.UNDERWATER_SWITCH);
  }

  isTrapDoor() {
    return this.type >= EntityType.TRAP_DOOR_1 && this.type <= EntityType.TRAP_DOOR_2;
  }
}

export class Light {
  position: vec3.Type;
  originalIntensity: number;
  intensity: number;
  fade: number;

  constructor(stream: Stream) {
    this.position = vec3.newZero();
    this.position[0] = stream.readInt32();
    this.position[1] = stream.readInt32();
    this.position[2] = stream.readInt32();
    this.originalIntensity = stream.readUint16();
    // Intensity is encoded differently for lights than for everything else.
    this.intensity = this.originalIntensity / 4096;
    this.fade = stream.readUint32();
  }
}

export class Mesh {
  id = -1;
  center: Int16Array;
  size: number;
  positions: Int16Array;
  colors: Float32Array = null;
  normals: Float32Array = null;
  dynamicLighting: boolean;
  texturedQuads: Uint16Array;
  texturedTris: Uint16Array;
  coloredQuads: Uint16Array;
  coloredTris: Uint16Array;
  triBatches: TriBatch[] = [];
  quadBatches: QuadBatch[] = [];

  constructor(stream: Stream) {
    this.center = stream.readInt16Array(3);
    this.size = stream.readUint32();
    this.positions = stream.readInt16Array(3 * stream.readUint16());

    let numVertices = stream.readInt16();
    this.dynamicLighting = numVertices > 0;

    if (this.dynamicLighting) {
      let raw = stream.readInt16Array(3 * numVertices);
      this.normals = new Float32Array(raw.length);
      for (let i = 0; i < raw.length; i += 3) {
        let x = raw[i];
        let y = raw[i + 1];
        let z = raw[i + 2];
        let s = 1 / Math.sqrt(x * x + y * y + z * z);
        this.normals[i] = s * x;
        this.normals[i + 1] = s * y;
        this.normals[i + 2] = s * z;
      }
    } else {
      numVertices = -numVertices;
      this.colors = new Float32Array(3 * numVertices);
      for (let i = 0; i < numVertices; ++i) {
        let light = convertLight(stream.readUint16());
        this.colors[i * 3] = light;
        this.colors[i * 3 + 1] = light;
        this.colors[i * 3 + 2] = light;
      }
    }

    this.texturedQuads = stream.readUint16Array(5 * stream.readUint16());
    this.texturedTris = stream.readUint16Array(4 * stream.readUint16());
    this.coloredQuads = stream.readUint16Array(5 * stream.readUint16());
    this.coloredTris = stream.readUint16Array(4 * stream.readUint16());
  }

  init(ctx: Context, scene: Scene, id: number, lightMap: TextureAtlas) {
    this.id = id;
    let builder = new BatchBuilder(
        this.positions, this.colors, this.normals, lightMap);

    for (let i = 0; i < this.texturedQuads.length; i += 5) {
      let texture = scene.atlasObjectTextures[this.texturedQuads[i + 4]];
      builder.addQuad(this.texturedQuads, i, texture, null);
    }

    for (let i = 0; i < this.texturedTris.length; i += 4) {
      let texture = scene.atlasObjectTextures[this.texturedTris[i + 3]];
      builder.addTri(this.texturedTris, i, texture, null, this.id == 14);
    }

    for (let i = 0; i < this.coloredQuads.length; i += 5) {
      let texture = scene.flatWhiteTexture;
      let p = this.coloredQuads[i + 4] * 4;
      let r = scene.palette[p] / 255;
      let g = scene.palette[p + 1] / 255;
      let b = scene.palette[p + 2] / 255;
      builder.addQuad(this.coloredQuads, i, texture, [r, g, b]);
    }

    for (let i = 0; i < this.coloredTris.length; i += 4) {
      let texture = scene.flatWhiteTexture;
      let p = this.coloredTris[i + 3] * 4;
      let r = scene.palette[p] / 255;
      let g = scene.palette[p + 1] / 255;
      let b = scene.palette[p + 2] / 255;
      builder.addTri(this.coloredTris, i, texture, [r, g, b]);
    }

    builder.build(ctx, this.triBatches, this.quadBatches);
  }
}

export class Moveable {
  type: number;
  meshCount: number;
  firstMesh: number;
  meshTree: number;
  frameOffset: number;
  animId: number;
  meshes: Mesh[];

  // List of indices into this.meshes that are non-null (not all meshes in a
  // Moveable are valid).
  renderableMeshIndices: number[] = [];
  dynamicLighting = false;

  constructor(stream: Stream) {
    this.type = stream.readUint32();
    this.meshCount = stream.readUint16();
    this.firstMesh = stream.readUint16();
    this.meshTree = stream.readUint32();
    this.frameOffset = stream.readUint32();
    this.animId = stream.readInt16();
    this.meshes = new Array(this.meshCount);
    for (let i = 0; i < this.meshCount; ++i) {
      this.meshes[i] = null;
    }
  }

  init(scene: Scene) {
    for (let i = 0; i < this.meshCount; ++i) {
      let mesh = scene.meshes[this.firstMesh + i];
      this.meshes[i] = mesh;
      if (mesh != null) {
        this.renderableMeshIndices.push(i);
        // TODO(tom): Verify that the dynamicLighting flag is consistent across all
        // meshes.
        if (!this.dynamicLighting) {
          this.dynamicLighting = mesh.dynamicLighting;
        }
      }
    }
  }
}

export class ObjectTexture {
  id = 0;
  attributes: number;
  tile: number;
  uvs: Uint8Array;
  numUvs: number;
  uvBounds: Rect;
  atlasTex: AtlasObjectTexture = null;

  constructor(stream: Stream) {
    this.attributes = stream.readUint16();
    this.tile = stream.readUint16();

    // ObjectTextures always have four UV coordinates, even if the texture is for
    // a triangle. Each UV coordinate has four elements:
    //   U type (1 if U is the low value, 255 if U is high)
    //   U value in pixels [0, 256)
    //   V type (1 if V is the low value, 255 if V is high)
    //   V value in pixels [0, 256)
    // If the ObjectTexture is for a triangle, the last four elements in the UV
    // array are all 0.
    // TODO(tom): Actually, it was later discovered that UVs are 8.8 fixed point
    // numbers. Update this code.
    // TODO(tom): When switching to fixed point UVs, remove the extra +1 when
    // calculating uvBounds.
    this.uvs = stream.readUint8Array(16);

    if (this.uvs[12] == 0 && this.uvs[13] == 0 &&
        this.uvs[14] == 0 && this.uvs[15] == 0) {
      this.numUvs = 3;
    } else {
      this.numUvs = 4;
    }

    // Calculate min and max UVs.
    let minU = Math.min(this.uvs[1], this.uvs[5], this.uvs[9]);
    let maxU = Math.max(this.uvs[1], this.uvs[5], this.uvs[9]);
    let minV = Math.min(this.uvs[3], this.uvs[7], this.uvs[11]);
    let maxV = Math.max(this.uvs[3], this.uvs[7], this.uvs[11]);
    if (this.numUvs == 4) {
      minU = Math.min(minU, this.uvs[13]);
      maxU = Math.max(maxU, this.uvs[13]);
      minV = Math.min(minV, this.uvs[15]);
      maxV = Math.max(maxV, this.uvs[15]);
    }
    maxU += 1;
    maxV += 1;

    // Bounds of the object texture's original UVs.
    this.uvBounds = new Rect(minU, minV, maxU - minU, maxV - minV);
  }
}


// TODO(tom): Merge AtlasObjectTexture into ObjectTexture
export class AtlasObjectTexture {
  uvs: Float32Array;
  texBounds = new Float32Array(4);
  animTex: AnimatedTexture = null;
  animOffset = 0;

  constructor(public id: number, public attributes: number, numUvs: number) {
    this.uvs = new Float32Array(2 * numUvs);
  }
}

export class Portal {
  adjoiningRoomId: number;
  normal: Int16Array;
  vertices = new Array<vec3.Type>(4);

  constructor(stream: Stream, roomX: number, roomZ: number) {
    this.adjoiningRoomId = stream.readUint16();
    this.normal = stream.readInt16Array(3);
    for (let i = 0; i < 4; ++i) {
      let src = stream.readInt16Array(3);
      let dst = vec3.newFromValues(src[0] + roomX, src[1], src[2] + roomZ);
      this.vertices[i] = dst;
    }
  }
}

export class RoomStaticMesh {
  position: Int32Array;
  rotation: number;
  intensity: number;
  id: number;
  staticMesh: StaticMesh = null;
  transform: mat4.Type;

  constructor(stream: Stream) {
    this.position = stream.readInt32Array(3);
    this.rotation = stream.readUint16() * Math.PI / 32768;
    this.intensity = convertLight(stream.readInt16());
    this.id = stream.readUint16();
    this.staticMesh = null;
    this.transform = mat4.newRotateY(this.rotation);
    mat4.setRowValues(
        this.transform, 3,
        this.position[0], this.position[1], this.position[2], 1);
  }
}

export const enum FloorFuncType {
  NONE = 0,
  PORTAL_SECTOR = 1,
  FLOOR_SLOPE = 2,
  CEILING_SLOPE = 3,
  TRIGGER = 4,
  KILL = 5,
  CLIMBABLE_WALL = 6,
}

export class Trigger {
  timer: number;
  oneShot: boolean;
  mask: number;
  actions: Trigger.Action[] = [];

  constructor(public type: number, bits: number) {
    this.timer = bits & 0xff;
    this.oneShot = (bits & 0x0100) != 0;
    this.mask = (bits & 0x3e00) >> 9;
  }
}

export namespace Trigger {
  export enum Type {
    TRIGGER_ON = 0,
    PAD_ON = 1,
    SWITCH = 2,
    KEY = 3,
    PICK_UP = 4,
    HEAVY_TRIGGER = 5,
    PAD_OFF = 6,
    COMBAT = 7,
    DUMMY = 8,
    TRIGGER_OFF = 9,
    HEAVY_SWITCH = 10,
    HEAVY_TRIGGER_OFF = 11,
    MONKEY = 12,
    SKELETON = 13,
    TIGHTROPE = 14,
    CRAWL = 15,
    CLIMB = 16,
  }

  export interface Action {
    type: Trigger.Action.Type;
    parameter: number;
    parameter2?: number;
  }

  export namespace Action {
    export enum Type {
      ACTIVATE = 0,
      CAMERA_SWITCH = 1,
      UNDERWATER_CURRENT = 2,
      FLIP_MAP = 3,
      FLIP_ON = 4,
      FLIP_OFF = 5,
      LOOK_AT = 6,
      END_LEVEL = 7,
      PLAY_MUSIC = 8,
      FLIP_EFFECT = 9,
      SECRET = 10,
      CLEAR_BODIES = 11,
      FLY_BY = 12,
      CUTSCENE = 13,
    }
  }
}

export class FloorData {
  floorSlope = vec2.newZero();
  ceilingSlope = vec2.newZero();
  portal: Room = null;
  kill = false;
  climbableWalls = 0;
  bridge: Bridge = null;
  trigger: Trigger = null;
}

export namespace FloorData {
  export const defaultData = new FloorData();
}

export class Sector {
  floorDataIdx: number;
  boxIdx: number;
  roomBelowIdx: number;
  floor: number;
  roomAboveIdx: number;
  ceiling: number;
  roomAbove: Room = null;
  roomBelow: Room = null;

  quadCollision: vec3.Type[][] = [];
  triCollision: vec3.Type[][] = [];
  floorData = FloorData.defaultData;

  /**
   * @param stream Input stream.
   * @param room The sector's room.
   * @param i Grid i coordinate in world space (not room-relative).
   * @param j Grid j coordinate in world sapce (not room-relative).
   */
  constructor(stream: Stream, public room: Room,
              public i: number, public j: number) {
    this.floorDataIdx = stream.readUint16();
    this.boxIdx = stream.readUint16();
    this.roomBelowIdx = stream.readUint8();
    this.floor = stream.readInt8() * 256;
    this.roomAboveIdx = stream.readUint8();
    this.ceiling = stream.readInt8() * 256;
  }

  /** Returns the sector that contains the real floor (not a portal). */
  getResolvedFloorSector() {
    let sector: Sector = this;
    while (sector.roomBelow != null) {
      sector = sector.roomBelow.getSectorByGrid(sector.i, sector.j);
    }
    return sector;
  }

  /** Returns the sector that contains the ceiling (not a portal). */
  getResolvedCeilingSector() {
    let sector: Sector = this;
    while (sector.roomAbove != null) {
      sector = sector.roomAbove.getSectorByGrid(sector.i, sector.j);
    }
    return sector;
  }

  getResolvedSectorByPosition(pos: vec3.Type) {
    let i = (pos[0] / 1024)|0;
    let j = (pos[2] / 1024)|0;
    return this.getResolvedSectorByGrid(i, j, pos[1]);
  }

  getResolvedSectorByGrid(i: number, j: number, y: number) {
    let sector: Sector = this;

    // This is a little subtle: we need to correctly handle the case where a solid
    // floor sector is adjacent to a room{Above,Below} sector and is at the exact
    // same height. To handle this correctly, we must find the room containing the
    // sector exactly above or below the currect sector BEFORE finding the sector
    // in that room at grid coordinates (i, j).

    // Get the resolved sector for the given height, using the sector's own
    // grid coordinates.
    for (;;) {
      if (sector.floorData.portal != null) {
        // TODO(tom): Change portal to be a Sector not Room.
        sector = sector.floorData.portal.getSectorByGrid(sector.i, sector.j);
      }
      if (sector.roomBelow != null && y > sector.floor) {
        sector = sector.roomBelow.getSectorByGrid(sector.i, sector.j);
        continue;
      }
      if (sector.roomAbove != null && y < sector.ceiling) {
        sector = sector.roomAbove.getSectorByGrid(sector.i, sector.j);
        continue;
      }
      break;
    }

    // Now get the sector at coordinates (i, j).
    sector = sector.room.getSectorByGrid(i, j);

    // Handle the case where this is a portal sector.
    if (sector != null && sector.floorData.portal != null) {
      sector = sector.floorData.portal.getSectorByGrid(sector.i, sector.j);
    }

    return sector;
  }

  /** Sets nearPos to the position of the floor at the closest point in the
   *sector to pos. */
  getNearestFloorPosition(pos: vec3.Type, nearPos: vec3.Type) {
    let sector = this.getResolvedFloorSector();
    let y = sector.getFloorAt(pos);
    let sx = sector.i * 1024;
    let sz = sector.j * 1024;
    let x = Math.max(sx, Math.min(sx + 1024, pos[0]));
    let z = Math.max(sz, Math.min(sz + 1024, pos[2]));
    vec3.setFromValues(nearPos, x, y, z);
  }

  /**
   * @param a 0 or 1
   * @param b 0 or 1
   * @return {number}
   */
  getFloorVertexY(a: number, b: number) {
    let y = this.floor;
    let dx = this.floorData.floorSlope[0];
    let dz = this.floorData.floorSlope[1];
    if (a == 0) {
      y += Math.max(dx, 0);
    } else {
      y -= Math.min(dx, 0);
    }
    if (b == 0) {
      y += Math.max(dz, 0);
    } else {
      y -= Math.min(dz, 0);
    }
    return y;
  }

  /**
   * @param a 0 or 1
   * @param b 0 or 1
   * @param pos
   */
  getFloorVertex(a: number, b: number, pos: vec3.Type) {
    pos[0] = (this.i + a) * 1024;
    pos[1] = this.getFloorVertexY(a, b);
    pos[2] = (this.j + b) * 1024;
  }

  /**
   * @param a 0 or 1
   * @param b 0 or 1
   * @return {number}
   */
  getCeilingVertexY(a: number, b: number) {
    let y = this.ceiling;
    let dx = this.floorData.ceilingSlope[0];
    let dz = this.floorData.ceilingSlope[1];
    if (a == 0) {
      y += Math.min(dx, 0);
    } else {
      y -= Math.max(dx, 0);
    }
    if (b == 0) {
      y -= Math.max(dz, 0);
    } else {
      y += Math.min(dz, 0);
    }
    return y;
  }

  /**
   * @param a 0 or 1
   * @param b 0 or 1
   * @param pos
   */
  getCeilingVertex(a: number, b: number, pos: vec3.Type) {
    pos[0] = (this.i + a) * 1024;
    pos[1] = this.getCeilingVertexY(a, b);
    pos[2] = (this.j + b) * 1024;
  }

  /**
   * @param pos
   * @return {number} the height of the floor at the closest point in the
   *     sector to the given position.
   */
  getFloorAt(pos: vec3.Type) {
    let sector = this.getResolvedFloorSector();

    // Calculate offset within sector in the range [0, 1);
    let u = pos[0] / 1024 - sector.i;
    let v = pos[2] / 1024 - sector.j;
    u = Math.max(0, Math.min(1, u));
    v = Math.max(0, Math.min(1, v));

    // Get the real floor.
    let y = sector.floor;
    let slope = sector.floorData.floorSlope;
    if (slope[0] > 0) {
      y += slope[0] * (1 - u);
    } else {
      y -= slope[0] * u;
    }
    if (slope[1] > 0) {
      y += slope[1] * (1 - v);
    } else {
      y -= slope[1] * v;
    }

    // If this sector has a bridge, and Lara is over the bridge, use that
    // as the floor instead.
    let bridge = sector.floorData.bridge;
    if (bridge != null) {
      let bridgeY = bridge.floor;
      slope = bridge.slope;
      if (slope[0] > 0) {
        bridgeY += slope[0] * (1 - u);
      } else {
        bridgeY -= slope[0] * u;
      }
      if (slope[1] > 0) {
        bridgeY += slope[1] * (1 - v);
      } else {
        bridgeY -= slope[1] * v;
      }

      if (pos[1] - 128 <= bridgeY) {
        y = Math.min(y, bridgeY);
      }
    }

    return y;
  }

  /**
   * @param pos
   * @return {number} the height of the ceiling at the closest point in the
   *     sector to the given position.
   */
  getCeilingAt(pos: vec3.Type) {
    let sector = this.getResolvedCeilingSector();

    // Calculate offset within sector in the range [0, 1);
    let u = pos[0] / 1024 - sector.i;
    let v = pos[2] / 1024 - sector.j;
    u = Math.max(0, Math.min(1, u));
    v = Math.max(0, Math.min(1, v));

    // Get the real ceiling.
    let y = sector.ceiling;
    let slope = sector.floorData.ceilingSlope;
    if (slope[0] > 0) {
      y -= slope[0] * u;
    } else {
      y += slope[0] * (1 - u);
    }
    if (slope[1] > 0) {
      y -= slope[1] * (1 - v);
    } else {
      y += slope[1] * v;
    }

    // If this sector has a bridge, and Lara is under the bridge, use that
    // as the ceiling height instead.
    let bridge = this.getResolvedFloorSector().floorData.bridge;
    if (bridge != null) {
      let bridgeY = bridge.floor;
      slope = bridge.slope;
      if (slope[0] > 0) {
        bridgeY += slope[0] * (1 - u);
      } else {
        bridgeY -= slope[0] * u;
      }
      if (slope[1] > 0) {
        bridgeY += slope[1] * (1 - v);
      } else {
        bridgeY -= slope[1] * v;
      }

      if (pos[1] - 128 > bridgeY) {
        y = Math.max(y, bridgeY);
      }
    }

    return y;
  }
}

export class SpriteSequence {
  type: number;
  negativeLength: number;
  offset: number;
  batches: SpriteBatch[] = [];

  constructor(stream: Stream) {
    this.type = stream.readUint32();
    this.negativeLength = stream.readInt16();
    this.offset = stream.readInt16();
  }

  init(ctx: Context, scene: Scene) {
    // Offset the position of the sprite so that it doesn't intersect the ground.
    let positions = [vec3.newFromValues(
        0, -scene.spriteTextures[this.offset].bottom, 0)];
    let colors = [vec3.newFromValues(1, 1, 1)];
    let sprites: SpriteTexture[] = [null];
    for (let i = 0; i < -this.negativeLength; ++i) {
      sprites[0] = scene.spriteTextures[this.offset + i];
      this.batches.push(new SpriteBatch(ctx, positions, colors, sprites));
    }
  }
}

export class SpriteTexture {
  id = 0;
  tile: number;
  x: number;
  y: number;
  uvBounds: Rect;
  left: number;
  top: number;
  right: number;
  bottom: number;

  constructor(stream: Stream) {
    this.tile = stream.readUint16();

    let x = stream.readUint8();
    let y = stream.readUint8();
    let width = (stream.readUint16() - 255) / 256;
    let height = (stream.readUint16() - 255) / 256;

    this.uvBounds = new Rect(x, y, width, height);
    this.left = stream.readInt16();
    this.top = stream.readInt16();
    this.right = stream.readInt16();
    this.bottom = stream.readInt16();
  }
}

export class StaticMesh {
  id: number;
  mesh: number;
  visibilityBox: Int16Array;
  collisionBox: Int16Array;
  flags: number;
  constructor(stream: Stream) {
    this.id = stream.readUint32();
    this.mesh = stream.readUint16();
    this.visibilityBox = stream.readInt16Array(6);
    this.collisionBox = stream.readInt16Array(6);
    this.flags = stream.readUint16();
  }
}

export class SoundSource {
  position: Int32Array;
  sound: number;
  flags: number;

  constructor(stream: Stream) {
    this.position = stream.readInt32Array(3);
    this.sound = stream.readUint16();
    this.flags = stream.readUint16();
  }
}

export class SoundDetails {
  sample: number;
  volume: number;
  range: number;
  info: number;

  constructor(stream: Stream) {
    this.sample = stream.readUint16();
    this.volume = stream.readUint16();
    this.range = stream.readUint16();
    this.info = stream.readUint16();
  }

  channel() { return this.info & 0x3; }
  numSamples() { return (this.info >> 2) & 0x3f; }
  priority() { return (this.info >> 8) & 0xff; }
}

export class Textile {
  data: Uint8Array;

  constructor(stream: Stream) {
    this.data = stream.readUint8Array(256 * 256);
  }
}

export class SpriteBatch {
  // TODO(tom): interleave vertex buffers
  va: VertexArray;

  constructor(ctx: Context, positions: vec3.Type[],
              colors: vec3.Type[], sprites: SpriteTexture[]) {
    let pos = [];
    let col = [];
    let uvs = [];
    let off = [];

    for (let i = 0; i < positions.length; ++i) {
      let x = positions[i][0];
      let y = positions[i][1];
      let z = positions[i][2];
      pos.push(
          x, y, z,   x, y, z,   x, y, z,
          x, y, z,   x, y, z,   x, y, z);

      let r = colors[i][0];
      let g = colors[i][1];
      let b = colors[i][2];
      col.push(
          r, g, b,   r, g, b,   r, g, b,
          r, g, b,   r, g, b,   r, g, b);

      let u0 = sprites[i].uvBounds.left;
      let v0 = sprites[i].uvBounds.top;
      let u1 = u0 + sprites[i].uvBounds.width;
      let v1 = v0 + sprites[i].uvBounds.height;
      uvs.push(
          u0, v0,   u1, v0,   u1, v1,
          u0, v0,   u1, v1,   u0, v1);

      let ox0 = sprites[i].left;
      let oy0 = sprites[i].top;
      let ox1 = sprites[i].right;
      let oy1 = sprites[i].bottom;
      off.push(
          ox0, oy0,   ox1, oy0,   ox1, oy1,
          ox0, oy0,   ox1, oy1,   ox0, oy1);
    }

    this.va = ctx.newVertexArray({
      position: {size: 3, data: new Float32Array(pos)},
      color: {size: 3, data: new Float32Array(col)},
      uv: {size: 2, data: new Float32Array(uvs)},
      offset: {size: 2, data: new Float32Array(off)},
    });
  }
}

export class Room {
  id = -1;
  x: number;
  z: number;
  yBottom: number;
  yTop: number;
  positions: Float32Array;
  colors: Float32Array;
  quads: Uint16Array;
  tris: Uint16Array;
  sprites: Uint16Array;
  portals: Portal[];
  sectorTableHeight: number;
  sectorTableWidth: number;
  sectorTable: Sector[];
  originalAmbientIntensity: number;
  ambientIntensity: number;
  lights: Light[];
  staticMeshes: RoomStaticMesh[];
  alternateRoom: number;
  flags: number;

  renderableStaticMeshes: RoomStaticMesh[] = [];
  triBatches: TriBatch[] = [];
  quadBatches: QuadBatch[] = [];
  spriteBatch: SpriteBatch = null;

  portalVa: VertexArray = null;

  constructor(stream: Stream) {
    this.id = -1;
    this.x = stream.readInt32();
    this.z = stream.readInt32();
    this.yBottom = stream.readInt32();
    this.yTop = stream.readInt32();

    // Skip room data size, we don't need it to parse the room.
    stream.readUint32();

    let numVertices = stream.readUint16();
    this.positions = new Float32Array(numVertices * 3);
    this.colors = new Float32Array(numVertices * 3);
    for (let i = 0; i < numVertices; ++i) {
      this.positions[i * 3] = this.x + stream.readInt16();
      this.positions[i * 3 + 1] = stream.readInt16();
      this.positions[i * 3 + 2] = this.z + stream.readInt16();
      let light = convertLight(stream.readUint16());
      this.colors[i * 3] = light;
      this.colors[i * 3 + 1] = light;
      this.colors[i * 3 + 2] = light;
    }

    //this.vertices = stream.readInt16Array(
    //    4 * stream.readUint16());  // X Y Z color

    this.quads = stream.readUint16Array(
        5 * stream.readUint16());  // positions[4] texture

    this.tris = stream.readUint16Array(
        4 * stream.readUint16());  // positions[3] texture

    this.sprites = stream.readUint16Array(
        2 * stream.readUint16());  // position texture

    let num = stream.readUint16();
    //console.log('Reading ' + num + ' portals');
    this.portals = new Array(num);
    for (let i = 0; i < num; ++i) {
      this.portals[i] = new Portal(stream, this.x, this.z);
    }

    // Transpose the sector table because I find the transposed table order
    // to be more intuitive (where x is in the range [0, sectorTableWidth) and
    // z is in the range [0, sectorTableHeight).
    this.sectorTableHeight = stream.readUint16();
    this.sectorTableWidth = stream.readUint16();
    this.sectorTable = new Array(this.sectorTableWidth * this.sectorTableHeight);
    for (let i = 0; i < this.sectorTableWidth; ++i) {
      let si = this.x / 1024 + i;
      for (let j = 0; j < this.sectorTableHeight; ++j) {
        let sj = this.z /1024 + j;
        this.sectorTable[i + j * this.sectorTableWidth] =
            new Sector(stream, this, si, sj);
      }
    }

    this.originalAmbientIntensity = stream.readUint16();
    this.ambientIntensity = convertLight(this.originalAmbientIntensity);

    num = stream.readUint16();
    this.lights = new Array(num);
    for (let i = 0; i < num; ++i) {
      this.lights[i] = new Light(stream);
    }

    num = stream.readUint16();
    this.staticMeshes = new Array(num);
    for (let i = 0; i < num; ++i) {
      this.staticMeshes[i] = new RoomStaticMesh(stream);
    }

    this.alternateRoom = stream.readInt16();
    this.flags = stream.readUint16();
  }

  private createPortalVertexArray(ctx: Context) {
    let positions = new Float32Array(3 * 6 * this.portals.length);
    let i = 0;
    for (let portal of this.portals) {
      let a = portal.vertices[0];
      let b = portal.vertices[1];
      let c = portal.vertices[2];
      let d = portal.vertices[3];
      positions[i++] = a[0];  positions[i++] = a[1];  positions[i++] = a[2];
      positions[i++] = b[0];  positions[i++] = b[1];  positions[i++] = b[2];
      positions[i++] = c[0];  positions[i++] = c[1];  positions[i++] = c[2];

      positions[i++] = a[0];  positions[i++] = a[1];  positions[i++] = a[2];
      positions[i++] = c[0];  positions[i++] = c[1];  positions[i++] = c[2];
      positions[i++] = d[0];  positions[i++] = d[1];  positions[i++] = d[2];
    }

    this.portalVa = ctx.newVertexArray({position: {size: 3, data: positions}});
  }

  init(ctx: Context, scene: Scene, id: number, lightMap: TextureAtlas) {
    this.id = id;

    let builder = new BatchBuilder(
        this.positions, this.colors, null, lightMap);

    // Create render batches.
    for (let i = 0; i < this.quads.length; i += 5) {
      let texture = scene.atlasObjectTextures[this.quads[i + 4]];
      builder.addQuad(this.quads, i, texture, null);
    }
    for (let i = 0; i < this.tris.length; i += 4) {
      let texture = scene.atlasObjectTextures[this.tris[i + 3]];
      builder.addTri(this.tris, i, texture, null);
    }
    builder.build(ctx, this.triBatches, this.quadBatches);

    this.createPortalVertexArray(ctx);

    // Create billboards.
    if (this.sprites.length > 0) {
      let positions = [];
      let colors = [];
      let sprites = [];
      for (let i = 0; i < this.sprites.length; i += 2) {
        let vertexIdx = this.sprites[i];
        let x = this.positions[vertexIdx * 3];
        let y = this.positions[vertexIdx * 3 + 1];
        let z = this.positions[vertexIdx * 3 + 2];
        positions.push(vec3.newFromValues(x, y, z));

        let r = this.colors[vertexIdx * 3];
        let g = this.colors[vertexIdx * 3 + 1];
        let b = this.colors[vertexIdx * 3 + 2];
        colors.push(vec3.newFromValues(r, g, b));

        sprites.push(scene.spriteTextures[this.sprites[i + 1]]);
      }
      this.spriteBatch = new SpriteBatch(ctx, positions, colors, sprites);
    }

    // Convert static mesh IDs to indices.
    for (let i = 0; i < this.staticMeshes.length; ++i) {
      let roomStaticMesh = this.staticMeshes[i];
      roomStaticMesh.staticMesh = scene.staticMeshes.find(
          a => a.id == roomStaticMesh.id);
      if (roomStaticMesh.staticMesh == null) {
        throw new Error('Couldn\'t find static mesh ' + roomStaticMesh.id);
      }
    }

    // Precalculate the list of static meshes that can be rendered.
    for (let i = 0; i < this.staticMeshes.length; ++i) {
      let roomStaticMesh = this.staticMeshes[i];
      let mesh = scene.meshes[roomStaticMesh.staticMesh.mesh];
      if (mesh != null) {
        // No room static meshes in TR1 have dynamic lighting, so the renderer
        // doesn't currently support that. Maybe they are in later games?
        if (mesh.dynamicLighting) {
          throw new Error(
              'Found a room static mesh with dynamic lighting, ' +
              'need to update renderer!');
        }
        this.renderableStaticMeshes.push(roomStaticMesh);
      }
    }

    // Convert floor indices to pointers.
    for (let i = 0; i < this.sectorTable.length; ++i) {
      let sector = this.sectorTable[i];
      if (sector.roomAboveIdx != 0xff) {
        sector.roomAbove = scene.rooms[sector.roomAboveIdx];
      }
      if (sector.roomBelowIdx != 0xff) {
        sector.roomBelow = scene.rooms[sector.roomBelowIdx];
      }
    }

    let basei = this.x / 1024;
    let basej = this.z / 1024;

    // Create floor & ceiling collision
    for (let j = basej; j < basej + this.sectorTableHeight; ++j) {
      for (let i = basei; i < basei + this.sectorTableWidth; ++i) {
        let sector = this.getSectorByGrid(i, j);
        if (sector.floorData.portal != null) {
          continue;
        }

        if (sector.roomBelow == null) {
          let v = [vec3.newZero(), vec3.newZero(), vec3.newZero(), vec3.newZero()];
          sector.getFloorVertex(0, 0, v[0]);
          sector.getFloorVertex(1, 0, v[1]);
          sector.getFloorVertex(1, 1, v[2]);
          sector.getFloorVertex(0, 1, v[3]);
          sector.quadCollision.push(v);
        }
        if (sector.roomAbove == null) {
          let v = [vec3.newZero(), vec3.newZero(), vec3.newZero(), vec3.newZero()];
          sector.getCeilingVertex(0, 1, v[0]);
          sector.getCeilingVertex(1, 1, v[1]);
          sector.getCeilingVertex(1, 0, v[2]);
          sector.getCeilingVertex(0, 0, v[3]);
          sector.quadCollision.push(v);
        }
      }
    }

    // Create wall collision.
    let walls = [
      {di: 0, dj: -1, indices: [1, 0, 3, 2]},
      {di: +1, dj: 0, indices: [3, 1, 2, 0]},
      {di: 0, dj: +1, indices: [2, 3, 0, 1]},
      {di: -1, dj: 0, indices: [0, 2, 1, 3]}
    ];
    for (let j = basej; j < basej + this.sectorTableHeight; ++j) {
      for (let i = basei; i < basei + this.sectorTableWidth; ++i) {
        let sector = this.getSectorByGrid(i, j);
        if (sector.floorData.portal != null) {
          continue;
        }

        for (let wallIdx = 0; wallIdx < walls.length; ++wallIdx) {
          let wall = walls[wallIdx];
          let ii = i + wall.di;
          let jj = j + wall.dj;
          let other = this.getSectorByGrid(ii, jj);
          if (other != null && other.floorData.portal != null) {
            other = other.floorData.portal.getSectorByGrid(ii, jj);
          }
          if (other == null) {
            continue;
          }

          // TODO(tom): clean this up
          let av = [vec3.newZero(), vec3.newZero(), vec3.newZero(), vec3.newZero()];
          let bv = [vec3.newZero(), vec3.newZero(), vec3.newZero(), vec3.newZero()];
          sector.getFloorVertex(0, 0, av[0]);
          sector.getFloorVertex(1, 0, av[1]);
          sector.getFloorVertex(0, 1, av[2]);
          sector.getFloorVertex(1, 1, av[3]);
          other.getFloorVertex(0, 0, bv[0]);
          other.getFloorVertex(1, 0, bv[1]);
          other.getFloorVertex(0, 1, bv[2]);
          other.getFloorVertex(1, 1, bv[3]);

          let v0 = av[wall.indices[0]];
          let v1 = av[wall.indices[1]];
          let v2 = bv[wall.indices[2]];
          let v3 = bv[wall.indices[3]];
          let bits = 0;
          if (v0[1] > v2[1]) { bits |= 1; }
          if (v1[1] > v3[1]) { bits |= 2; }
          switch (bits) {
            case 1: sector.triCollision.push([v0, v3, v2]); break;
            case 2: sector.triCollision.push([v2, v1, v3]); break;
            case 3: sector.quadCollision.push([v0, v1, v3, v2]); 
              break;
          }

          // TODO(tom): clean this up
          av = [vec3.newZero(), vec3.newZero(), vec3.newZero(), vec3.newZero()];
          bv = [vec3.newZero(), vec3.newZero(), vec3.newZero(), vec3.newZero()];
          sector.getCeilingVertex(0, 0, av[0]);
          sector.getCeilingVertex(1, 0, av[1]);
          sector.getCeilingVertex(0, 1, av[2]);
          sector.getCeilingVertex(1, 1, av[3]);
          other.getCeilingVertex(0, 0, bv[0]);
          other.getCeilingVertex(1, 0, bv[1]);
          other.getCeilingVertex(0, 1, bv[2]);
          other.getCeilingVertex(1, 1, bv[3]);

          v0 = av[wall.indices[1]];
          v1 = av[wall.indices[0]];
          v2 = bv[wall.indices[3]];
          v3 = bv[wall.indices[2]];
          bits = 0;
          if (v0[1] < v2[1]) { bits |= 1; }
          if (v1[1] < v3[1]) { bits |= 2; }
          switch (bits) {
            case 1: sector.triCollision.push([v0, v3, v2]); break;
            case 2: sector.triCollision.push([v2, v1, v3]); break;
            case 3: sector.quadCollision.push([v0, v1, v3, v2]);
              break;
          }
        }
      }
    }

    // Find all rooms above and below.
    // TODO(tom): move this into the renderer's ShProbeFields: it needs to be
    // done after all rooms have been initialized.
    // let allRooms = new Set<Room>();
    // let pending: Room[] = [this];
    // while (pending.length > 0) {
    //   let room = pending.pop();
    //   for (let sector of room.sectorTable) {
    //     if (sector.roomAbove != null && !allRooms.has(sector.roomAbove)) {
    //       allRooms.add(sector.roomAbove);
    //       pending.push(sector.roomAbove);
    //     }
    //     if (sector.roomBelow != null && !allRooms.has(sector.roomBelow)) {
    //       allRooms.add(sector.roomBelow);
    //       pending.push(sector.roomBelow);
    //     }
    //   }
    // }
    // this.allRoomsAboveAndBelow = Array.from(allRooms.values());
    // this.allRoomsAboveAndBelow.sort((a, b) => a.yBottom - b.yBottom);
  }

  getSectorByPosition(p: vec3.Type) {
    let i = ((p[0] / 1024)|0) - ((this.x / 1024)|0);
    let j = ((p[2] / 1024)|0) - ((this.z / 1024)|0);
    if (i < 0 || j < 0 ||
        i >= this.sectorTableWidth || j >= this.sectorTableHeight) {
      return null;
    }
    return this.sectorTable[i + j * this.sectorTableWidth];
  }

  getSectorByGrid(i: number, j: number) {
    i = (i|0) - ((this.x / 1024)|0);
    j = (j|0) - ((this.z / 1024)|0);
    if (i < 0 || j < 0 ||
        i >= this.sectorTableWidth || j >= this.sectorTableHeight) {
      return null;
    }
    return this.sectorTable[i + j * this.sectorTableWidth];
  }

  isUnderwater() { return (this.flags & 1) == 1; }
}

export interface TextureData {
  width: number;
  height: number;
  data: TypedArray;
}

export class FlipMapEntry {
  once = false;
  activeMask = 0;
}

export class Scene {
  version: number;
  atlasObjectTextures: AtlasObjectTexture[];
  flatWhiteTexture: AtlasObjectTexture;
  textiles: Textile[];
  rooms: Room[];
  rawFloorData: Uint16Array;
  meshes: Mesh[];
  animations: Animation[];
  stateChanges: StateChange[];
  animDispatches: AnimDispatch[];
  animCommands: Int16Array;
  meshTrees: Int32Array;
  rawFrames: Uint16Array;
  moveables: Moveable[];
  staticMeshes: StaticMesh[];
  objectTextures: ObjectTexture[];
  spriteTextures: SpriteTexture[];
  spriteSequences: SpriteSequence[];
  cameras: SceneCamera[];
  soundSources: SoundSource[];
  boxes: Box[];
  overlaps: Uint16Array;
  zones: Uint16Array;
  animatedTextures: AnimatedTexture[];
  items: Item[];
  controllers: Controller[];
  palette: Uint8Array;
  cinematicFrames: CinematicFrame[];
  demoData: Uint8Array;
  soundMap: Int16Array;
  soundDetails: SoundDetails[];
  samples: Uint8Array;
  sampleIndices: Uint32Array;
  frames: Frame[];
  floorData: FloorData[];
  atlasTex: TextureData;
  lightTex: TextureData;
  lara: Lara;
  secretsFound: boolean[] = [];
  flipMap: FlipMapEntry[] = [];
  flipped = false;

  constructor(public name: string, buf: ArrayBuffer, ctx: Context) {
    let stream = new Stream(buf);
    this.version = stream.readUint32();
    if (this.version != TR1) {
      throw new Error('Version 0x' + this.version.toString(16) + ' != 0x20');
    }

    this.textiles = this.readArray32(stream, Textile);

    stream.readUint32();  // ???

    this.rooms = this.readArray16(stream, Room);
    this.rawFloorData = stream.readUint16Array(stream.readUint32());
    this.meshes = this.readMeshes(stream);
    this.animations = this.readArray32(stream, Animation);
    this.stateChanges = this.readArray32(stream, StateChange);
    this.animDispatches = this.readArray32(stream, AnimDispatch);
    this.animCommands = stream.readInt16Array(stream.readUint32());
    this.meshTrees = stream.readInt32Array(stream.readUint32());
    this.rawFrames = stream.readUint16Array(stream.readUint32());
    this.moveables = this.readArray32(stream, Moveable);
    this.staticMeshes = this.readArray32(stream, StaticMesh);
    this.objectTextures = this.readArray32(stream, ObjectTexture);
    this.spriteTextures = this.readArray32(stream, SpriteTexture);
    this.spriteSequences = this.readArray32(stream, SpriteSequence);
    this.cameras = this.readArray32(stream, SceneCamera);
    this.soundSources = this.readArray32(stream, SoundSource);
    this.boxes = this.readArray32(stream, Box);
    this.overlaps = stream.readUint16Array(stream.readUint32());
    this.zones = stream.readUint16Array(6 * this.boxes.length);
    this.animatedTextures = this.readAnimatedTextures(stream);
    this.items = this.readArray32(stream, Item.bind(null, this.rooms));

    // Skip the light map.
    stream.readUint8Array(32 * 256);

    this.palette = stream.readUint8Array(3 * 256);
    this.cinematicFrames = this.readArray16(stream, CinematicFrame);
    this.demoData = stream.readUint8Array(stream.readUint16());
    this.soundMap = stream.readInt16Array(256);
    this.soundDetails = this.readArray32(stream, SoundDetails);
    this.samples = stream.readUint8Array(stream.readUint32());
    this.sampleIndices = stream.readUint32Array(stream.readUint32());

    if (stream.getOfs() != stream.getLength()) {
      throw new Error('Didn\'t read all the data :(');
    }

    hacks.applyPostLoadHacks(name, this);

    this.convertPalette();

    this.frames = this.parseAnimations();
    this.floorData = this.parseFloorData();

    // Set the id in each texture (useful when sorting out animated textures, and
    // packing them into an atlas).
    for (let i = 0; i < this.objectTextures.length; ++i) {
      this.objectTextures[i].id = i;
    }
    for (let i = 0; i < this.spriteTextures.length; ++i) {
      this.spriteTextures[i].id = i;
    }

    // Create texture atlas with some padding around each source texture.
    let atlas = new TextureAtlas(Uint8Array, 4096, 2048, 4, 16);
    let rgbaTiles = this.create32bitTiles();
    this.atlasObjectTextures = this.createAtlasObjectTextures(rgbaTiles, atlas);
    this.atlasSpriteTextures(rgbaTiles, atlas);
    this.flatWhiteTexture = this.createFlatWhiteTexture(atlas);
    atlas.dilateOpaque();
    this.atlasTex = {
      width: atlas.width,
      height: atlas.height,
      data: atlas.data,
    };

    // Link animated textures.
    for (let i = 0; i < this.animatedTextures.length; ++i) {
      let animTex = this.animatedTextures[i];
      for (let j = 0; j < animTex.ids.length; ++j) {
        animTex.textures[j] = this.atlasObjectTextures[animTex.ids[j]];
        animTex.textures[j].animTex = animTex;
        animTex.textures[j].animOffset = j;
      }
    }

    // Create a texture atlas for light maps. No padding needed this time.
    let lightMap = new TextureAtlas(Uint32Array, 512, 512, 1, 0);
    for (let i = 0; i < this.rooms.length; ++i) {
      this.rooms[i].init(ctx, this, i, lightMap);
    }
    for (let [i, mesh] of this.meshes.entries()) {
      if (mesh != null) {
        mesh.init(ctx, this, i, lightMap);
      }
    }
    this.lightTex = {
      width: lightMap.width,
      height: lightMap.height,
      data: lightMap.data,
    };

    for (let stateChange of this.stateChanges) {
      stateChange.init(this.animDispatches);
    }
    for (let i = 0; i < this.animations.length; ++i) {
      this.animations[i].init(
          i, this.animations, this.stateChanges, this.animCommands, this.frames);
    }
    for (let i = 0; i < this.items.length; ++i) {
      this.items[i].init(i, this);
    }
    for (let moveable of this.moveables) {
      moveable.init(this);
    }
    for (let seq of this.spriteSequences) {
      seq.init(ctx, this);
    }

    this.createComponents();
  }

  flipRooms() {
    // TODO(tom): how is the crocodile in St Francis Folly handled?
    for (let a of this.rooms) {
      if (a.alternateRoom == -1) { continue; }
      let b = this.rooms[a.alternateRoom];

      console.log(`flipping rooms ${a.id} & ${b.id}`);

      // Swap portal sectors.
      for (let fd of this.floorData) {
        if (fd.portal == a) { fd.portal = b; }
      }

      // Floor above and below;
      for (let room of this.rooms) {
        for (let sector of room.sectorTable) {
          if (sector.roomBelow == a) { sector.roomBelow = b; }
          if (sector.roomAbove == a) { sector.roomAbove = b; }
        }
      }
    }

    for (let i = 0; i < this.rooms.length; ++i) {
      let a = this.rooms[i];
      let j = a.alternateRoom;
      if (j == -1) { continue; }
      let b = this.rooms[j];
      this.rooms[i] = b;
      this.rooms[j] = a;
      a.alternateRoom = -1;
      b.alternateRoom = j;
      a.id = j;
      b.id = i;
    }

    this.flipped = !this.flipped;
  }

  /**
   * Run all the actions in the floor func.
   * @param func
   * @param begin the index of actions to start from. For most triggers, `begin`
   *        should be 0 (because index 0 is the triggerMask, oneShot & other
   *        flags). For pickup or switch triggers, `begin` should be 1 because
   *        index 0 is the entity being interacted with.
   */
  runActions(trigger: Trigger, begin: number) {
    let needFlip = false;

    for (let i = begin; i < trigger.actions.length; ++i) {
      let action = trigger.actions[i];
      switch (action.type) {
        case Trigger.Action.Type.ACTIVATE:
          if (action.parameter >= this.controllers.length) {
            console.log(`Activate item index ${action.parameter} out of range`);
            continue;
          }

          let item = this.items[action.parameter];
          let isLocked = item.isActive() && item.activationLocked;

          if (trigger.type == Trigger.Type.SWITCH) {
            if (!isLocked) {
              item.activeMask ^= trigger.mask;
            }
          } else if (trigger.type == Trigger.Type.TRIGGER_OFF ||
                     trigger.type == Trigger.Type.PAD_OFF) {
            // TODO(tom): PAD_OFF needs to respect the oneShot trigger flag
            // (see the switch & gorilla room at the start of St Francis' Folly)
            // but what about TRIGGER_OFF?
            if (!isLocked) {
              item.activeMask &= ~trigger.mask;
            }
          } else {
            item.activeMask |= trigger.mask;
          }
          if (trigger.oneShot && item.isActive()) {
            item.activationLocked = true;
          }
          item.controller.activate();
          break;

        case Trigger.Action.Type.CAMERA_SWITCH:
          // TODO(tom)
          break;

        case Trigger.Action.Type.UNDERWATER_CURRENT:
          // TODO(tom)
          break;

        case Trigger.Action.Type.FLIP_MAP:
          // Lazily create the flip map entries.
          let flip = this.flipMap[action.parameter];
          if (flip == null) {
            flip = new FlipMapEntry();
            this.flipMap[action.parameter] = flip;
          }

          if (flip.once) { break; }
          if (trigger.type == Trigger.Type.SWITCH) {
            flip.activeMask ^= trigger.mask;
            if (flip.activeMask == ACTIVE) {
              flip.once = flip.once || trigger.oneShot;
            }
            if ((flip.activeMask == ACTIVE) != this.flipped) {
              needFlip = true;
            }
          }
          break;

        case Trigger.Action.Type.FLIP_ON:
          // TODO(tom)
          break;

        case Trigger.Action.Type.FLIP_OFF:
          // TODO(tom)
          break;

        case Trigger.Action.Type.LOOK_AT:
          // TODO(tom)
          break;

        case Trigger.Action.Type.END_LEVEL:
          // TODO(tom)
          break;

        case Trigger.Action.Type.FLIP_EFFECT:
          // TODO(tom)
          break;

        case Trigger.Action.Type.PLAY_MUSIC:
          audio.playTrack(action.parameter, trigger.mask);
          break;

        case Trigger.Action.Type.SECRET:
          if (!this.secretsFound[action.parameter]) {
            this.secretsFound[action.parameter] = true;
            audio.playSecret();
          }
          break;

        case Trigger.Action.Type.CLEAR_BODIES:
          // TODO(tom)
          break;

        case Trigger.Action.Type.FLY_BY:
          // TODO(tom)
          break;

        case Trigger.Action.Type.CUTSCENE:
          // TODO(tom)
          break;
      }
    }

    if (needFlip) {
      this.flipRooms();
    }
  }

  private readMeshes(stream: Stream) {
    let size = 2 * stream.readUint32();
    let begin = stream.getOfs();
    stream.setOfs(begin + size);
    let num = stream.readUint32();
    let offsets = stream.readUint32Array(num);
    let end = stream.getOfs();
    stream.setOfs(begin);

    // Read meshes.
    let meshes = new Array(offsets.length);
    for (let i = 0; i < offsets.length; ++i) {
      if (i > 0 && offsets[i] == 0) {
        meshes[i] = null;
        continue;
      }
      stream.setOfs(begin + offsets[i]);
      meshes[i] = new Mesh(stream);
    }
    stream.setOfs(end);

    return meshes;
  }

  private readAnimatedTextures(stream: Stream) {
    let data = stream.readUint16Array(stream.readUint32());
    let textures = new Array(data[0]);
    let idx = 1;
    for (let i = 0; i < textures.length; ++i) {
      let count = 1 + data[idx++];
      let texture = new AnimatedTexture(count);
      for (let j = 0; j < count; ++j) {
        let id = data[idx++];
        texture.ids[j] = id;
      }
      textures[i] = texture;
    }
    return textures;
  }

  // TODO(tom): don't convert the palette: the top bit of the palette entry
  // determines if a polygon is double-sided or not and we need to preserve that.
  private convertPalette() {
    let palette = new Uint8Array(4 * 256);
    // Leave the first palette entry as transparent black.
    for (let i = 1; i < 256; ++i) {
      palette[i * 4 + 0] = Math.min(255, this.palette[i * 3 + 0] * 255 / 63);
      palette[i * 4 + 1] = Math.min(255, this.palette[i * 3 + 1] * 255 / 63);
      palette[i * 4 + 2] = Math.min(255, this.palette[i * 3 + 2] * 255 / 63);
      palette[i * 4 + 3] = 0xff;
    }
    this.palette = palette;
  }

  private parseAnimations() {
    let parsed = parseFrames(this.rawFrames);
    let frameRemap = parsed.remap;
    let parsedFrames = parsed.frames;

    // Remap animation frame offsets.
    for (let i = 0; i < this.animations.length; ++i) {
      let anim = this.animations[i];
      let remapped = frameRemap[(anim.frameOffset / 2)|0];
      if (remapped != null) {
        anim.frameOffset = remapped;
      } else {
        console.log(anim);
        throw new Error(
            'offset ' + anim.frameOffset + ' isn\'t the start of a frame');
      }
    }

    // Remap moveable frame offsets.
    for (let i = 0; i < this.moveables.length; ++i) {
      let moveable = this.moveables[i];
      if (moveable.animId == -1) {
        continue;
      }
      let remapped = frameRemap[(moveable.frameOffset / 2)|0];
      if (remapped === undefined) {
        console.log(moveable);
        throw new Error(
            'offset ' + moveable.frameOffset + ' isn\'t the start of a frame');
      }
      moveable.frameOffset = remapped;
    }

    /*
    for (let i = 0; i < this.animations.length - 1; ++i) {
      let a = this.animations[i];
      let b = this.animations[i + 1];
      let numFrames = a.lastFrame - a.firstFrame - 1;
      let str = i + ':  ofs:' + a.frameOffset;
      str += '  [' + a.firstFrame +
             ', ' + a.lastFrame + ']' +
             '  rate:' + a.frameRate;
      str += '  hmm:' + (a.frameOffset + numFrames / a.frameRate);
      let f = Math.ceil(a.frameOffset + numFrames / a.frameRate) + 1;
      //if (f != b.frameOffset) {
        //console.log('####### :(');
      //}
      console.log(str);
    }
    */

    return parsedFrames;
  }

  private parseFloorData() {
    let decodeSlope = function(data: number, result: vec2.Type) {
      let x = data & 0xff;
      let z = (data >> 8) & 0xff;
      if (x & 0x80) { x -= 256; }
      if (z & 0x80) { z -= 256; }
      result[0] = 256 * x;
      result[1] = 256 * z;
    }

    /** @type {!Array<!FloorData>} */
    let parsedFloorData = [];

    let remap = new Array(this.rawFloorData.length);

    // Skip the first entry in the rawFloorData array, it doesn't contain normal
    // floor data and I don't know what it means. Instead, add an empty entry
    // to the parsed table.
    remap[0] = 0;
    parsedFloorData.push(new FloorData());
    let idx = 1;
    while (idx < this.rawFloorData.length) {
      remap[idx] = parsedFloorData.length;

      let parsed = new FloorData();
      let data, funcType, subFunc, end: number;
      do {
        data = this.rawFloorData[idx++];
        funcType = data & 0x1f;
        subFunc = (data >> 8) & 0x7f;
        end = (data >> 15) & 0x1;

        switch (funcType) {
          case FloorFuncType.NONE:
            break;

          case FloorFuncType.PORTAL_SECTOR:
            let roomIdx = this.rawFloorData[idx++];
            if (roomIdx != -1) {
              parsed.portal = this.rooms[roomIdx];
            }
            break;

          case FloorFuncType.FLOOR_SLOPE:
            decodeSlope(this.rawFloorData[idx++], parsed.floorSlope);
            break;

          case FloorFuncType.CEILING_SLOPE:
            decodeSlope(this.rawFloorData[idx++], parsed.ceilingSlope);
            break;

          case FloorFuncType.TRIGGER:
            parsed.trigger = new Trigger(subFunc, this.rawFloorData[idx++]);

            // TRIGGER has a sequence of actions.
            // The last one in the sequence has its top bit set.
            do {
              if (idx >= this.rawFloorData.length) {
                throw new Error(
                    'Ran off the end of the rawFloorData array: ' + idx +
                    ' >= ' + this.rawFloorData.length);
              }
              let bits = this.rawFloorData[idx] & 0x7fff;
              let type = (bits >> 10) & 0xf;
              let parameter = bits & 0x3ff;
              if (type == Trigger.Action.Type.CAMERA_SWITCH) {
                let parameter2 = this.rawFloorData[++idx] & 0x7fff;
                parsed.trigger.actions.push({type, parameter, parameter2});
              } else {
                parsed.trigger.actions.push({type, parameter});
              }
            } while ((this.rawFloorData[idx++] & 0x8000) == 0);
            break;

          case FloorFuncType.KILL:
            parsed.kill = true;
            break;

          case FloorFuncType.CLIMBABLE_WALL:
            parsed.climbableWalls = subFunc;
            break

          default:
            throw new Error(`Unrecognized floor func type: ${funcType}`);
        }
      } while (!end);
      parsedFloorData.push(parsed);
    }

    if (idx > this.rawFloorData.length) {
      throw new Error(`
          'Ran off the end of the rawFloorData array: ${idx} > ${this.rawFloorData.length}`);
    }

    // Remap indices into the raw data to the parsed array.
    for (let roomIdx = 0; roomIdx < this.rooms.length; ++roomIdx) {
      let room = this.rooms[roomIdx];
      for (let sector of room.sectorTable) {
        if (remap[sector.floorDataIdx] === undefined) {
          throw new Error(`floor data ${sector.floorDataIdx} undefined`);
        }
        sector.floorDataIdx = remap[sector.floorDataIdx];
        sector.floorData = parsedFloorData[sector.floorDataIdx];
      }
    }

    return parsedFloorData;
  }

  /**
   * @param uvBounds
   * @param src 256 * 256 32bit textile
   * @return {!Uint8Array} A copy of the texture data in an array of size
   *     uvBounds.width * uvBounds.height
   */
  private copyTexture(uvBounds: Rect, src: Uint8Array) {
    let dst = new Uint8Array(4 * uvBounds.width * uvBounds.height);
    for (let dstV = 0; dstV < uvBounds.height; ++dstV) {
      let srcV = uvBounds.top + dstV;
      for (let dstU = 0; dstU < uvBounds.width; ++dstU) {
        let srcU = uvBounds.left + dstU;
        let srcIdx = 4 * (srcU + srcV * 256);
        let dstIdx = 4 * (dstU + dstV * uvBounds.width);
        dst[dstIdx++] = src[srcIdx++];
        dst[dstIdx++] = src[srcIdx++];
        dst[dstIdx++] = src[srcIdx++];
        dst[dstIdx++] = src[srcIdx++];
      }
    }
    return dst;
  }

  /**
   * @return {Uint8Array[]} 32bit copies of each textile in the scene.
   */
  private create32bitTiles() {
    let pushTex = function(width: number, height: number, data: Uint8Array) {
      let canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = (width / 2) + 'px';
      canvas.style.height = (height / 2) + 'px';
      let ctx2d = canvas.getContext('2d');
      let imageData = ctx2d.createImageData(width, height);
      for (let j = 0; j < data.length; ++j) {
        imageData.data[j] = data[j];
      }
      ctx2d.putImageData(imageData, 0, 0);
      document.body.appendChild(document.createElement('br'));
      document.body.appendChild(document.createElement('br'));
      document.body.appendChild(canvas);
    }

    // Convert 8bit palettized textures to 32bit RGBA textures.
    let rgbaTiles = [];
    for (let i = 0; i < this.textiles.length; ++i) {
      let src = this.textiles[i].data;
      let dst = new Uint8Array(4 * 256 * 256);
      for (let j = 0; j < 256 * 256; ++j) {
        let a = j * 4;
        let b = src[j] * 4;
        dst[a++] = this.palette[b++];
        dst[a++] = this.palette[b++];
        dst[a++] = this.palette[b++];
        dst[a++] = this.palette[b++];
      }
      rgbaTiles.push(dst);
      pushTex(256, 256, dst);
    }

    return rgbaTiles;
  }

  private createAtlasObjectTextures(rgbaTiles: Uint8Array[], atlas: TextureAtlas) {
    // Sort object textures by decreasing height before inserting into the atlas.
    // The current texture atlasing algorithm is very simple, so this sorting
    // improves its packing efficiency considerably.
    this.objectTextures.sort((a, b) => {
      let dh = a.uvBounds.height - b.uvBounds.height;
      if (dh != 0) { return dh; }
      return b.uvBounds.left - a.uvBounds.left;
    });

    let atlasObjectTextures = new Array(this.objectTextures.length);

    // Create a map to dedup object textures. Because the UVs are in the range
    // [0, 256), we can map their bounds to a single 32bit integer.
    let dedupMap: Map<number, Rect>[] = [];
    for (let i = 0; i < rgbaTiles.length; ++i) { dedupMap.push(new Map<number, Rect>()); }

    for (let srcIdx = 0; srcIdx < this.objectTextures.length; ++srcIdx) {
      let srcTex = this.objectTextures[srcIdx];
      let dstTex = new AtlasObjectTexture(
          srcTex.id, srcTex.attributes, srcTex.numUvs);

      let tile = rgbaTiles[srcTex.tile];
      let uvBounds = srcTex.uvBounds;

      let uvKey = uvBounds.left | (uvBounds.top << 8) |
                  (uvBounds.width << 16) | (uvBounds.height << 24);
      let atlasBounds = dedupMap[srcTex.tile].get(uvKey);
      if (atlasBounds == null) {
        let data = this.copyTexture(uvBounds, tile);
        atlasBounds = new Rect(0, 0, 0, 0);
        atlas.add(uvBounds.width, uvBounds.height, data, atlasBounds);
        dedupMap[srcTex.tile].set(uvKey, atlasBounds);
      }

      dstTex.texBounds[0] = atlasBounds.left;
      dstTex.texBounds[1] = atlasBounds.top;
      dstTex.texBounds[2] = atlasBounds.width;
      dstTex.texBounds[3] = atlasBounds.height;
      for (let i = 0; i < dstTex.uvs.length; i += 2) {
        let du = (srcTex.uvs[i * 2 + 1] - uvBounds.left) / (uvBounds.width - 1);
        let dv = (srcTex.uvs[i * 2 + 3] - uvBounds.top) / (uvBounds.height - 1);
        dstTex.uvs[i] = atlasBounds.left + du * atlasBounds.width;
        dstTex.uvs[i + 1] = atlasBounds.top + dv * atlasBounds.height;
      }

      atlasObjectTextures[srcTex.id] = dstTex;
    }

    // Revert textures to original sorting.
    this.objectTextures.sort((a, b) => { return a.id - b.id; });

    return atlasObjectTextures;
  }

  /**
   * @param rgbaTiles 32bit copies of each textile
   * @param atlas
   */
  private atlasSpriteTextures(rgbaTiles: Uint8Array[], atlas: TextureAtlas) {
    this.spriteTextures.sort((a, b) => {
      let dh = a.uvBounds.height - b.uvBounds.height;
      if (dh != 0) { return dh; }
      return b.uvBounds.left - a.uvBounds.left;
    });

    let dedupMap: Rect[][] = [];
    for (let i = 0; i < rgbaTiles.length; ++i) { dedupMap.push([]); }

    for (let texIdx = 0; texIdx < this.spriteTextures.length; ++texIdx) {
      let tex = this.spriteTextures[texIdx];
      let tile = rgbaTiles[tex.tile];
      let uvBounds = tex.uvBounds;

      let uvKey = uvBounds.left | (uvBounds.top << 8) |
                  (uvBounds.width << 16) | (uvBounds.height << 24);
      let atlasBounds = dedupMap[tex.tile][uvKey];
      if (!atlasBounds) {
        let data = this.copyTexture(uvBounds, tile);
        atlasBounds = new Rect(0, 0, 0, 0);
        atlas.add(uvBounds.width, uvBounds.height, data, atlasBounds);
        dedupMap[tex.tile][uvKey] = atlasBounds;
      }

      tex.uvBounds.left = atlasBounds.left;
      tex.uvBounds.top = atlasBounds.top;
      tex.uvBounds.width = atlasBounds.width;
      tex.uvBounds.height = atlasBounds.height;
    }

    // Revert textures to original sorting.
    this.spriteTextures.sort((a, b) => { return a.id - b.id; });
  }

  private createFlatWhiteTexture(atlas: TextureAtlas) {
    // Create a solid white texture in the atlas for use with flat shaded models.
    let data = new Uint8Array(4 * 8 * 8);
    data.fill(0xff);
    let atlasBounds = new Rect(0, 0, 0, 0);
    atlas.add(8, 8, data, atlasBounds);
    let flatWhiteTexture = new AtlasObjectTexture(
        this.atlasObjectTextures.length, 0, 4);
    flatWhiteTexture.texBounds[0] = atlasBounds.left;
    flatWhiteTexture.texBounds[1] = atlasBounds.top;
    flatWhiteTexture.texBounds[2] = atlasBounds.width;
    flatWhiteTexture.texBounds[3] = atlasBounds.height;
    flatWhiteTexture.uvs[0] = atlasBounds.left;
    flatWhiteTexture.uvs[1] = atlasBounds.top;
    flatWhiteTexture.uvs[2] = atlasBounds.left + atlasBounds.width;
    flatWhiteTexture.uvs[3] = atlasBounds.top;
    flatWhiteTexture.uvs[4] = atlasBounds.left + atlasBounds.width;
    flatWhiteTexture.uvs[5] = atlasBounds.top + atlasBounds.height;
    flatWhiteTexture.uvs[6] = atlasBounds.left;
    flatWhiteTexture.uvs[7] = atlasBounds.top + atlasBounds.height;
    return flatWhiteTexture;
  }

  private readArray16<T>(stream: Stream, ctor: {new(stream: Stream): T}): T[] {
    return this.readArray(stream, ctor, stream.readUint16());
  }

  private readArray32<T>(stream: Stream, ctor: {new(stream: Stream): T}): T[] {
    return this.readArray(stream, ctor, stream.readUint32());
  }

  private readArray<T>(stream: Stream, ctor: {new(stream: Stream): T}, num: number): T[] {
    let array = new Array(num);
    for (let i = 0; i < num; ++i) {
      array[i] = new ctor(stream);
    }
    return array;
  }

  private createComponents() {
    this.controllers = [];
    for (let item of this.items) {
      if (item.animState != null) {
        item.animState.anim.getFrame(
            item.animState.frameIdx, item.animState.frameOfs, item.animState.frame);
        item.animState.setMeshTransforms(
            item.moveable.meshCount, item.moveable.meshTree, this.meshTrees);
      }

      let controller: Controller;
      if (item.isLara()) {
        this.lara = new Lara(item, this);
        controller = this.lara;
      } else if (item.isBlock()) {
        // TODO(tom): make Block a component.
        controller = new Block(item, this);
      } else if (item.isBridge()) {
        controller = new Controller(item, this);
        item.components.push(new Bridge(item));
      } else if (item.isDoor()) {
        controller = new Controller(item, this);
        item.components.push(new Door(item));
      } else if (item.isSwitch()) {
        controller = new Controller(item, this);
        item.components.push(new Switch(item, this));
      } else if (item.isTrapDoor()) {
        controller = new Controller(item, this);
        item.components.push(new Door(item));
        item.components.push(new Bridge(item));
      } else {
        controller = new Controller(item, this);
      }
      this.controllers.push(controller);

      if (item.activeMask == ACTIVE) {
        item.controller.activate();
        item.activeMask = 0;
        item.reverse = true;
      }
    }

    if (this.lara == null) {
      throw 'Couldn\'t find Lara :(';
    }

    // Activate bridge components.
    // These need to be activated before Lara stands on the trigger otherwise
    // she won't be able to walk on them.
    for (let item of this.items) {
      if (item.isBridge() || item.isTrapDoor() || item.isDoor()) {
        item.controller.activate();
      }
    }
  }
}
