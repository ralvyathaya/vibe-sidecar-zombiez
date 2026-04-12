import {
  BoxGeometry,
  Camera,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
} from 'three';
import type { ActiveZombie, GameConfig, ZombieType } from '../../core/types';
import { randomRange } from '../../core/utils';

const TORSO_GEOMETRY = new BoxGeometry(0.8, 1.05, 0.5);
const HEAD_GEOMETRY = new BoxGeometry(0.54, 0.52, 0.48);
const ARM_GEOMETRY = new BoxGeometry(0.18, 0.76, 0.18);
const LEG_GEOMETRY = new BoxGeometry(0.22, 0.9, 0.22);

export class EnemySystem {
  private readonly pool: ActiveZombie[] = [];
  private readonly raycaster = new Raycaster();
  private readonly chaseVector = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly config: GameConfig,
  ) {
    for (let index = 0; index < this.config.enemies.poolSize; index += 1) {
      const zombie = this.createZombie(index);
      this.pool.push(zombie);
      this.scene.add(zombie.group);
    }
  }

  reset(): void {
    for (const zombie of this.pool) {
      zombie.active = false;
      zombie.group.visible = false;
      zombie.group.position.set(0, 0, 999);
      zombie.hitFlash = 0;
    }
  }

  spawn(type: ZombieType, laneX: number, zPosition: number): boolean {
    const zombie = this.pool.find((entry) => !entry.active);
    if (!zombie) {
      return false;
    }

    const zombieConfig = this.config.enemies.types[type];
    zombie.active = true;
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
    zombie.bodyMaterial.color.setHex(zombieConfig.bodyColor);
    zombie.bodyMaterial.emissive.setHex(0x000000);
    zombie.accentMaterial.color.setHex(zombieConfig.accentColor);
    zombie.accentMaterial.emissive.setHex(0x000000);
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

      zombie.animationClock += deltaTime * (4 + zombie.config.speed);
      this.animateZombie(zombie);
      this.updateHitFlash(zombie, deltaTime);

      if (distanceToPlayer < this.config.enemies.contactRadius * zombie.config.scale) {
        onPlayerHit(zombie.config.contactDamage, zombie.group.position.x);
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
      .filter((entry) => entry.active)
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
      if (zombie?.active) {
        return zombie;
      }
    }

    return null;
  }

  damage(zombie: ActiveZombie, amount: number): number {
    zombie.health -= amount;
    zombie.hitFlash = 1;
    zombie.bodyMaterial.emissive.setHex(0x5a1405);
    zombie.accentMaterial.emissive.setHex(0x3d0f04);

    if (zombie.health <= 0) {
      const scoreValue = zombie.config.scoreValue;
      this.deactivate(zombie);
      return scoreValue;
    }

    return 0;
  }

  getActiveCount(): number {
    return this.pool.reduce((count, zombie) => count + (zombie.active ? 1 : 0), 0);
  }

  private createZombie(poolId: number): ActiveZombie {
    const group = new Group();
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
    group.add(torso);

    const head = new Mesh(HEAD_GEOMETRY, rootMaterial);
    head.position.y = 2.28;
    group.add(head);

    const leftArmPivot = this.createLimbPivot(-0.52, 1.86, -0.05, rootMaterial, ARM_GEOMETRY);
    const rightArmPivot = this.createLimbPivot(0.52, 1.86, -0.05, rootMaterial, ARM_GEOMETRY);
    const leftLegPivot = this.createLimbPivot(-0.22, 0.92, 0, accentMaterial, LEG_GEOMETRY);
    const rightLegPivot = this.createLimbPivot(0.22, 0.92, 0, accentMaterial, LEG_GEOMETRY);

    group.add(leftArmPivot, rightArmPivot, leftLegPivot, rightLegPivot);
    group.visible = false;
    group.position.z = 999;

    group.traverse((object) => {
      object.userData.poolId = poolId;
    });

    return {
      id: poolId,
      poolId,
      group,
      active: false,
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
    };
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

  private animateZombie(zombie: ActiveZombie): void {
    const stride = Math.sin(zombie.animationClock + zombie.animationOffset) * 0.7;
    zombie.leftArmPivot.rotation.x = stride;
    zombie.rightArmPivot.rotation.x = -stride;
    zombie.leftLegPivot.rotation.x = -stride;
    zombie.rightLegPivot.rotation.x = stride;
  }

  private updateHitFlash(zombie: ActiveZombie, deltaTime: number): void {
    zombie.hitFlash = Math.max(0, zombie.hitFlash - deltaTime * 6);
    const emissiveStrength = zombie.hitFlash * 0.55;
    zombie.bodyMaterial.emissiveIntensity = emissiveStrength;
    zombie.accentMaterial.emissiveIntensity = emissiveStrength;
  }

  private deactivate(zombie: ActiveZombie): void {
    zombie.active = false;
    zombie.group.visible = false;
    zombie.group.position.set(0, 0, 999);
    zombie.hitFlash = 0;
    zombie.bodyMaterial.emissiveIntensity = 0;
    zombie.accentMaterial.emissiveIntensity = 0;
  }
}
