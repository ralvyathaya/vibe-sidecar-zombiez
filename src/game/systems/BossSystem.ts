import {
  AdditiveBlending,
  BoxGeometry,
  Camera,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type {
  BossAttackPattern,
  BossEncounterStatus,
  BossPhase,
  BossSnapshot,
  GameConfig,
  WeaponKind,
} from '../../core/types';
import { clamp, randomInt, sampleRoadCurveOffset } from '../../core/utils';
import { SoundEffectPool } from '../audio/SoundEffectPool';

type BossProjectileRecord = {
  id: number;
  active: boolean;
  laneIndex: number;
  laneX: number;
  width: number;
  telegraphTimer: number;
  impactTimer: number;
  pattern: BossAttackPattern;
  hitPlayer: boolean;
  impactSoundPlayed: boolean;
  mesh: Mesh;
  material: MeshBasicMaterial;
};

type BossDamageResult = {
  damage: number;
  sourceX: number;
};

const HULL_GEOMETRY = new BoxGeometry(1, 1, 1);
const NOSE_GEOMETRY = new IcosahedronGeometry(1, 1);
const WEAKPOINT_GEOMETRY = new SphereGeometry(1, 14, 10);
const TELEGRAPH_GEOMETRY = new BoxGeometry(1, 0.06, 1);

export class BossSystem {
  private readonly root = new Group();
  private readonly hull: Mesh;
  private readonly weakpoint: Mesh;
  private readonly keyLight = new PointLight(0xff743b, 0, 18, 2);
  private readonly projectiles: BossProjectileRecord[] = [];
  private readonly rayOrigin = new Vector3();
  private readonly rayDirection = new Vector3();
  private readonly bossCenter = new Vector3();
  private readonly toBoss = new Vector3();
  private readonly closestPoint = new Vector3();
  private readonly hoverBase = new Vector3();
  private readonly preStrikeSound: SoundEffectPool;
  private readonly projectileHitSound: SoundEffectPool;
  private readonly snapshotFallback: BossSnapshot = {
    status: 'inactive',
    level: 0,
    healthRatio: 0,
    timerRatio: 0,
    phase: 0,
    hitFlashRatio: 0,
    attackWarningRatio: 0,
    activeTelegraphs: [],
  };

  private status: BossEncounterStatus = 'inactive';
  private level: BossPhase = 0;
  private phase: BossPhase = 0;
  private encounterIndex = 0;
  private health = 0;
  private maxHealth = 0;
  private statusTimer = 0;
  private fightTimer = 0;
  private attackTimer = 0;
  private time = 0;
  private projectileId = 0;
  private pendingScoreBonus = 0;
  private hitFlashTimer = 0;
  private lastProjectileHitSoundTime = -99;
  private lastRemotePreStrikeId = 0;
  private remoteSnapshot: BossSnapshot | null = null;
  private remoteSnapshotTimer = 0;

  constructor(
    private readonly scene: Scene,
    private readonly config: GameConfig,
  ) {
    this.root.name = 'ProceduralAirborneBoss';
    this.root.visible = false;
    this.hoverBase.set(...this.config.boss.hoverPosition);
    this.preStrikeSound = new SoundEffectPool(this.config.boss.audio.preStrikePath, {
      poolSize: 3,
      volume: this.config.boss.audio.preStrikeVolume,
    });
    this.projectileHitSound = new SoundEffectPool(this.config.boss.audio.projectileHitPath, {
      poolSize: 4,
      volume: this.config.boss.audio.projectileHitVolume,
    });

    this.hull = new Mesh(
      HULL_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x2d353c,
        emissive: 0x1b0904,
        emissiveIntensity: 0.35,
        roughness: 0.78,
        metalness: 0.16,
        flatShading: true,
      }),
    );
    this.hull.scale.set(7.8, 2.1, 3.2);
    this.root.add(this.hull);

    const nose = new Mesh(
      NOSE_GEOMETRY,
      new MeshStandardMaterial({
        color: 0x46505a,
        emissive: 0x20110b,
        emissiveIntensity: 0.24,
        roughness: 0.72,
        metalness: 0.18,
        flatShading: true,
      }),
    );
    nose.position.set(0, -0.08, 2.2);
    nose.scale.set(2.1, 1.05, 1.15);
    this.root.add(nose);

    for (const side of [-1, 1] as const) {
      const wing = new Mesh(
        HULL_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x202830,
          emissive: 0x160702,
          emissiveIntensity: 0.18,
          roughness: 0.84,
          metalness: 0.12,
          flatShading: true,
        }),
      );
      wing.position.set(side * 5.1, -0.18, -0.15);
      wing.rotation.z = side * 0.12;
      wing.scale.set(3.4, 0.34, 1.55);
      this.root.add(wing);

      const rotor = new Mesh(
        HULL_GEOMETRY,
        new MeshBasicMaterial({
          color: 0xffa45c,
          transparent: true,
          opacity: 0.42,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      rotor.position.set(side * 7.1, -0.05, -0.1);
      rotor.scale.set(0.14, 2.2, 0.14);
      rotor.name = side < 0 ? 'BossLeftRotor' : 'BossRightRotor';
      this.root.add(rotor);
    }

    this.weakpoint = new Mesh(
      WEAKPOINT_GEOMETRY,
      new MeshStandardMaterial({
        color: 0xff6d45,
        emissive: 0xff3c20,
        emissiveIntensity: 1.4,
        roughness: 0.45,
        metalness: 0.1,
      }),
    );
    this.weakpoint.position.set(0, -0.2, 2.95);
    this.weakpoint.scale.set(0.86, 0.86, 0.86);
    this.root.add(this.weakpoint, this.keyLight);
    this.keyLight.position.set(0, -0.1, 3.4);

    this.scene.add(this.root);
    this.createProjectilePool();
    this.reset();
  }

  reset(): void {
    this.status = 'inactive';
    this.level = 0;
    this.phase = 0;
    this.encounterIndex = 0;
    this.health = 0;
    this.maxHealth = 0;
    this.statusTimer = 0;
    this.fightTimer = 0;
    this.attackTimer = 0;
    this.time = 0;
    this.pendingScoreBonus = 0;
    this.hitFlashTimer = 0;
    this.lastProjectileHitSoundTime = -99;
    this.lastRemotePreStrikeId = 0;
    this.remoteSnapshot = null;
    this.remoteSnapshotTimer = 0;
    this.root.visible = false;
    this.root.position.copy(this.hoverBase);
    this.keyLight.intensity = 0;
    for (const projectile of this.projectiles) {
      this.deactivateProjectile(projectile);
    }
  }

  destroy(): void {
    this.reset();
    this.root.removeFromParent();
    for (const projectile of this.projectiles) {
      projectile.mesh.removeFromParent();
      projectile.mesh.geometry.dispose();
      projectile.material.dispose();
    }
    this.preStrikeSound.destroy();
    this.projectileHitSound.destroy();
  }

  update(
    deltaTime: number,
    elapsedSeconds: number,
    playerX: number,
  ): BossDamageResult {
    this.time += deltaTime;
    this.hitFlashTimer = Math.max(0, this.hitFlashTimer - deltaTime);
    this.remoteSnapshotTimer = Math.max(0, this.remoteSnapshotTimer - deltaTime);
    if (this.remoteSnapshotTimer <= 0) {
      this.remoteSnapshot = null;
    }

    if (this.config.boss.enabled && this.status === 'inactive') {
      const nextTime = this.config.boss.encounterTimes[this.encounterIndex];
      if (nextTime !== undefined && elapsedSeconds >= nextTime) {
        this.startEncounter();
      }
    }

    this.updateBossState(deltaTime);
    const damage = this.updateProjectiles(deltaTime, playerX);
    this.updatePresentation();
    return damage;
  }

  applyDamageFromCamera(camera: Camera, weapon: WeaponKind, amount: number): boolean {
    if (!this.isVulnerable() || amount <= 0) {
      return false;
    }

    camera.getWorldPosition(this.rayOrigin);
    camera.getWorldDirection(this.rayDirection);
    this.root.getWorldPosition(this.bossCenter);
    this.toBoss.copy(this.bossCenter).sub(this.rayOrigin);
    const projectedDistance = this.toBoss.dot(this.rayDirection);
    if (projectedDistance < 0 || projectedDistance > this.getWeaponBossRange(weapon)) {
      return false;
    }

    this.closestPoint
      .copy(this.rayOrigin)
      .addScaledVector(this.rayDirection, projectedDistance);
    const radius = this.config.boss.hitRadius * (weapon === 'shotgun' ? 1.24 : 1);
    if (this.closestPoint.distanceToSquared(this.bossCenter) > radius * radius) {
      return false;
    }

    const damageMultiplier = weapon === 'bazooka' ? 4.2 : weapon === 'shotgun' ? 2.2 : 1;
    this.health = Math.max(0, this.health - amount * damageMultiplier);
    this.hitFlashTimer = 0.16;
    if (this.health <= 0) {
      this.startRetreat(true);
    }
    return true;
  }

  consumeScoreBonus(): number {
    const bonus = this.pendingScoreBonus;
    this.pendingScoreBonus = 0;
    return bonus;
  }

  isCombatActive(): boolean {
    return this.status === 'approach' || this.status === 'fighting';
  }

  isActive(): boolean {
    return this.status !== 'inactive';
  }

  getSnapshot(): BossSnapshot {
    if (this.remoteSnapshot) {
      return this.remoteSnapshot;
    }

    if (this.status === 'inactive') {
      return this.snapshotFallback;
    }

    return {
      status: this.status,
      level: this.level,
      healthRatio: this.maxHealth > 0 ? clamp(this.health / this.maxHealth, 0, 1) : 0,
      timerRatio:
        this.status === 'fighting'
          ? clamp(1 - this.fightTimer / Math.max(this.config.boss.duration, 0.001), 0, 1)
          : this.status === 'approach'
            ? clamp(this.statusTimer / Math.max(this.config.boss.approachDuration, 0.001), 0, 1)
            : clamp(1 - this.statusTimer / Math.max(this.config.boss.retreatDuration, 0.001), 0, 1),
      phase: this.phase,
      hitFlashRatio: clamp(this.hitFlashTimer / 0.16, 0, 1),
      attackWarningRatio: this.status === 'fighting' ? this.getAttackWarningRatio() : 0,
      activeTelegraphs: this.projectiles
        .filter((projectile) => projectile.active)
        .map((projectile) => ({
          id: projectile.id,
          laneIndex: projectile.laneIndex,
          laneX: projectile.laneX,
          width: projectile.width,
          warningRatio:
            projectile.telegraphTimer > 0
              ? clamp(
                  1 -
                    projectile.telegraphTimer /
                      Math.max(this.config.boss.projectileTelegraphDuration, 0.001),
                  0,
                  1,
                )
              : 1,
        })),
    };
  }

  applySnapshot(snapshot: BossSnapshot): void {
    this.remoteSnapshot = snapshot;
    this.remoteSnapshotTimer = 0.34;
    this.syncRemoteTelegraphs(snapshot);
  }

  private createProjectilePool(): void {
    for (let index = 0; index < 8; index += 1) {
      const material = new MeshBasicMaterial({
        color: 0xff3f2f,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new Mesh(TELEGRAPH_GEOMETRY, material);
      mesh.name = `BossLaneTelegraph_${index}`;
      mesh.visible = false;
      mesh.position.set(0, this.config.world.roadSurfaceY + 0.08, -18);
      this.scene.add(mesh);
      this.projectiles.push({
        id: index,
        active: false,
        laneIndex: 0,
        laneX: 0,
        width: this.config.boss.projectileWidth,
        telegraphTimer: 0,
        impactTimer: 0,
        pattern: 'singleLane',
        hitPlayer: false,
        impactSoundPlayed: false,
        mesh,
        material,
      });
    }
  }

  private startEncounter(): void {
    const resolvedLevel = clamp(this.encounterIndex + 1, 1, 3) as BossPhase;
    this.encounterIndex += 1;
    this.status = 'approach';
    this.level = resolvedLevel;
    this.phase = resolvedLevel;
    this.statusTimer = 0;
    this.fightTimer = 0;
    this.attackTimer = 0.75;
    this.maxHealth = this.config.boss.maxHealthByLevel[resolvedLevel - 1] ?? 42;
    this.health = this.maxHealth;
    this.root.visible = true;
    this.root.position.copy(this.hoverBase).add(new Vector3(0, 4.5, -14));
    this.keyLight.intensity = 0;
  }

  private updateBossState(deltaTime: number): void {
    if (this.status === 'inactive') {
      return;
    }

    this.statusTimer += deltaTime;

    if (this.status === 'approach') {
      if (this.statusTimer >= this.config.boss.approachDuration) {
        this.status = 'fighting';
        this.statusTimer = 0;
        this.fightTimer = 0;
        this.attackTimer = 0.4;
      }
      return;
    }

    if (this.status === 'retreating' || this.status === 'defeated') {
      if (this.statusTimer >= this.config.boss.retreatDuration) {
        this.status = 'inactive';
        this.statusTimer = 0;
        this.level = 0;
        this.phase = 0;
        this.root.visible = false;
        for (const projectile of this.projectiles) {
          this.deactivateProjectile(projectile);
        }
      }
      return;
    }

    this.fightTimer += deltaTime;
    this.attackTimer -= deltaTime;
    this.phase = this.resolvePhase();
    if (this.attackTimer <= 0) {
      this.spawnAttack();
      this.attackTimer =
        (this.config.boss.projectileIntervalByLevel[this.level - 1] ?? 1.8) *
        (this.phase >= 3 ? 0.82 : this.phase >= 2 ? 0.92 : 1);
    }

    if (this.fightTimer >= this.config.boss.duration) {
      this.startRetreat(false);
    }
  }

  private updateProjectiles(deltaTime: number, playerX: number): BossDamageResult {
    let damage = 0;
    let sourceX = 0;
    for (const projectile of this.projectiles) {
      if (!projectile.active) {
        continue;
      }

      if (projectile.telegraphTimer > 0) {
        projectile.telegraphTimer = Math.max(0, projectile.telegraphTimer - deltaTime);
        if (projectile.telegraphTimer <= 0 && !projectile.impactSoundPlayed) {
          projectile.impactSoundPlayed = true;
          this.playProjectileHitSound();
        }
      } else {
        projectile.impactTimer = Math.max(0, projectile.impactTimer - deltaTime);
        if (!projectile.hitPlayer) {
          const hitWidth = projectile.width * 0.5 + this.config.player.collisionRadius;
          if (Math.abs(playerX - projectile.laneX) <= hitWidth) {
            projectile.hitPlayer = true;
            damage += this.config.boss.projectileDamage;
            sourceX = projectile.laneX;
          }
        }
      }

      if (projectile.telegraphTimer <= 0 && projectile.impactTimer <= 0) {
        this.deactivateProjectile(projectile);
      }
    }

    return { damage, sourceX };
  }

  private updatePresentation(): void {
    if (this.status === 'inactive') {
      return;
    }

    const approachRatio =
      this.status === 'approach'
        ? clamp(this.statusTimer / Math.max(this.config.boss.approachDuration, 0.001), 0, 1)
        : 1;
    const retreatRatio =
      this.status === 'retreating' || this.status === 'defeated'
        ? clamp(this.statusTimer / Math.max(this.config.boss.retreatDuration, 0.001), 0, 1)
        : 0;
    const drift = this.config.boss.hoverDrift;
    this.root.position.set(
      this.hoverBase.x + Math.sin(this.time * 0.92) * drift[0],
      this.hoverBase.y +
        Math.sin(this.time * 1.31) * drift[1] +
        (1 - approachRatio) * 4.5 +
        retreatRatio * 5.5,
      this.hoverBase.z +
        Math.cos(this.time * 0.72) * drift[2] -
        (1 - approachRatio) * 14 -
        retreatRatio * 16,
    );
    this.root.rotation.set(
      Math.sin(this.time * 0.9) * 0.035,
      Math.sin(this.time * 0.55) * 0.12,
      Math.cos(this.time * 0.8) * 0.045,
    );
    const healthRatio = this.maxHealth > 0 ? this.health / this.maxHealth : 0;
    this.weakpoint.scale.setScalar(0.76 + (1 - healthRatio) * 0.28 + Math.sin(this.time * 8) * 0.04);
    const weakMaterial = this.weakpoint.material as MeshStandardMaterial;
    const hitFlashRatio = clamp(this.hitFlashTimer / 0.16, 0, 1);
    weakMaterial.emissiveIntensity =
      1.05 + (1 - healthRatio) * 1.3 + Math.sin(this.time * 7) * 0.18 + hitFlashRatio * 2.2;
    this.keyLight.intensity =
      (this.status === 'fighting' ? 1.6 + (1 - healthRatio) * 2.1 : 0.8) + hitFlashRatio * 2.8;
    (this.hull.material as MeshStandardMaterial).emissiveIntensity = 0.35 + hitFlashRatio * 0.9;

    for (const projectile of this.projectiles) {
      if (!projectile.active) {
        continue;
      }

      const telegraphRatio =
        projectile.telegraphTimer > 0
          ? 1 -
            projectile.telegraphTimer /
              Math.max(this.config.boss.projectileTelegraphDuration, 0.001)
          : 1;
      const impactActive = projectile.telegraphTimer <= 0;
      projectile.mesh.visible = true;
      const telegraphZ = -17;
      projectile.mesh.position.x =
        projectile.laneX +
        sampleRoadCurveOffset(
          telegraphZ,
          this.time,
          this.config.world.roadCurveFrequency,
          this.config.world.roadCurveAmplitude,
        );
      projectile.mesh.position.z = telegraphZ;
      projectile.mesh.scale.set(
        projectile.width * (impactActive ? 1.06 : 0.9 + telegraphRatio * 0.18),
        1,
        impactActive ? 23 : 31,
      );
      projectile.material.color.setHex(impactActive ? 0xfff0a0 : 0xff3f2f);
      projectile.material.opacity = impactActive
        ? 0.72 * clamp(projectile.impactTimer / this.config.boss.projectileImpactDuration, 0, 1)
        : 0.24 + telegraphRatio * 0.42;
    }
  }

  private spawnAttack(): void {
    const laneCount = this.config.world.laneCenters.length;
    const baseLane = randomInt(0, laneCount - 1);
    const pattern = this.pickAttackPattern();
    this.playPreStrikeSound();
    if (pattern === 'lanePair') {
      this.spawnProjectile(baseLane, pattern);
      this.spawnProjectile(clamp(baseLane + (Math.random() < 0.5 ? -1 : 1), 0, laneCount - 1), pattern);
      return;
    }

    if (pattern === 'sweep') {
      for (let index = 0; index < laneCount; index += 1) {
        if (index === baseLane && laneCount > 2) {
          continue;
        }
        this.spawnProjectile(index, pattern, index * 0.12);
      }
      return;
    }

    this.spawnProjectile(baseLane, pattern);
  }

  private spawnProjectile(
    laneIndex: number,
    pattern: BossAttackPattern,
    delay = 0,
  ): void {
    const projectile = this.projectiles.find((entry) => !entry.active);
    if (!projectile) {
      return;
    }

    projectile.id = this.projectileId += 1;
    projectile.active = true;
    projectile.laneIndex = laneIndex;
    projectile.laneX = this.config.world.laneCenters[laneIndex] ?? 0;
    projectile.width = this.config.boss.projectileWidth * (pattern === 'sweep' ? 0.86 : 1);
    projectile.telegraphTimer = this.config.boss.projectileTelegraphDuration + delay;
    projectile.impactTimer = this.config.boss.projectileImpactDuration;
    projectile.pattern = pattern;
    projectile.hitPlayer = false;
    projectile.impactSoundPlayed = false;
    projectile.mesh.visible = true;
    projectile.mesh.position.set(
      projectile.laneX,
      this.config.world.roadSurfaceY + 0.09,
      -17,
    );
    projectile.mesh.scale.set(projectile.width, 1, 30);
  }

  private deactivateProjectile(projectile: BossProjectileRecord): void {
    projectile.active = false;
    projectile.hitPlayer = false;
    projectile.impactSoundPlayed = false;
    projectile.telegraphTimer = 0;
    projectile.impactTimer = 0;
    projectile.mesh.visible = false;
    projectile.material.opacity = 0;
    projectile.mesh.position.set(0, this.config.world.roadSurfaceY + 0.09, 999);
  }

  private startRetreat(defeated: boolean): void {
    if (this.status === 'retreating' || this.status === 'defeated' || this.status === 'inactive') {
      return;
    }

    this.status = defeated ? 'defeated' : 'retreating';
    this.statusTimer = 0;
    this.attackTimer = 0;
    if (defeated) {
      this.pendingScoreBonus += this.config.boss.scoreBonusByLevel[this.level - 1] ?? 0;
    }
  }

  private resolvePhase(): BossPhase {
    const healthRatio = this.maxHealth > 0 ? this.health / this.maxHealth : 1;
    if (this.level >= 3 && healthRatio <= 0.42) {
      return 3;
    }
    if (this.level >= 2 && healthRatio <= 0.62) {
      return 2;
    }
    return this.level;
  }

  private pickAttackPattern(): BossAttackPattern {
    if (this.level >= 3 && this.phase >= 3 && Math.random() < 0.46) {
      return 'sweep';
    }
    if (this.level >= 2 && Math.random() < 0.48) {
      return 'lanePair';
    }
    return 'singleLane';
  }

  private getAttackWarningRatio(): number {
    const interval = (this.config.boss.projectileIntervalByLevel[this.level - 1] ?? 1.8) *
      (this.phase >= 3 ? 0.82 : this.phase >= 2 ? 0.92 : 1);
    return clamp(1 - this.attackTimer / Math.max(interval, 0.001), 0, 1);
  }

  private isVulnerable(): boolean {
    return this.status === 'approach' || this.status === 'fighting';
  }

  private getWeaponBossRange(weapon: WeaponKind): number {
    if (weapon === 'bazooka') {
      return this.config.bazooka.maxDistance;
    }
    if (weapon === 'shotgun') {
      return this.config.shotgun.range;
    }
    if (weapon === 'assaultRifle') {
      return this.config.assaultRifle.range;
    }
    return this.config.weapon.range;
  }

  private syncRemoteTelegraphs(snapshot: BossSnapshot): void {
    const activeIds = new Set(snapshot.activeTelegraphs.map((telegraph) => telegraph.id));
    for (const projectile of this.projectiles) {
      if (!activeIds.has(projectile.id)) {
        this.deactivateProjectile(projectile);
      }
    }

    for (const telegraph of snapshot.activeTelegraphs) {
      let projectile = this.projectiles.find((entry) => entry.id === telegraph.id);
      if (!projectile) {
        projectile = this.projectiles.find((entry) => !entry.active);
      }
      if (!projectile) {
        continue;
      }

      projectile.id = telegraph.id;
      projectile.active = true;
      projectile.laneIndex = telegraph.laneIndex;
      projectile.laneX = telegraph.laneX;
      projectile.width = telegraph.width;
      projectile.telegraphTimer =
        (1 - telegraph.warningRatio) * this.config.boss.projectileTelegraphDuration;
      projectile.impactTimer = this.config.boss.projectileImpactDuration;
      projectile.hitPlayer = true;
      projectile.mesh.visible = true;
    }
  }
}
