import {Item} from 'scene';

export const ACTIVE = 0x1f;

export class Component {
  constructor(public item: Item) {}
  update(dt: number) {}
  activate() {}
  deactivate() {}
}

// TODO(tom): rename to Entity.Type
export enum EntityType {
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
  TEETH_SPIKES = 37,
  ROLLING_BALL = 38,
  DART = 39,
  DART_GUN = 40,
  LIFTING_DOOR = 41,
  SLAMMING_DOORS = 42,
  SWORD_OF_DAMOCLES = 43,
  THOR_HAMMER_HANDLE = 44,
  THOR_HAMMER_BLOCK = 45,
  THOR_LIGHTNING = 46,
  BARRICADE = 47,
  BLOCK_1 = 48,
  BLOCK_2 = 49,
  BLOCK_3 = 50,
  BLOCK_4 = 51,
  MOVING_BLOCK = 52,
  FALLING_CEILING = 53,
  UNUSED_SWORD_OF_DAMACLES = 54,
  SWITCH = 55,
  UNDERWATER_SWITCH = 56,
  DOOR_1 = 57,
  DOOR_2 = 58,
  DOOR_3 = 59,
  DOOR_4 = 60,
  DOOR_5 = 61,
  DOOR_6 = 62,
  DOOR_7 = 63,
  DOOR_8 = 64,
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
