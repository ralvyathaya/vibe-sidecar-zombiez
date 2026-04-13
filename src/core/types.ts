import type { Group, MeshStandardMaterial, Object3D, Vector3 } from 'three';

export type GameStateType = 'menu' | 'running' | 'paused' | 'dead';

export type ZombieType = 'walker' | 'runner' | 'tank';

export type Vec3Tuple = [number, number, number];

export interface ZombieConfig {
  type: ZombieType;
  speed: number;
  maxHealth: number;
  contactDamage: number;
  scoreValue: number;
  scale: number;
  bodyColor: number;
  accentColor: number;
  spawnWeight: number;
}

export interface GameConfig {
  renderer: {
    clearColor: number;
    fogColor: number;
    fogNear: number;
    fogFar: number;
  };
  player: {
    maxHealth: number;
    eyeHeight: number;
    forwardSpeed: number;
    strafeSpeed: number;
    roadHalfWidth: number;
    collisionRadius: number;
    mouseSensitivity: number;
    maxYaw: number;
    minPitch: number;
    maxPitch: number;
    bobAmplitude: number;
    bobFrequency: number;
  };
  weapon: {
    fireRate: number;
    magazineSize: number;
    reloadDuration: number;
    range: number;
    damagePerShot: number;
    cameraKick: number;
    recoilRecovery: number;
    viewmodel: {
      assetPath: string;
      position: Vec3Tuple;
      rotationDegrees: Vec3Tuple;
      scale: number;
      recoilBack: number;
      recoilLift: number;
      recoilPitchDegrees: number;
      recoilRollDegrees: number;
      recoilRecovery: number;
      slideTravel: number;
      slideRecovery: number;
      magazineDrop: number;
      magazineTiltDegrees: number;
      reloadLift: number;
      reloadTiltDegrees: number;
      muzzleFlashSize: number;
      muzzleFlashDuration: number;
    };
  };
  enemies: {
    poolSize: number;
    spawnMinZ: number;
    spawnMaxZ: number;
    cleanupZ: number;
    contactRadius: number;
    types: Record<ZombieType, ZombieConfig>;
  };
  spawn: {
    rampDuration: number;
    intervalStart: number;
    intervalEnd: number;
    batchChance: number;
  };
  world: {
    roadWidth: number;
    roadHalfWidth: number;
    laneCenters: number[];
    chunkLength: number;
    chunkCount: number;
    obstaclePoolSize: number;
    obstacleSpacingMin: number;
    obstacleSpacingMax: number;
    obstacleCleanupZ: number;
    obstacleDamage: number;
    obstacleHitboxDepth: number;
  };
}

export interface PlayerState {
  health: number;
  maxHealth: number;
  strafeX: number;
  distance: number;
  score: number;
  ammoInMagazine: number;
  ammoReserve: number;
  reloading: boolean;
  alive: boolean;
  hitFlash: number;
}

export interface WeaponStatus {
  ammoInMagazine: number;
  magazineSize: number;
  reloading: boolean;
  reloadProgress: number;
  reserveAmmoText: string;
  hitConfirm: number;
  canReload: boolean;
}

export interface ActiveZombie {
  id: number;
  group: Group;
  active: boolean;
  type: ZombieType;
  config: ZombieConfig;
  health: number;
  velocity: Vector3;
  poolId: number;
  bodyMaterial: MeshStandardMaterial;
  accentMaterial: MeshStandardMaterial;
  leftArmPivot: Object3D;
  rightArmPivot: Object3D;
  leftLegPivot: Object3D;
  rightLegPivot: Object3D;
  animationClock: number;
  animationOffset: number;
  hitFlash: number;
}

export interface ActiveObstacle {
  id: number;
  mesh: Group;
  active: boolean;
  lane: number;
  width: number;
  depth: number;
  damage: number;
  hasHitPlayer: boolean;
  poolId: number;
  type: 'barrier' | 'wreck';
}
