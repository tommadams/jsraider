import * as mat4 from 'toybox/math/mat4';
import * as vec2 from 'toybox/math/vec2';
import * as vec3 from 'toybox/math/vec3';
import {Animation, AnimCommand, AnimDispatch, AnimState, Frame, StateChange, parseFrames} from 'animation';
import {Context} from 'toybox/gl/context';
import {TextureAtlas} from 'texture_atlas';
import {VertexArray} from 'toybox/gl/vertex_array';
import {Rect} from 'toybox/math/rect';
import {BatchBuilder} from 'batch_builder';
import {GL} from 'toybox/gl/constants';
import {Stream} from 'toybox/util/stream';

import {Block} from 'controllers/block';
import {Controller} from 'controllers/controller';
import {Lara, LaraBone, LocomotionType} from 'controllers/lara';
import {Switch} from 'controllers/switch';
import {QuadBatch, TriBatch} from 'batch_builder';
import * as hacks from 'hacks';
import * as audio from 'audio';

export const V1 = 0x20;

export enum ItemType {
  LARA = 0,

  WOLF = 7,
  BEAR = 8,
  BAT = 9,
  CROCODILE = 10,
  CROCODILE_SWIM = 11,
  LION_MALE = 12,
  LION_FEMALE = 13,
  PANTHER = 14,
  GORILLA = 15,
  RAT = 16,
  RAT_SWIM = 17,
  T_REX = 18,
  VELOCIRAPTOR = 19,
  ATLANTEAN_MUTANT = 20,

  LARSON = 27,
  PIERRE = 28,
  SKATEBOARD = 29,
  SKATEBOARD_KID = 30,
  COWBOY = 31,
  KIN_KADE = 32,
  WINGED_NATLA = 33,
  TORSO_BOSS = 34,
  CRUMBLE_FLOOR = 35,
  SWINGING_AXE = 36,

  DART_GUN = 40,

  BARRICADE = 47,
  BLOCK_1 = 48,
  BLOCK_2 = 49,

  SWITCH = 55,
  UNDERWATER_SWITCH = 56,

  DOOR_1 = 57,
  DOOR_2 = 58,
  DOOR_3 = 59,
  DOOR_4 = 60,
  BIG_DOOR_1 = 61,
  BIG_DOOR_2 = 62,

  TRAP_DOOR_1 = 65,
  TRAP_DOOR_2 = 66,

  BRIDGE_FLAT = 68,
  BRIDGE_SLOPE_1 = 69,
  BRIDGE_SLOPE_2 = 70,
  PASSPORT_OPENING = 71,
  COMPASS = 72,
  LARAS_HOME_PHOTO = 73,
  ANIMATING_1 = 74,
  ANIMATING_2 = 75,
  ANIMATING_3 = 76,
  CUTSCENE_ACTOR_1 = 77,
  CUTSCENE_ACTOR_2 = 78,
  CUTSCENE_ACTOR_3 = 79,
  CUTSCENE_ACTOR_4 = 80,
  PASSPORT_CLOSED = 81,
  UNUSED_MAP = 82,
  SAVE_CRYSTAL = 83,
  PISTOLS = 84,
  SHOTGUN = 85,
  MAGNUMS = 86,
  UZIS = 87,
  PISTOL_AMMO = 88,
  SHOTGUN_AMMO = 89,
  MAGNUM_AMMO = 90,
  UZI_AMMO = 91,
  UNUSED_EXPLOSIVE = 92,
  SMALL_MEDIPACK = 93,
  LARGE_MEDIPACK = 94,
  // SUNGLASSES = 95,
  // CASETTE_PLAYER = 96,
  // DIRECTION_KEYS = 97,
  // FLASHLIGHT = 98,
  // PISTOLS = 99,
  // SHOTGUN = 100,
  // MAGNUMS = 101,
  // UZIS = 102,

  PUZZLE_1 = 110,
  PUZZLE_2 = 111,
  PUZZLE_3 = 112,
  PUZZLE_4 = 113,

  KEY_1 = 129,
  KEY_2 = 130,
  KEY_3 = 131,
  KEY_4 = 132,

  KEYHOLE_1 = 137,
  KEYHOLE_2 = 138,
  KEYHOLE_3 = 139,
  KEYHOLE_4 = 140,

  CAMERA_TARGET = 169,
  WATERFALL_SPLASH = 170,
}

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
  unknown: number;
  rotX: number;

  constructor(stream: Stream) {
    this.rotY = stream.readInt16();
    this.rotZ = stream.readInt16();
    this.rotZ2 = stream.readInt16();
    this.posZ = stream.readInt16();
    this.posY = stream.readInt16();
    this.posX = stream.readInt16();
    this.unknown = stream.readInt16();
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
  type: number;
  position: vec3.Type;
  rawRotation: number;
  rotation: vec3.Type;
  intensity: number;
  flags: number;
  moveable: Moveable = null;
  animState: AnimState = null;
  spriteSequence: SpriteSequence = null;
  active = true;
  renderable = true;
  room: Room;
  controller: Controller = null;

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

  init(scene: Scene) {
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

  isInvisible() {
    return (this.flags & 0x100) != 0;
  }

  activationMask() {
    return (this.flags >> 8) & 0x3e;
  }

  // TODO(tom): make look up tables for these.
  isBlock() {
    return (this.type == ItemType.BLOCK_1 ||
            this.type == ItemType.BLOCK_2);
  }

  isBridge() {
    return (this.type == ItemType.BRIDGE_FLAT ||
            this.type == ItemType.BRIDGE_SLOPE_1 ||
            this.type == ItemType.BRIDGE_SLOPE_2);
  }

  isSwitch() {
    return (this.type == ItemType.SWITCH ||
            this.type == ItemType.UNDERWATER_SWITCH);
  }

  isPickup() {
    switch (this.type) {
      case ItemType.SHOTGUN:
      case ItemType.MAGNUMS:
      case ItemType.UZIS:
      case ItemType.PISTOL_AMMO:
      case ItemType.SHOTGUN_AMMO:
      case ItemType.MAGNUM_AMMO:
      case ItemType.UZI_AMMO:
      case ItemType.UNUSED_EXPLOSIVE:
      case ItemType.SMALL_MEDIPACK:
      case ItemType.LARGE_MEDIPACK:
      case ItemType.PUZZLE_1:
      case ItemType.PUZZLE_2:
      case ItemType.PUZZLE_3:
      case ItemType.PUZZLE_4:
      case ItemType.KEY_1:
      case ItemType.KEY_2:
      case ItemType.KEY_3:
      case ItemType.KEY_4:
        return true;
    }
    return false;
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
  center: Int16Array;
  size: number;
  vertices: Int16Array;
  colors: Float32Array;
  normals: Int16Array;
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
    this.vertices = stream.readInt16Array(3 * stream.readUint16());

    let numVertices = stream.readInt16();
    this.dynamicLighting = numVertices > 0;

    if (this.dynamicLighting) {
      this.normals = stream.readInt16Array(3 * numVertices);
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

  init(ctx: Context, scene: Scene, lightMap: TextureAtlas) {
    let builder = new BatchBuilder(
        this.vertices, this.colors, this.normals, lightMap);

    for (let i = 0; i < this.texturedQuads.length; i += 5) {
      let texture = scene.atlasObjectTextures[this.texturedQuads[i + 4]];
      builder.addQuad(this.texturedQuads, i, texture, null);
    }

    for (let i = 0; i < this.texturedTris.length; i += 4) {
      let texture = scene.atlasObjectTextures[this.texturedTris[i + 3]];
      builder.addTri(this.texturedTris, i, texture, null);
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
    // TODO(tom): Actually, it seems that U type and V type can sometimes be zero
    // too (see Palas Midas).
    this.uvs = stream.readUint8Array(16);

    this.numUvs = this.uvs[12] == 0 ? 3 : 4;

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

export class FloorFunc {
  actions: number[] = [];
  constructor(public type: number, public sub: number) {
    if (type < 0 || type >= FloorFunc.Type.NUM_TYPES) {
      throw new Error('Floor data function type out of range: ' + type);
    }
  }
}

export namespace FloorFunc {
  export enum Type {
    NONE = 0,
    PORTAL_SECTOR = 1,
    FLOOR_SLOPE = 2,
    CEILING_SLOPE = 3,
    TRIGGER = 4,
    KILL = 5,
    CLIMBABLE_WALL = 6,

    NUM_TYPES = 7,
  }

  export enum Op {
    ITEM = 0,
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
  }
}

export enum TriggerType {
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

export class FloorData {
  floorSlope = vec2.newZero();
  ceilingSlope = vec2.newZero();
  portal: Room = null;
  funcs: FloorFunc[] = [];
  bridge: Item = null;
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

  getTriggers(predicate: (f: FloorFunc) => boolean) {
    let result = [];
    for (let func of this.floorData.funcs) {
      if (func.type != FloorFunc.Type.TRIGGER) {
        continue;
      }
      if (predicate(func)) {
        result.push(func);
      }
    }
    return result;
  }

  getTrigger(triggerType: TriggerType) {
    let result: FloorFunc = null;
    for (let func of this.floorData.funcs) {
      if (func.type == FloorFunc.Type.TRIGGER &&
          func.sub == triggerType) {
        if (result != null) {
          throw new Error(`found multiple triggers with the same type`);
        }
        result = func;
      }
    }
    return result;
  }

  /** Returns the sector that contains the real floor (not a portal). */
  getResolvedFloorSector() {
    let sector: Sector = this;
    while (sector.roomBelow != null) {
      sector = sector.roomBelow.getSectorByGrid(sector.i, sector.j);
    }
    return sector;
  }

  /** Returns the sector that contains the ceiling floor (not a portal). */
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
   *sector * to pos. */
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

    let bridge = sector.floorData.bridge;
    let y, fx, fz;
    if (bridge != null && pos[1] - 640 <= bridge.position[1]) {
      y = bridge.position[1];

      // Figure out the bridge slope based on its type and rotation.
      let slope = 0;
      if (bridge.type == ItemType.BRIDGE_SLOPE_1) {
        slope = 256;
      } else if (bridge.type == ItemType.BRIDGE_SLOPE_2) {
        slope = 512;
      }

      let dir = (bridge.rawRotation / 16384)|0;
      dir = dir % 4;
      if (dir < 0) { dir += 4; }

      fx = 0;
      fz = 0;
      switch (dir) {
        case 0: fx = slope; break;
        case 1: fz = -slope; break;
        case 2: fx = -slope; break;
        case 3: fz = slope; break;
      }
    } else {
      y = sector.floor;
      fx = sector.floorData.floorSlope[0];
      fz = sector.floorData.floorSlope[1];
    }

    let u = pos[0] / 1024 - sector.i;
    let v = pos[2] / 1024 - sector.j;
    u = Math.max(0, Math.min(1, u));
    v = Math.max(0, Math.min(1, v));

    if (fx > 0) {
      y += fx * (1 - u);
    } else {
      y -= fx * u;
    }
    if (fz > 0) {
      y += fz * (1 - v);
    } else {
      y -= fz * v;
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
    let u = pos[0] / 1024 - sector.i;
    let v = pos[2] / 1024 - sector.j;
    u = Math.max(0, Math.min(1, u));
    v = Math.max(0, Math.min(1, v));

    let y = sector.ceiling;
    let fx = sector.floorData.ceilingSlope[0];
    let fz = sector.floorData.ceilingSlope[1];
    if (fx > 0) {
      y -= fx * u;
    } else {
      y += fx * (1 - u);
    }
    if (fz > 0) {
      y -= fz * (1 - v);
    } else {
      y += fz * v;
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
        5 * stream.readUint16());  // vertices[4] texture

    this.tris = stream.readUint16Array(
        4 * stream.readUint16());  // vertices[3] texture

    this.sprites = stream.readUint16Array(
        2 * stream.readUint16());  // vertex texture

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

    this.alternateRoom = stream.readUint16();
    this.flags = stream.readUint16();
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
          a => { return a.id == roomStaticMesh.id; });
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
  data: Uint8Array;
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

  constructor(public name: string, buf: ArrayBuffer, ctx: Context) {
    let stream = new Stream(buf);
    this.version = stream.readUint32();
    if (this.version != V1) {
      throw new Error('Version 0x' + this.version.toString(16) + ' != 0x20');
    }

    this.textiles = this.readArray32_(stream, Textile);

    stream.readUint32();  // ???

    this.rooms = this.readArray16_(stream, Room);
    this.rawFloorData = stream.readUint16Array(stream.readUint32());
    this.meshes = this.readMeshes_(stream);
    this.animations = this.readArray32_(stream, Animation);
    this.stateChanges = this.readArray32_(stream, StateChange);
    this.animDispatches = this.readArray32_(stream, AnimDispatch);
    this.animCommands = stream.readInt16Array(stream.readUint32());
    this.meshTrees = stream.readInt32Array(stream.readUint32());
    this.rawFrames = stream.readUint16Array(stream.readUint32());
    this.moveables = this.readArray32_(stream, Moveable);
    this.staticMeshes = this.readArray32_(stream, StaticMesh);
    this.objectTextures = this.readArray32_(stream, ObjectTexture);
    this.spriteTextures = this.readArray32_(stream, SpriteTexture);
    this.spriteSequences = this.readArray32_(stream, SpriteSequence);
    this.cameras = this.readArray32_(stream, SceneCamera);
    this.soundSources = this.readArray32_(stream, SoundSource);
    this.boxes = this.readArray32_(stream, Box);
    this.overlaps = stream.readUint16Array(stream.readUint32());
    this.zones = stream.readUint16Array(6 * this.boxes.length);
    this.animatedTextures = this.readAnimatedTextures_(stream);
    this.items = this.readArray32_(stream, Item.bind(null, this.rooms));

    // Skip the light map.
    stream.readUint8Array(32 * 256);

    this.palette = stream.readUint8Array(3 * 256);
    this.cinematicFrames = this.readArray16_(stream, CinematicFrame);
    this.demoData = stream.readUint8Array(stream.readUint16());
    this.soundMap = stream.readInt16Array(256);
    this.soundDetails = this.readArray32_(stream, SoundDetails);
    this.samples = stream.readUint8Array(stream.readUint32());
    this.sampleIndices = stream.readUint32Array(stream.readUint32());

    if (stream.getOfs() != stream.getLength()) {
      throw new Error('Didn\'t read all the data :(');
    }

    hacks.applyPostLoadHacks(name, this);

    this.convertPalette_();

    this.frames = this.parseAnimations_();
    this.floorData = this.parseFloorData_();

    // Set the id in each texture (useful when sorting out animated textures, and
    // packing them into an atlas).
    for (let i = 0; i < this.objectTextures.length; ++i) {
      this.objectTextures[i].id = i;
    }
    for (let i = 0; i < this.spriteTextures.length; ++i) {
      this.spriteTextures[i].id = i;
    }

    // Create texture atlas with some padding around each source texture.
    let atlas = new TextureAtlas(4096, 2048, 16);
    let rgbaTiles = this.create32bitTiles_();
    this.atlasObjectTextures = this.createAtlasObjectTextures_(rgbaTiles, atlas);
    this.atlasSpriteTextures_(rgbaTiles, atlas);
    this.flatWhiteTexture = this.createFlatWhiteTexture_(atlas);
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
    let lightMap = new TextureAtlas(512, 512, 0);
    for (let i = 0; i < this.rooms.length; ++i) {
      this.rooms[i].init(ctx, this, i, lightMap);
    }
    for (let mesh of this.meshes) {
      if (mesh != null) {
        mesh.init(ctx, this, lightMap);
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
    for (let item of this.items) {
      item.init(this);
    }
    for (let moveable of this.moveables) {
      moveable.init(this);
    }
    for (let seq of this.spriteSequences) {
      seq.init(ctx, this);
    }

    /*
    for (let roomIdx = 0; roomIdx < this.rooms.length; ++roomIdx) {
      let room = this.rooms[roomIdx];
      let basei = room.x / 1024;
      let basej = room.z / 1024;
      for (let j = basej; j < basej + room.sectorTableHeight; ++j) {
        for (let i = basei; i < basei + room.sectorTableWidth; ++i) {
          let sector = room.getSectorByGrid(i, j);
          if (sector.roomAbove != null &&
              sector.roomAbove.getSectorByGrid(i, j).portal != null) {
            throw new Error(':(');
          }
          if (sector.roomBelow != null &&
              sector.roomBelow.getSectorByGrid(i, j).portal != null) {
            throw new Error(':(');
          }
        }
      }
    }
    */

    this.createControllers();
  }

  runFloorFunc(func: FloorFunc, begin: number, triggerState: number) {
    let activationMask = func.actions[0] >> 9;
    let once = (func.actions[0] >> 8) & 1;
    for (let i = begin; i < func.actions.length; ++i) {
      let action = (func.actions[i] >> 10) & 0xf;
      let parameter = func.actions[i] & 0x3ff;
      switch (action) {
        case FloorFunc.Op.CAMERA_SWITCH:
          let parameter2 = func.actions[i++];
          break;

        case FloorFunc.Op.ITEM:
          if (parameter < this.controllers.length) {
            this.controllers[parameter].changeState(triggerState);
          } else {
            console.log(`Activate item index ${parameter} out of range`);
          }
          break;

        case FloorFunc.Op.PLAY_MUSIC:
          let mask = (func.actions[0] >> 8) & 0x3f;
          audio.playTrack(parameter, mask);
          break;

        case FloorFunc.Op.SECRET:
          if (!this.secretsFound[parameter]) {
            this.secretsFound[parameter] = true;
            audio.playSecret();
          }
          break;
      }
    }
  }

  private readMeshes_(stream: Stream) {
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

  private readAnimatedTextures_(stream: Stream) {
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

  private convertPalette_() {
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

  private parseAnimations_() {
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

  private parseFloorData_() {
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
      let data = 0;
      do {
        data = this.rawFloorData[idx++];
        let type = data & 0xff;
        let sub = (data >> 8) & 0x7f;

        if (type == FloorFunc.Type.CEILING_SLOPE) {
          decodeSlope(this.rawFloorData[idx++], parsed.ceilingSlope);
        } else if (type == FloorFunc.Type.FLOOR_SLOPE) {
          decodeSlope(this.rawFloorData[idx++], parsed.floorSlope);
        } else if (type == FloorFunc.Type.PORTAL_SECTOR) {
          let roomIdx = this.rawFloorData[idx++];
          if (roomIdx != -1) {
            parsed.portal = this.rooms[roomIdx];
          }
        } else if (type != FloorFunc.Type.NONE) {
          let func = new FloorFunc(type, sub);
          switch (type) {
            case FloorFunc.Type.KILL:
            case FloorFunc.Type.CLIMBABLE_WALL:
              // No actions.
              break;

            case FloorFunc.Type.TRIGGER:
              // TRIGGER has a sequence of actions.
              // The last one in the sequence has its top bit set.
              do {
                if (idx >= this.rawFloorData.length) {
                  throw new Error(
                      'Ran off the end of the rawFloorData array: ' + idx +
                      ' >= ' + this.rawFloorData.length);
                }
                // Strip the 'more data' bit from the opcode.
                func.actions.push(this.rawFloorData[idx] & 0x7fff);
              } while ((this.rawFloorData[idx++] & 0x8000) == 0);
              break;

            default:
              throw new Error('Unrecognized floor type: ' + type);
          }

          // Check if the sector has a bridge piece.
          if (type == FloorFunc.Type.TRIGGER &&
              sub == TriggerType.TRIGGER_ON) {
            for (let i = 1; i < func.actions.length; ++i) {
              let opcode = func.actions[i];
              let op = (opcode >> 10) & 0xf;
              let operand = opcode & 0x3ff;
              if (op == FloorFunc.Op.ITEM &&
                  operand < this.items.length &&
                  this.items[operand].isBridge()) {
                parsed.bridge = this.items[operand];
              }
            }
          }
          parsed.funcs.push(func);
        }
      } while ((data & 0x8000) == 0);
      parsedFloorData.push(parsed);
    }

    if (idx > this.rawFloorData.length) {
      throw new Error(`
          'Ran off the end of the rawFloorData array: ${idx} > ${this.rawFloorData.length}`);
    }

    // Remap indices into the raw data to the parsed array.
    for (let roomIdx = 0; roomIdx < this.rooms.length; ++roomIdx) {
      let room = this.rooms[roomIdx];
      for (let i = 0; i < room.sectorTable.length; ++i) {
        let sector = room.sectorTable[i];
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
  private create32bitTiles_() {
    /*
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
    */

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
      /*
      pushTex(256, 256, dst);
      */
    }

    return rgbaTiles;
  }

  private createAtlasObjectTextures_(rgbaTiles: Uint8Array[], atlas: TextureAtlas) {
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
    let dedupMap: Rect[][] = [];
    for (let i = 0; i < rgbaTiles.length; ++i) { dedupMap.push([]); }

    for (let srcIdx = 0; srcIdx < this.objectTextures.length; ++srcIdx) {
      let srcTex = this.objectTextures[srcIdx];
      let dstTex = new AtlasObjectTexture(
          srcTex.id, srcTex.attributes, srcTex.numUvs);

      let tile = rgbaTiles[srcTex.tile];
      let uvBounds = srcTex.uvBounds;

      let uvKey = uvBounds.left | (uvBounds.top << 8) |
                  (uvBounds.width << 16) | (uvBounds.height << 24);
      let atlasBounds = dedupMap[srcTex.tile][uvKey];
      if (!atlasBounds) {
        let data = this.copyTexture(uvBounds, tile);
        atlasBounds = new Rect(0, 0, 0, 0);
        atlas.add(uvBounds.width, uvBounds.height, data, atlasBounds);
        dedupMap[srcTex.tile][uvKey] = atlasBounds;
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
  private atlasSpriteTextures_(rgbaTiles: Uint8Array[], atlas: TextureAtlas) {
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

  private createFlatWhiteTexture_(atlas: TextureAtlas) {
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

  private readArray16_<T>(stream: Stream, ctor: {new(stream: Stream): T}): T[] {
    return this.readArray_(stream, ctor, stream.readUint16());
  }

  private readArray32_<T>(stream: Stream, ctor: {new(stream: Stream): T}): T[] {
    return this.readArray_(stream, ctor, stream.readUint32());
  }

  private readArray_<T>(stream: Stream, ctor: {new(stream: Stream): T}, num: number): T[] {
    let array = new Array(num);
    for (let i = 0; i < num; ++i) {
      array[i] = new ctor(stream);
    }
    return array;
  }

  private createControllers() {
    this.controllers = [];
    for (let item of this.items) {
      if (item.animState == null) {
        this.controllers.push(null);
        continue;
      }

      item.animState.anim.getFrame(
          item.animState.frameIdx, item.animState.frameOfs, item.animState.frame);
      item.animState.setMeshTransforms(
          item.moveable.meshCount, item.moveable.meshTree, this.meshTrees);
      switch (item.type) {
        case ItemType.LARA:
          this.lara = new Lara(item, this);
          this.controllers.push(this.lara);
          break;
  
        case ItemType.BLOCK_1:
        case ItemType.BLOCK_2:
          this.controllers.push(new Block(item, this));
          break;

        case ItemType.SWITCH:
        case ItemType.UNDERWATER_SWITCH:
          this.controllers.push(new Switch(item, this));
          break;

        default:
          // TODO(tom): do we really need to create a controller for every
          // single item? That's a lot of items with update methods that don't
          // do anything.
          this.controllers.push(new Controller(item, this));
          break;
      }
    }

    if (this.lara == null) {
      throw 'Couldn\'t find Lara :(';
    }
  }
}
