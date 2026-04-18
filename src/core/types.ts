import type {
  AnimationAction,
  AnimationMixer,
  Group,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';

export type GameStateType = 'menu' | 'running' | 'paused' | 'dead';

export type ZombieType = 'walker' | 'runner' | 'tank';
export type HumanoidZombieType = 'walker' | 'runner' | 'tank';
export type ZombieLifecycleState = 'inactive' | 'alive' | 'dying';
export type WeaponKind = 'pistol' | 'shotgun' | 'bazooka';
export type AmmoRoundStyle = 'bullet' | 'shell' | 'rocket';
export type PickupType = 'shotgun' | 'shotgunAmmo' | 'bazooka';
export type CrosshairStyle = 'pistol' | 'shotgun' | 'bazooka';

export type Vec3Tuple = [number, number, number];

export interface FlashMaterial {
  emissive: {
    setHex(hex: number): unknown;
  };
  emissiveIntensity: number;
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
}

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

export interface HumanoidEnemyModelConfig {
  characterPath: string;
  textureMaterialPath?: string;
  moveAnimationPath: string;
  deathAnimationPath: string;
  spawnPoseAnimationPath?: string;
  spawnPoseChance?: number;
  spawnPoseDuration?: number;
  spawnPoseSpeed?: number;
  spawnPoseMoveSpeedMultiplier?: number;
  position: Vec3Tuple;
  rotationDegrees: Vec3Tuple;
  scale: number;
  moveAnimationSpeed: number;
  deathAnimationSpeed: number;
  fadeDelay: number;
  fadeDuration: number;
  fadeSink: number;
  hitBloodCount: number;
  hitBloodSize: number;
  hitBloodSpeed: number;
  hitBloodLifetime: number;
  bodySplatterCount: number;
  bodySplatterSize: number;
  bodySplatterSpeed: number;
  bodySplatterLifetime: number;
  bloodDelay: number;
  bloodBurstCount: number;
  bloodBurstSize: number;
  bloodBurstSpeed: number;
  bloodBurstLifetime: number;
  bloodGravity: number;
  roadSplatSize: number;
  roadSplatLifetime: number;
  roadSplatOpacity: number;
}

export interface StaticObstacleModelConfig {
  assetPath: string;
  fallbackAssetPath?: string;
  scale: number;
  yOffset: number;
  tintColor: number;
  width: number;
  depth: number;
  collisionDamage: number;
  spawnWeight: number;
}

export interface ZombieModelVariant {
  type: HumanoidZombieType;
  root: Group;
  flashMaterials: FlashMaterial[];
  mixer: AnimationMixer;
  moveAction: AnimationAction;
  deathAction: AnimationAction;
  spawnPoseAction: AnimationAction | null;
}

export interface GameConfig {
  debug: {
    developmentWeapons: boolean;
  };
  renderer: {
    clearColor: number;
    fogColor: number;
    fogNear: number;
    fogFar: number;
    exposure: number;
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
  vehicle: {
    engineAudioPath: string;
    engineVolume: number;
    enginePlaybackRate: number;
    engineHighpassHz: number;
    engineLowpassHz: number;
    turnVolume: number;
    turnPlaybackRate: number;
    turnLowpassHz: number;
    turnEnterSmoothing: number;
    turnReleaseSmoothing: number;
    stage1Rig: {
      position: Vec3Tuple;
      assetPath: string;
      fallbackAssetPath: string;
      modelPosition: Vec3Tuple;
      modelRotationDegrees: Vec3Tuple;
      modelScale: number;
      seatPivotPosition: Vec3Tuple;
      cameraOffset: Vec3Tuple;
      lookDownReveal: Vec3Tuple;
      swayAmplitude: Vec3Tuple;
      swayFrequency: number;
      vibrationAmplitude: number;
      vibrationFrequency: number;
      turnShift: number;
      turnRollDegrees: number;
      damageShakeAmplitude: number;
      damageShakeDecay: number;
    };
  };
  weapon: {
    fireRate: number;
    magazineSize: number;
    reloadDuration: number;
    range: number;
    damagePerShot: number;
    cameraKick: number;
    recoilRecovery: number;
    tracer: {
      duration: number;
      width: number;
      glowWidth: number;
      color: number;
      glowColor: number;
      opacity: number;
      missLength: number;
    };
    audio: {
      gunshotPath: string;
      emptyPath: string;
      reloadPath: string;
      gunshotVolume: number;
      emptyVolume: number;
      reloadVolume: number;
    };
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
      reloadSideShift: number;
      reloadLift: number;
      reloadPushBack: number;
      reloadTiltDegrees: number;
      muzzleOffset: Vec3Tuple;
      muzzleFlashSize: number;
      muzzleFlashDuration: number;
    };
  };
  shotgun: {
    fireRate: number;
    maxAmmo: number;
    range: number;
    pelletsPerShot: number;
    damagePerPellet: number;
    spread: number;
    spreadKick: number;
    cameraKick: number;
    pelletVisualCount: number;
    pelletTraceMinLength: number;
    pelletTraceMaxLength: number;
    pelletTraceDuration: number;
    /** World units along trace direction from muzzle; larger pushes streaks away from the camera. */
    pelletTraceMuzzleForward: number;
    audio: {
      gunshotPath: string;
      delayPath: string;
      gunshotVolume: number;
      delayVolume: number;
    };
    viewmodel: {
      assetPath: string;
      muzzleFlashSpritePath: string;
      position: Vec3Tuple;
      rotationDegrees: Vec3Tuple;
      scale: number;
      recoilBack: number;
      recoilLift: number;
      recoilPitchDegrees: number;
      recoilRollDegrees: number;
      recoilRecovery: number;
      pumpTravel: number;
      pumpRecovery: number;
      pumpDelay: number;
      spinDuration: number;
      spinTurns: number;
      muzzleOffset: Vec3Tuple;
      muzzleFlashSize: number;
      muzzleFlashDuration: number;
    };
  };
  bazooka: {
    maxAmmo: number;
    rocketSpeed: number;
    rocketRadius: number;
    maxDistance: number;
    explosionRadius: number;
    tankDamage: number;
    smokeSpawnInterval: number;
    smokeLifetime: number;
    smokeStartSize: number;
    smokeEndSize: number;
    smokeDrift: number;
    cameraKick: number;
    audio: {
      launchPath: string;
      impactPath: string;
      launchVolume: number;
      impactVolume: number;
      launchPlaybackRate: number;
    };
    viewmodel: {
      assetPath: string;
      fallbackAssetPath: string;
      position: Vec3Tuple;
      rotationDegrees: Vec3Tuple;
      scale: number;
      recoilBack: number;
      recoilLift: number;
      recoilPitchDegrees: number;
      recoilRecovery: number;
      muzzleOffset: Vec3Tuple;
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
    audio: {
      normalDeathPath: string;
      tankDeathPath: string;
      approachPath: string;
      normalDeathVolume: number;
      tankDeathVolume: number;
      approachVolume: number;
      approachDistance: number;
      approachCooldown: number;
    };
    walkerModel: HumanoidEnemyModelConfig;
    runnerModel: HumanoidEnemyModelConfig;
    tankModel: HumanoidEnemyModelConfig;
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
    wreckSpawnWeight: number;
    obstacleHitboxDepth: number;
    roadSurfaceY: number;
    barricade: StaticObstacleModelConfig;
    concreteBlock: StaticObstacleModelConfig;
    car: {
      assetPath: string;
      fallbackAssetPath: string;
      scale: number;
      yOffset: number;
      width: number;
      depth: number;
      collisionDamage: number;
      spawnChance: number;
      spawnSpacingMin: number;
      spawnSpacingMax: number;
    };
    barrel: {
      assetPath: string;
      scale: number;
      tintColor: number;
      spawnChance: number;
      spawnSpacingMin: number;
      spawnSpacingMax: number;
      collisionDamage: number;
      explosionRadius: number;
      tankDamage: number;
      flashDuration: number;
      flashSize: number;
    };
    audio: {
      obstacleImpactPath: string;
      obstacleImpactVolume: number;
      barrelExplosionPath: string;
      barrelExplosionVolume: number;
    };
    breakEffect: {
      pieceCount: number;
      dustCount: number;
      lifetime: number;
      gravity: number;
      horizontalSpeed: number;
      upwardSpeed: number;
      pieceSize: number;
      dustSize: number;
    };
  };
  pickups: {
    unlockTimeSeconds: number;
    bazookaUnlockTimeSeconds: number;
    poolSize: number;
    spawnMinZ: number;
    spawnMaxZ: number;
    cleanupZ: number;
    hitboxDepth: number;
    shotgunPickupAmmo: number;
    shotgunPickupSpacingMin: number;
    shotgunPickupSpacingMax: number;
    ammoCrateSpacingMin: number;
    ammoCrateSpacingMax: number;
    ammoCrateChance: number;
    ammoCrateMin: number;
    ammoCrateMax: number;
    bazookaSpawnChance: number;
    bazookaPickupSpacingMin: number;
    bazookaPickupSpacingMax: number;
    shotgunPickupScale: number;
    ammoCrateScale: number;
    bazookaPickupScale: number;
  };
  rewards: {
    chainDuration: number;
    calloutDuration: number;
    chainLostCalloutDuration: number;
    doubleKillWindow: number;
    tripleKillWindow: number;
    milestoneTimes: number[];
    milestoneValues: number[];
    repeatingMilestoneEvery: number;
    repeatingMilestoneValue: number;
    explosiveBonusPerExtraKill: number;
    dangerKillDistance: number;
    dangerKillBonus: number;
    tankDangerKillBonus: number;
    multiplierThresholds: Array<{
      kills: number;
      multiplier: number;
    }>;
    bonuses: {
      doubleKill: number;
      tripleKill: number;
      multiKill: number;
    };
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
  weaponType: WeaponKind;
  weaponLabel: string;
  ammoInMagazine: number;
  magazineSize: number;
  reloading: boolean;
  reloadProgress: number;
  reserveAmmoText: string;
  showReserve: boolean;
  showReloadHint: boolean;
  roundStyle: AmmoRoundStyle;
  hitConfirm: number;
  crosshairStyle: CrosshairStyle;
  crosshairGap: number;
  crosshairKick: number;
  canReload: boolean;
}

export interface EnemyKillResult {
  baseScore: number;
  zombieType: ZombieType;
  position: Vector3;
}

export interface RewardEvent {
  baseScore: number;
  weaponType: WeaponKind;
  zombieType: ZombieType;
  killCount: number;
  wasExplosive: boolean;
  distanceToPlayer: number;
}

export interface RewardState {
  chainCount: number;
  chainTimer: number;
  chainTimerRatio: number;
  multiplier: number;
  bestChain: number;
  comboBonusTotal: number;
  milestoneBonusTotal: number;
  explosiveBonusTotal: number;
  recentCallout: string;
  recentCalloutTimer: number;
  bestScore: number;
  bestChainRecord: number;
  lastRunScore: number;
}

export interface RadarContact {
  id: number;
  offset: number;
  proximity: number;
  type: ZombieType;
}

export interface ActiveZombie {
  id: number;
  group: Group;
  active: boolean;
  state: ZombieLifecycleState;
  type: ZombieType;
  config: ZombieConfig;
  health: number;
  velocity: Vector3;
  poolId: number;
  primitiveRoot: Group;
  bodyMaterial: MeshStandardMaterial;
  accentMaterial: MeshStandardMaterial;
  leftArmPivot: Object3D;
  rightArmPivot: Object3D;
  leftLegPivot: Object3D;
  rightLegPivot: Object3D;
  animationClock: number;
  animationOffset: number;
  hitFlash: number;
  deathTimer: number;
  deathElapsed: number;
  spawnPoseTimer: number;
  spawnPoseActive: boolean;
  approachCueTriggered: boolean;
  impactLocalPoint: Vector3;
  bodySplatterTriggered: boolean;
  bloodBurstTriggered: boolean;
  primitiveFlashMaterials: FlashMaterial[];
  flashMaterials: FlashMaterial[];
  activeModelType: HumanoidZombieType | null;
  modelVariants: Partial<Record<HumanoidZombieType, ZombieModelVariant>>;
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
  type: 'barricade' | 'concreteBlock' | 'wreck' | 'barrel' | 'car';
}

export interface ActivePickup {
  id: number;
  mesh: Group;
  active: boolean;
  kind: PickupType;
  lane: number;
  width: number;
  depth: number;
  ammo: number;
  bobOffset: number;
  spinSpeed: number;
}

export interface PickupEvent {
  type: PickupType;
  ammo: number;
}
