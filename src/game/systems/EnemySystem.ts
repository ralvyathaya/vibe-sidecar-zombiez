import {
  AnimationClip,
  AnimationMixer,
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
const HIT_FLASH_COLOR = 0x5a1405;

type WalkerAssets = {
  template: Group;
  walkClip: AnimationClip;
  deathClip: AnimationClip;
};

type CloneSkinnedScene = (source: Object3D) => Object3D;

export class EnemySystem {
  private readonly pool: ActiveZombie[] = [];
  private readonly raycaster = new Raycaster();
  private readonly chaseVector = new Vector3();

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

    void this.loadWalkerAssets();
  }

  reset(): void {
    for (const zombie of this.pool) {
      this.deactivate(zombie);
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
    zombie.group.visible = true;
    zombie.group.position.set(laneX + randomRange(-0.55, 0.55), 0, zPosition);
    zombie.group.scale.setScalar(zombieConfig.scale);
    zombie.animationClock = 0;
    zombie.animationOffset = randomRange(0, Math.PI * 2);
    zombie.hitFlash = 0;
    zombie.deathTimer = 0;

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
        zombie.deathTimer -= deltaTime;
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

  raycast(camera: Camera, crosshair: Vector2, range: number): ActiveZombie | null {
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
        return zombie;
      }
    }

    return null;
  }

  damage(zombie: ActiveZombie, amount: number): number {
    if (!zombie.active || zombie.state !== 'alive') {
      return 0;
    }

    zombie.health -= amount;
    zombie.hitFlash = 1;
    this.setFlashColor(zombie.flashMaterials, HIT_FLASH_COLOR);

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

    if (!zombie.deathAction) {
      zombie.deathTimer = 0.18;
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
      .setEffectiveTimeScale(1)
      .setEffectiveWeight(1)
      .play();
    zombie.deathAction.clampWhenFinished = true;
    zombie.deathTimer = zombie.deathAction.getClip().duration + 0.1;
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
    zombie.velocity.set(0, 0, 0);
    zombie.hitFlash = 0;
    zombie.deathTimer = 0;
    zombie.primitiveRoot.visible = false;
    if (zombie.walkerRoot) {
      zombie.walkerRoot.visible = false;
    }
    this.stopWalkerActions(zombie);
    this.resetFlashMaterials(zombie.primitiveFlashMaterials);
    this.resetFlashMaterials(zombie.modelFlashMaterials);
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
    target.push(flashMaterial);
  }

  private assignPoolId(root: Object3D, poolId: number): void {
    root.traverse((object) => {
      object.userData.poolId = poolId;
    });
  }
}
