import {
  AnimationClip,
  AnimationMixer,
  CircleGeometry,
  MeshBasicMaterial,
  BoxGeometry,
  Camera,
  Group,
  LoopOnce,
  LoopRepeat,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from 'three';
import type {
  ActiveZombie,
  FlashMaterial,
  GameConfig,
  ZombieType,
} from '../../core/types';
import { randomRange } from '../../core/utils';

const TORSO_GEOMETRY = new BoxGeometry(0.8, 1.05, 0.5);
const HEAD_GEOMETRY = new BoxGeometry(0.54, 0.52, 0.48);
const ARM_GEOMETRY = new BoxGeometry(0.18, 0.76, 0.18);
const LEG_GEOMETRY = new BoxGeometry(0.22, 0.9, 0.22);
const PARTICLE_SHARD_GEOMETRY = new BoxGeometry(0.12, 0.12, 0.12);
const ROAD_SPLAT_GEOMETRY = new CircleGeometry(1, 10);
const HIT_FLASH_COLOR = 0x5a1405;

type WalkerAssets = {
  template: Group;
  walkClip: AnimationClip;
  deathClip: AnimationClip;
};

type CloneSkinnedScene = (source: Object3D) => Object3D;

type ParticleShard = {
  mesh: Mesh;
  velocity: Vector3;
  angularVelocity: Vector3;
  baseScale: Vector3;
};

type ParticleBurst = {
  group: Group;
  material: MeshBasicMaterial;
  shards: ParticleShard[];
  active: boolean;
  life: number;
  maxLife: number;
  gravity: number;
  stickToRoad: boolean;
};

type RoadSplat = {
  group: Group;
  material: MeshBasicMaterial;
  blotches: Mesh[];
  active: boolean;
  life: number;
  maxLife: number;
};

export class EnemySystem {
  private readonly pool: ActiveZombie[] = [];
  private readonly hitBloodBursts: ParticleBurst[] = [];
  private readonly bodySplatterBursts: ParticleBurst[] = [];
  private readonly bloodBursts: ParticleBurst[] = [];
  private readonly roadSplats: RoadSplat[] = [];
  private readonly raycaster = new Raycaster();
  private readonly chaseVector = new Vector3();
  private readonly effectPosition = new Vector3();
  private readonly effectDirection = new Vector3();
  private readonly effectTangent = new Vector3();
  private readonly effectBitangent = new Vector3();
  private readonly effectLookTarget = new Vector3();

  private walkerAssets: WalkerAssets | null = null;
  private walkerAssetsPromise: Promise<void> | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly config: GameConfig,
  ) {
    for (let index = 0; index < this.config.enemies.poolSize; index += 1) {
      const zombie = this.createZombie(index);
      this.pool.push(zombie);
      this.scene.add(zombie.group);
    }

    for (let index = 0; index < 16; index += 1) {
      const burst = this.createParticleBurst();
      this.hitBloodBursts.push(burst);
      this.scene.add(burst.group);
    }

    for (let index = 0; index < 16; index += 1) {
      const splatter = this.createParticleBurst();
      this.bodySplatterBursts.push(splatter);
      this.scene.add(splatter.group);
    }

    for (let index = 0; index < 16; index += 1) {
      const bloodBurst = this.createParticleBurst();
      this.bloodBursts.push(bloodBurst);
      this.scene.add(bloodBurst.group);
    }

    for (let index = 0; index < 56; index += 1) {
      const roadSplat = this.createRoadSplat();
      this.roadSplats.push(roadSplat);
      this.scene.add(roadSplat.group);
    }

    void this.loadWalkerAssets();
  }

  reset(): void {
    for (const zombie of this.pool) {
      this.deactivate(zombie);
    }

    for (const burst of this.bodySplatterBursts) {
      this.deactivateParticleBurst(burst);
    }

    for (const burst of this.hitBloodBursts) {
      this.deactivateParticleBurst(burst);
    }

    for (const burst of this.bloodBursts) {
      this.deactivateParticleBurst(burst);
    }

    for (const splat of this.roadSplats) {
      this.deactivateRoadSplat(splat);
    }
  }

  spawn(type: ZombieType, laneX: number, zPosition: number): boolean {
    const zombie = this.pool.find((entry) => !entry.active);
    if (!zombie) {
      return false;
    }

    const zombieConfig = this.config.enemies.types[type];
    zombie.active = true;
    zombie.state = 'alive';
    zombie.type = type;
    zombie.config = zombieConfig;
    zombie.health = zombieConfig.maxHealth;
    zombie.velocity.set(0, 0, 0);
    if (zombie.group.parent !== this.scene) {
      this.scene.add(zombie.group);
    }
    zombie.group.visible = true;
    zombie.group.position.set(laneX + randomRange(-0.55, 0.55), 0, zPosition);
    zombie.group.scale.setScalar(zombieConfig.scale);
    zombie.animationClock = 0;
    zombie.animationOffset = randomRange(0, Math.PI * 2);
    zombie.hitFlash = 0;
    zombie.deathTimer = 0;
    zombie.deathElapsed = 0;
    zombie.impactLocalPoint.set(0, 1.15, 0.32);
    zombie.bodySplatterTriggered = false;
    zombie.bloodBurstTriggered = false;

    this.resetFlashMaterials(zombie.primitiveFlashMaterials);
    this.resetFlashMaterials(zombie.modelFlashMaterials);

    if (type === 'walker') {
      this.enableWalkerVisual(zombie);
    } else {
      this.enablePrimitiveVisual(zombie);
    }

    return true;
  }

  update(
    deltaTime: number,
    playerPosition: Vector3,
    worldScrollSpeed: number,
    onPlayerHit: (damage: number, sourceX: number) => void,
  ): void {
    this.updateParticleBursts(this.hitBloodBursts, deltaTime, worldScrollSpeed);
    this.updateParticleBursts(this.bodySplatterBursts, deltaTime, worldScrollSpeed);
    this.updateParticleBursts(this.bloodBursts, deltaTime, worldScrollSpeed);
    this.updateRoadSplats(deltaTime, worldScrollSpeed);

    for (const zombie of this.pool) {
      if (!zombie.active) {
        continue;
      }

      zombie.group.position.z += worldScrollSpeed * deltaTime;

      if (zombie.state === 'alive') {
        this.updateAliveZombie(
          zombie,
          deltaTime,
          playerPosition,
          onPlayerHit,
        );
        if (!zombie.active) {
          continue;
        }
      } else if (zombie.state === 'dying') {
        zombie.deathElapsed += deltaTime;
        zombie.deathTimer -= deltaTime;
        this.triggerDelayedDeathEffects(zombie);
        this.updateWalkerDeathFade(zombie);
      }

      if (zombie.mixer) {
        zombie.mixer.update(deltaTime);
      } else if (zombie.primitiveRoot.visible) {
        zombie.animationClock += deltaTime * (4 + zombie.config.speed);
        this.animatePrimitiveZombie(zombie);
      }

      this.updateHitFlash(zombie, deltaTime);

      if (zombie.state === 'dying' && zombie.deathTimer <= 0) {
        this.deactivate(zombie);
        continue;
      }

      if (zombie.group.position.z > this.config.enemies.cleanupZ) {
        this.deactivate(zombie);
      }
    }
  }

  raycast(
    camera: Camera,
    crosshair: Vector2,
    range: number,
  ): { zombie: ActiveZombie; point: Vector3 } | null {
    this.raycaster.setFromCamera(crosshair, camera);
    this.raycaster.near = 0;
    this.raycaster.far = range;

    const activeRoots = this.pool
      .filter((entry) => entry.active && entry.state === 'alive')
      .map((entry) => entry.group);

    if (activeRoots.length === 0) {
      return null;
    }

    const hits = this.raycaster.intersectObjects(activeRoots, true);
    for (const hit of hits) {
      const poolId = hit.object.userData.poolId as number | undefined;
      if (poolId === undefined) {
        continue;
      }

      const zombie = this.pool[poolId];
      if (zombie?.active && zombie.state === 'alive') {
        return {
          zombie,
          point: hit.point.clone(),
        };
      }
    }

    return null;
  }

  damage(zombie: ActiveZombie, amount: number, impactPoint?: Vector3): number {
    if (!zombie.active || zombie.state !== 'alive') {
      return 0;
    }

    this.captureImpactPoint(zombie, impactPoint);
    zombie.health -= amount;
    zombie.hitFlash = 1;
    this.setFlashColor(zombie.flashMaterials, HIT_FLASH_COLOR);
    this.spawnHitBloodBurst(zombie);

    if (zombie.health <= 0) {
      const scoreValue = zombie.config.scoreValue;

      if (zombie.type === 'walker' && zombie.walkerRoot) {
        this.startWalkerDeath(zombie);
      } else {
        this.deactivate(zombie);
      }

      return scoreValue;
    }

    return 0;
  }

  getActiveCount(): number {
    return this.pool.reduce((count, zombie) => count + (zombie.active ? 1 : 0), 0);
  }

  private createZombie(poolId: number): ActiveZombie {
    const group = new Group();
    const primitiveRoot = new Group();
    const rootMaterial = new MeshStandardMaterial({
      color: 0x7ea55a,
      flatShading: true,
      roughness: 0.95,
    });
    const accentMaterial = new MeshStandardMaterial({
      color: 0x2d352f,
      flatShading: true,
      roughness: 0.95,
    });

    const torso = new Mesh(TORSO_GEOMETRY, rootMaterial);
    torso.position.y = 1.45;
    primitiveRoot.add(torso);

    const head = new Mesh(HEAD_GEOMETRY, rootMaterial);
    head.position.y = 2.28;
    primitiveRoot.add(head);

    const leftArmPivot = this.createLimbPivot(-0.52, 1.86, -0.05, rootMaterial, ARM_GEOMETRY);
    const rightArmPivot = this.createLimbPivot(0.52, 1.86, -0.05, rootMaterial, ARM_GEOMETRY);
    const leftLegPivot = this.createLimbPivot(-0.22, 0.92, 0, accentMaterial, LEG_GEOMETRY);
    const rightLegPivot = this.createLimbPivot(0.22, 0.92, 0, accentMaterial, LEG_GEOMETRY);

    primitiveRoot.add(leftArmPivot, rightArmPivot, leftLegPivot, rightLegPivot);
    group.add(primitiveRoot);
    group.visible = false;
    group.position.z = 999;

    this.assignPoolId(group, poolId);

    return {
      id: poolId,
      poolId,
      group,
      primitiveRoot,
      active: false,
      state: 'inactive',
      type: 'walker',
      config: this.config.enemies.types.walker,
      health: 1,
      velocity: new Vector3(),
      bodyMaterial: rootMaterial,
      accentMaterial,
      leftArmPivot,
      rightArmPivot,
      leftLegPivot,
      rightLegPivot,
      animationClock: 0,
      animationOffset: 0,
      hitFlash: 0,
      deathTimer: 0,
      deathElapsed: 0,
      impactLocalPoint: new Vector3(0, 1.15, 0.32),
      bodySplatterTriggered: false,
      bloodBurstTriggered: false,
      primitiveFlashMaterials: [rootMaterial, accentMaterial],
      modelFlashMaterials: [],
      flashMaterials: [rootMaterial, accentMaterial],
      walkerRoot: null,
      mixer: null,
      walkAction: null,
      deathAction: null,
    };
  }

  private updateAliveZombie(
    zombie: ActiveZombie,
    deltaTime: number,
    playerPosition: Vector3,
    onPlayerHit: (damage: number, sourceX: number) => void,
  ): void {
    this.chaseVector
      .subVectors(playerPosition, zombie.group.position)
      .setY(0);

    const distanceToPlayer = this.chaseVector.length();
    if (distanceToPlayer > 0.001) {
      this.chaseVector.multiplyScalar(1 / distanceToPlayer);
    }

    zombie.velocity.copy(this.chaseVector).multiplyScalar(zombie.config.speed);
    zombie.group.position.addScaledVector(zombie.velocity, deltaTime);
    zombie.group.lookAt(playerPosition.x, zombie.group.position.y + 1, playerPosition.z);
    zombie.group.rotation.x = 0;
    zombie.group.rotation.z = 0;

    if (distanceToPlayer < this.config.enemies.contactRadius * zombie.config.scale) {
      onPlayerHit(zombie.config.contactDamage, zombie.group.position.x);
      this.deactivate(zombie);
    }
  }

  private enablePrimitiveVisual(zombie: ActiveZombie): void {
    zombie.primitiveRoot.visible = true;
    zombie.bodyMaterial.color.setHex(zombie.config.bodyColor);
    zombie.accentMaterial.color.setHex(zombie.config.accentColor);
    zombie.flashMaterials = zombie.primitiveFlashMaterials;

    if (zombie.walkerRoot) {
      zombie.walkerRoot.visible = false;
    }

    this.stopWalkerActions(zombie);
  }

  private enableWalkerVisual(zombie: ActiveZombie): void {
    if (!zombie.walkerRoot || !zombie.walkAction) {
      this.enablePrimitiveVisual(zombie);
      return;
    }

    zombie.primitiveRoot.visible = false;
    zombie.walkerRoot.visible = true;
    zombie.flashMaterials = zombie.modelFlashMaterials;
    this.resetFlashMaterials(zombie.modelFlashMaterials);
    this.setMaterialOpacity(zombie.modelFlashMaterials, 1);
    zombie.walkerRoot.position.set(...this.config.enemies.walkerModel.position);

    if (zombie.deathAction) {
      zombie.deathAction.stop();
      zombie.deathAction.reset();
    }

    zombie.walkAction.enabled = true;
    zombie.walkAction.reset();
    zombie.walkAction.time =
      zombie.animationOffset % Math.max(zombie.walkAction.getClip().duration, 0.001);
    zombie.walkAction
      .setLoop(LoopRepeat, Infinity)
      .setEffectiveTimeScale(this.config.enemies.walkerModel.walkAnimationSpeed)
      .setEffectiveWeight(1)
      .play();
  }

  private startWalkerDeath(zombie: ActiveZombie): void {
    zombie.state = 'dying';
    zombie.velocity.set(0, 0, 0);
    zombie.deathElapsed = 0;
    zombie.bodySplatterTriggered = true;
    zombie.bloodBurstTriggered = false;
    zombie.deathTimer =
      this.config.enemies.walkerModel.fadeDelay +
      this.config.enemies.walkerModel.fadeDuration;
    this.spawnBodySplatter(zombie);
    if (this.config.enemies.walkerModel.bloodDelay <= 0) {
      zombie.bloodBurstTriggered = true;
      this.spawnBloodBurst(zombie);
    }

    if (!zombie.deathAction) {
      return;
    }

    if (zombie.walkAction) {
      zombie.walkAction.fadeOut(0.08);
    }

    zombie.deathAction.enabled = true;
    zombie.deathAction.reset();
    zombie.deathAction.time = 0;
    zombie.deathAction
      .setLoop(LoopOnce, 1)
      .setEffectiveTimeScale(this.config.enemies.walkerModel.deathAnimationSpeed)
      .setEffectiveWeight(1)
      .play();
    zombie.deathAction.clampWhenFinished = true;
  }

  private triggerDelayedDeathEffects(zombie: ActiveZombie): void {
    if (
      zombie.type === 'walker' &&
      !zombie.bloodBurstTriggered &&
      zombie.deathElapsed >= this.config.enemies.walkerModel.bloodDelay
    ) {
      zombie.bloodBurstTriggered = true;
      this.spawnBloodBurst(zombie);
    }
  }

  private createLimbPivot(
    x: number,
    y: number,
    z: number,
    material: MeshStandardMaterial,
    geometry: BoxGeometry,
  ): Object3D {
    const pivot = new Group();
    pivot.position.set(x, y, z);

    const limb = new Mesh(geometry, material);
    limb.position.y = -geometry.parameters.height * 0.5;
    pivot.add(limb);
    return pivot;
  }

  private animatePrimitiveZombie(zombie: ActiveZombie): void {
    const stride = Math.sin(zombie.animationClock + zombie.animationOffset) * 0.7;
    zombie.leftArmPivot.rotation.x = stride;
    zombie.rightArmPivot.rotation.x = -stride;
    zombie.leftLegPivot.rotation.x = -stride;
    zombie.rightLegPivot.rotation.x = stride;
  }

  private updateHitFlash(zombie: ActiveZombie, deltaTime: number): void {
    zombie.hitFlash = Math.max(0, zombie.hitFlash - deltaTime * 6);
    const emissiveStrength = zombie.hitFlash * (zombie.walkerRoot?.visible ? 0.85 : 0.55);

    for (const material of zombie.flashMaterials) {
      material.emissiveIntensity = emissiveStrength;
    }
  }

  private resetFlashMaterials(materials: FlashMaterial[]): void {
    this.setFlashColor(materials, 0x000000);
    this.setMaterialOpacity(materials, 1);
    for (const material of materials) {
      material.emissiveIntensity = 0;
    }
  }

  private setFlashColor(materials: FlashMaterial[], color: number): void {
    for (const material of materials) {
      material.emissive.setHex(color);
    }
  }

  private stopWalkerActions(zombie: ActiveZombie): void {
    zombie.mixer?.stopAllAction();
    zombie.walkAction?.reset();
    zombie.deathAction?.reset();
  }

  private deactivate(zombie: ActiveZombie): void {
    zombie.active = false;
    zombie.state = 'inactive';
    zombie.group.visible = false;
    zombie.group.position.set(0, 0, 999);
    zombie.group.removeFromParent();
    zombie.velocity.set(0, 0, 0);
    zombie.hitFlash = 0;
    zombie.deathTimer = 0;
    zombie.deathElapsed = 0;
    zombie.bodySplatterTriggered = false;
    zombie.bloodBurstTriggered = false;
    zombie.primitiveRoot.visible = false;
    if (zombie.walkerRoot) {
      zombie.walkerRoot.visible = false;
      zombie.walkerRoot.position.set(...this.config.enemies.walkerModel.position);
    }
    this.stopWalkerActions(zombie);
    this.resetFlashMaterials(zombie.primitiveFlashMaterials);
    this.resetFlashMaterials(zombie.modelFlashMaterials);
  }

  private updateWalkerDeathFade(zombie: ActiveZombie): void {
    if (!zombie.walkerRoot || zombie.type !== 'walker') {
      return;
    }

    const {
      fadeDelay,
      fadeDuration,
      fadeSink,
      position,
    } = this.config.enemies.walkerModel;
    const fadeProgress = MathUtils.clamp(
      (zombie.deathElapsed - fadeDelay) / Math.max(fadeDuration, 0.001),
      0,
      1,
    );

    if (fadeProgress <= 0) {
      return;
    }

    this.setMaterialOpacity(zombie.modelFlashMaterials, 1 - fadeProgress);
    zombie.walkerRoot.position.set(
      position[0],
      position[1] - fadeSink * fadeProgress,
      position[2],
    );
  }

  private setMaterialOpacity(materials: FlashMaterial[], opacity: number): void {
    const nextOpacity = MathUtils.clamp(opacity, 0, 1);

    for (const material of materials) {
      material.opacity = nextOpacity;
      material.transparent = nextOpacity < 0.999;
      material.depthWrite = nextOpacity >= 0.999;
    }
  }

  private createParticleBurst(): ParticleBurst {
    const group = new Group();
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const maxCount = Math.max(
      this.config.enemies.walkerModel.hitBloodCount,
      this.config.enemies.walkerModel.bodySplatterCount,
      this.config.enemies.walkerModel.bloodBurstCount,
    );
    const shards: ParticleShard[] = [];

    for (let index = 0; index < maxCount; index += 1) {
      const shard = new Mesh(PARTICLE_SHARD_GEOMETRY, material);
      shard.visible = false;
      group.add(shard);
      shards.push({
        mesh: shard,
        velocity: new Vector3(),
        angularVelocity: new Vector3(),
        baseScale: new Vector3(1, 1, 1),
      });
    }

    group.visible = false;

    return {
      group,
      material,
      shards,
      active: false,
      life: 0,
      maxLife: 0,
      gravity: 0,
      stickToRoad: false,
    };
  }

  private createRoadSplat(): RoadSplat {
    const group = new Group();
    const material = new MeshBasicMaterial({
      color: 0x4f0909,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -1,
    });
    const blotches: Mesh[] = [];

    for (let index = 0; index < 3; index += 1) {
      const blotch = new Mesh(ROAD_SPLAT_GEOMETRY, material);
      blotch.rotation.x = -Math.PI * 0.5;
      group.add(blotch);
      blotches.push(blotch);
    }

    group.visible = false;

    return {
      group,
      material,
      blotches,
      active: false,
      life: 0,
      maxLife: 0,
    };
  }

  private spawnHitBloodBurst(zombie: ActiveZombie): void {
    const burst = this.hitBloodBursts.find((entry) => !entry.active);
    if (!burst) {
      return;
    }

    const walkerModel = this.config.enemies.walkerModel;
    burst.active = true;
    if (burst.group.parent !== this.scene) {
      this.scene.add(burst.group);
    }
    burst.group.visible = true;
    burst.life = Math.max(walkerModel.hitBloodLifetime, 0.42);
    burst.maxLife = Math.max(walkerModel.hitBloodLifetime, 0.42);
    burst.gravity = walkerModel.bloodGravity * 0.72;
    burst.stickToRoad = true;
    burst.material.color.setHex(0xb81414);
    burst.material.opacity = 1;
    this.getImpactWorldPoint(zombie, this.effectPosition);
    this.getImpactDirection(zombie, this.effectDirection);
    burst.group.position.copy(
      this.effectPosition.addScaledVector(this.effectDirection, 0.05 * zombie.config.scale),
    );
    this.prepareBurstBasis(this.effectDirection);

    for (let index = 0; index < burst.shards.length; index += 1) {
      const shard = burst.shards[index];
      const enabled = index < walkerModel.hitBloodCount;
      shard.mesh.visible = enabled;
      shard.mesh.position.set(0, 0, 0);

      if (!enabled) {
        continue;
      }

      shard.mesh.rotation.set(
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
      );
      const scale = walkerModel.hitBloodSize * randomRange(0.75, 1.45);
      shard.baseScale.set(
        scale * randomRange(0.34, 0.72),
        scale * randomRange(0.34, 0.72),
        scale * randomRange(1.8, 3.4),
      );
      shard.mesh.scale.set(
        shard.baseScale.x,
        shard.baseScale.y,
        shard.baseScale.z,
      );
      this.setSprayVelocity(
        shard.velocity,
        this.effectDirection,
        walkerModel.hitBloodSpeed * randomRange(0.85, 1.25),
        0.42,
        -0.28,
        0.12,
        0.35,
      );
      shard.angularVelocity.set(
        randomRange(-12, 12),
        randomRange(-12, 12),
        randomRange(-12, 12),
      );
    }
  }

  private spawnBodySplatter(zombie: ActiveZombie): void {
    const burst = this.bodySplatterBursts.find((entry) => !entry.active);
    if (!burst) {
      return;
    }

    const walkerModel = this.config.enemies.walkerModel;
    const activeCount = walkerModel.bodySplatterCount;
    burst.active = true;
    if (burst.group.parent !== this.scene) {
      this.scene.add(burst.group);
    }
    burst.group.visible = true;
    burst.life = walkerModel.bodySplatterLifetime;
    burst.maxLife = walkerModel.bodySplatterLifetime;
    burst.gravity = 4.6;
    burst.stickToRoad = false;
    burst.material.color.setHex(zombie.config.bodyColor);
    burst.material.opacity = 1;
    this.getImpactWorldPoint(zombie, this.effectPosition);
    this.getImpactDirection(zombie, this.effectDirection);
    burst.group.position.copy(
      this.effectPosition.addScaledVector(this.effectDirection, 0.03 * zombie.config.scale),
    );
    this.prepareBurstBasis(this.effectDirection);

    for (let index = 0; index < burst.shards.length; index += 1) {
      const shard = burst.shards[index];
      const enabled = index < activeCount;
      shard.mesh.visible = enabled;
      shard.mesh.position.set(0, 0, 0);

      if (!enabled) {
        continue;
      }

      shard.mesh.rotation.set(
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
      );
      const scale = walkerModel.bodySplatterSize * randomRange(0.7, 1.35);
      shard.baseScale.set(
        scale * randomRange(0.65, 1.05),
        scale * randomRange(0.65, 1.05),
        scale * randomRange(1.4, 2.4),
      );
      shard.mesh.scale.set(
        shard.baseScale.x,
        shard.baseScale.y,
        shard.baseScale.z,
      );
      this.setSprayVelocity(
        shard.velocity,
        this.effectDirection,
        walkerModel.bodySplatterSpeed * randomRange(0.8, 1.2),
        0.55,
        -0.08,
        0.24,
        0.28,
      );
      shard.angularVelocity.set(
        randomRange(-10, 10),
        randomRange(-10, 10),
        randomRange(-10, 10),
      );
    }
  }

  private spawnBloodBurst(zombie: ActiveZombie): void {
    if (zombie.type !== 'walker') {
      return;
    }

    const burst = this.bloodBursts.find((entry) => !entry.active);
    if (!burst) {
      return;
    }

    const walkerModel = this.config.enemies.walkerModel;
    burst.active = true;
    if (burst.group.parent !== this.scene) {
      this.scene.add(burst.group);
    }
    burst.group.visible = true;
    burst.life = walkerModel.bloodBurstLifetime;
    burst.maxLife = walkerModel.bloodBurstLifetime;
    burst.gravity = walkerModel.bloodGravity;
    burst.stickToRoad = true;
    burst.material.color.setHex(0x5c0808);
    burst.material.opacity = 1;
    this.getImpactWorldPoint(zombie, this.effectPosition);
    this.getImpactDirection(zombie, this.effectDirection);
    burst.group.position.copy(
      this.effectPosition.addScaledVector(this.effectDirection, 0.04 * zombie.config.scale),
    );
    this.prepareBurstBasis(this.effectDirection);

    for (let index = 0; index < burst.shards.length; index += 1) {
      const shard = burst.shards[index];
      const enabled = index < walkerModel.bloodBurstCount;
      shard.mesh.visible = enabled;
      shard.mesh.position.set(0, 0, 0);

      if (!enabled) {
        continue;
      }

      shard.mesh.rotation.set(
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
        randomRange(0, Math.PI * 2),
      );
      const scale = walkerModel.bloodBurstSize * randomRange(0.7, 1.2);
      shard.baseScale.set(
        scale * randomRange(0.45, 0.82),
        scale * randomRange(0.28, 0.56),
        scale * randomRange(1.6, 2.7),
      );
      shard.mesh.scale.set(
        shard.baseScale.x,
        shard.baseScale.y,
        shard.baseScale.z,
      );
      this.setSprayVelocity(
        shard.velocity,
        this.effectDirection,
        walkerModel.bloodBurstSpeed * randomRange(0.7, 1.08),
        0.62,
        -0.42,
        0.04,
        0.12,
      );
      shard.angularVelocity.set(
        randomRange(-8, 8),
        randomRange(-8, 8),
        randomRange(-8, 8),
      );
    }
  }

  private updateParticleBursts(
    bursts: ParticleBurst[],
    deltaTime: number,
    worldScrollSpeed: number,
  ): void {
    for (const burst of bursts) {
      if (!burst.active) {
        continue;
      }

      burst.life -= deltaTime;
      burst.group.position.z += worldScrollSpeed * deltaTime;

      if (burst.life <= 0) {
        this.deactivateParticleBurst(burst);
        continue;
      }

      const lifeRatio = burst.life / burst.maxLife;
      burst.material.opacity = lifeRatio * 0.95;

      for (const shard of burst.shards) {
        if (!shard.mesh.visible) {
          continue;
        }

        shard.velocity.y -= burst.gravity * deltaTime;
        shard.mesh.position.addScaledVector(shard.velocity, deltaTime);
        if (burst.stickToRoad && this.tryStickBloodToRoad(burst, shard)) {
          continue;
        }
        this.effectLookTarget.copy(shard.mesh.position).add(shard.velocity);
        shard.mesh.lookAt(this.effectLookTarget);
        const stretch = 1 + Math.min(shard.velocity.length() * 0.09, 2.6) * lifeRatio;
        shard.mesh.scale.set(
          shard.baseScale.x,
          shard.baseScale.y,
          shard.baseScale.z * stretch,
        );
        shard.mesh.rotation.z += shard.angularVelocity.z * deltaTime;
      }
    }
  }

  private deactivateParticleBurst(burst: ParticleBurst): void {
    burst.active = false;
    burst.group.visible = false;
    burst.group.position.set(0, 0, 999);
    burst.group.removeFromParent();
    burst.material.opacity = 0;
    burst.gravity = 0;
    burst.stickToRoad = false;

    for (const shard of burst.shards) {
      shard.mesh.visible = false;
      shard.mesh.position.set(0, 0, 0);
      shard.mesh.scale.copy(shard.baseScale);
    }
  }

  private updateRoadSplats(deltaTime: number, worldScrollSpeed: number): void {
    for (const splat of this.roadSplats) {
      if (!splat.active) {
        continue;
      }

      splat.life -= deltaTime;
      splat.group.position.z += worldScrollSpeed * deltaTime;

      if (
        splat.life <= 0 ||
        splat.group.position.z > this.config.enemies.cleanupZ
      ) {
        this.deactivateRoadSplat(splat);
        continue;
      }

      const lifeRatio = splat.life / splat.maxLife;
      splat.material.opacity =
        this.config.enemies.walkerModel.roadSplatOpacity * Math.pow(lifeRatio, 0.8);
    }
  }

  private tryStickBloodToRoad(burst: ParticleBurst, shard: ParticleShard): boolean {
    if (!shard.mesh.visible) {
      return false;
    }

    const worldX = burst.group.position.x + shard.mesh.position.x;
    const worldY = burst.group.position.y + shard.mesh.position.y;
    const worldZ = burst.group.position.z + shard.mesh.position.z;
    const withinRoad = Math.abs(worldX) <= this.config.world.roadHalfWidth - 0.35;

    if (!withinRoad || worldY > this.config.world.roadSurfaceY) {
      return false;
    }

    this.spawnRoadSplat(worldX, worldZ, burst.material.color.getHex());
    shard.mesh.visible = false;
    return true;
  }

  private spawnRoadSplat(x: number, z: number, color: number): void {
    const splat = this.roadSplats.find((entry) => !entry.active);
    if (!splat) {
      return;
    }

    const walkerModel = this.config.enemies.walkerModel;
    splat.active = true;
    if (splat.group.parent !== this.scene) {
      this.scene.add(splat.group);
    }
    splat.group.visible = true;
    splat.group.position.set(x, this.config.world.roadSurfaceY, z);
    splat.life = walkerModel.roadSplatLifetime;
    splat.maxLife = walkerModel.roadSplatLifetime;
    splat.material.color.setHex(color);
    splat.material.opacity = walkerModel.roadSplatOpacity;

    for (let index = 0; index < splat.blotches.length; index += 1) {
      const blotch = splat.blotches[index];
      blotch.position.set(
        randomRange(-0.18, 0.18),
        0,
        randomRange(-0.18, 0.18),
      );
      blotch.rotation.set(
        -Math.PI * 0.5,
        randomRange(0, Math.PI * 2),
        randomRange(-0.08, 0.08),
      );
      const scale = walkerModel.roadSplatSize * randomRange(0.7, 1.35);
      blotch.scale.set(
        scale * randomRange(0.8, 1.35),
        scale * randomRange(0.55, 1.1),
        1,
      );
    }
  }

  private deactivateRoadSplat(splat: RoadSplat): void {
    splat.active = false;
    splat.group.visible = false;
    splat.group.position.set(0, this.config.world.roadSurfaceY, 999);
    splat.group.removeFromParent();
    splat.material.opacity = 0;
  }

  private captureImpactPoint(zombie: ActiveZombie, impactPoint?: Vector3): void {
    if (!impactPoint) {
      zombie.impactLocalPoint.set(0, 1.15, 0.32);
      return;
    }

    zombie.impactLocalPoint.copy(impactPoint);
    zombie.group.worldToLocal(zombie.impactLocalPoint);
  }

  private getImpactWorldPoint(zombie: ActiveZombie, target: Vector3): Vector3 {
    target.copy(zombie.impactLocalPoint);
    return zombie.group.localToWorld(target);
  }

  private getImpactDirection(zombie: ActiveZombie, target: Vector3): Vector3 {
    target
      .copy(zombie.impactLocalPoint)
      .sub(this.getZombieLocalCenter(zombie, this.effectTangent));

    if (target.lengthSq() < 0.0001) {
      target.set(0, 0.12, 1);
    }

    target.normalize().applyQuaternion(zombie.group.quaternion).normalize();
    return target;
  }

  private getZombieLocalCenter(zombie: ActiveZombie, target: Vector3): Vector3 {
    target.set(0, 1.1 / Math.max(zombie.config.scale, 0.0001), 0);
    return target;
  }

  private prepareBurstBasis(direction: Vector3): void {
    this.effectTangent.crossVectors(direction, Object3D.DEFAULT_UP);
    if (this.effectTangent.lengthSq() < 0.0001) {
      this.effectTangent.set(1, 0, 0);
    } else {
      this.effectTangent.normalize();
    }

    this.effectBitangent.crossVectors(this.effectTangent, direction).normalize();
  }

  private setSprayVelocity(
    target: Vector3,
    direction: Vector3,
    speed: number,
    spread: number,
    verticalMin: number,
    verticalMax: number,
    forwardJitter: number,
  ): void {
    target
      .copy(direction)
      .multiplyScalar(speed * randomRange(0.82, 1.18))
      .addScaledVector(this.effectTangent, randomRange(-spread, spread) * speed)
      .addScaledVector(this.effectBitangent, randomRange(-spread, spread) * speed);
    target.y += randomRange(verticalMin, verticalMax) * speed;
    target.addScaledVector(direction, forwardJitter * speed * randomRange(-0.2, 1));
  }

  // Walker assets are loaded once, then cloned per pooled slot to keep startup light.
  private loadWalkerAssets(): Promise<void> {
    if (this.walkerAssetsPromise) {
      return this.walkerAssetsPromise;
    }

    this.walkerAssetsPromise = (async () => {
      const [{ GLTFLoader }, skeletonUtils] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/utils/SkeletonUtils.js'),
      ]);
      const loader = new GLTFLoader();
      const walkerModel = this.config.enemies.walkerModel;
      const [characterGltf, walkGltf, deathGltf] = await Promise.all([
        loader.loadAsync(walkerModel.characterPath),
        loader.loadAsync(walkerModel.walkAnimationPath),
        loader.loadAsync(walkerModel.deathAnimationPath),
      ]);

      const walkClip = walkGltf.animations[0];
      const deathClip = deathGltf.animations[0];
      if (!walkClip || !deathClip) {
        throw new Error('Walker zombie animations are missing required clips.');
      }

      this.walkerAssets = {
        template: characterGltf.scene,
        walkClip,
        deathClip,
      };

      this.attachWalkerVisuals(skeletonUtils.clone as CloneSkinnedScene);
    })().catch((error) => {
      console.error('Failed to load walker zombie assets.', error);
    });

    return this.walkerAssetsPromise;
  }

  private attachWalkerVisuals(cloneSkinnedScene: CloneSkinnedScene): void {
    if (!this.walkerAssets) {
      return;
    }

    for (const zombie of this.pool) {
      if (!zombie.walkerRoot) {
        this.attachWalkerVisual(zombie, cloneSkinnedScene);
      }

      if (zombie.active && zombie.type === 'walker' && zombie.state === 'alive') {
        this.enableWalkerVisual(zombie);
      }
    }
  }

  private attachWalkerVisual(
    zombie: ActiveZombie,
    cloneSkinnedScene: CloneSkinnedScene,
  ): void {
    if (!this.walkerAssets) {
      return;
    }

    const walkerRoot = new Group();
    const [posX, posY, posZ] = this.config.enemies.walkerModel.position;
    const [rotX, rotY, rotZ] = this.config.enemies.walkerModel.rotationDegrees;

    walkerRoot.position.set(posX, posY, posZ);
    walkerRoot.rotation.set(
      MathUtils.degToRad(rotX),
      MathUtils.degToRad(rotY),
      MathUtils.degToRad(rotZ),
    );
    walkerRoot.scale.setScalar(this.config.enemies.walkerModel.scale);
    walkerRoot.visible = false;

    const walkerClone = cloneSkinnedScene(this.walkerAssets.template) as Group;
    zombie.modelFlashMaterials = [];
    this.prepareWalkerClone(walkerClone, zombie);

    walkerRoot.add(walkerClone);
    zombie.group.add(walkerRoot);
    zombie.walkerRoot = walkerRoot;
    zombie.mixer = new AnimationMixer(walkerClone);
    zombie.walkAction = zombie.mixer.clipAction(this.walkerAssets.walkClip);
    zombie.deathAction = zombie.mixer.clipAction(this.walkerAssets.deathClip);
    zombie.deathAction.clampWhenFinished = true;

    this.assignPoolId(walkerRoot, zombie.poolId);
  }

  private prepareWalkerClone(root: Object3D, zombie: ActiveZombie): void {
    root.traverse((object) => {
      object.userData.poolId = zombie.poolId;

      if (!(object instanceof Mesh)) {
        return;
      }

      object.frustumCulled = false;

      if (Array.isArray(object.material)) {
        object.material = object.material.map((material) => material.clone());
        for (const material of object.material) {
          this.registerFlashMaterial(material, zombie.modelFlashMaterials);
        }
        return;
      }

      object.material = object.material.clone();
      this.registerFlashMaterial(object.material, zombie.modelFlashMaterials);
    });
  }

  private registerFlashMaterial(
    material: unknown,
    target: FlashMaterial[],
  ): void {
    if (
      !material ||
      typeof material !== 'object' ||
      !('emissive' in material) ||
      !('emissiveIntensity' in material)
    ) {
      return;
    }

    const flashMaterial = material as FlashMaterial;
    flashMaterial.emissive.setHex(0x000000);
    flashMaterial.emissiveIntensity = 0;
    flashMaterial.opacity = 1;
    flashMaterial.transparent = false;
    flashMaterial.depthWrite = true;
    target.push(flashMaterial);
  }

  private assignPoolId(root: Object3D, poolId: number): void {
    root.traverse((object) => {
      object.userData.poolId = poolId;
    });
  }
}
