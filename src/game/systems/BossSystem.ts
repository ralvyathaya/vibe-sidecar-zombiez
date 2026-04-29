import {
  AdditiveBlending,
  BoxGeometry,
  Camera,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
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
  beamMesh: Mesh;
  beamMaterial: MeshBasicMaterial;
  blastMesh: Mesh;
  blastMaterial: MeshBasicMaterial;
  blastTimer: number;
  spawnNodeIndex: number;
};

type BossDamageResult = {
  damage: number;
  sourceX: number;
};

const HULL_GEOMETRY = new BoxGeometry(1, 1, 1);
const NOSE_GEOMETRY = new IcosahedronGeometry(1, 1);
const WEAKPOINT_GEOMETRY = new SphereGeometry(1, 14, 10);
const TELEGRAPH_GEOMETRY = new BoxGeometry(1, 0.06, 1);
const BEAM_GEOMETRY = new CylinderGeometry(1, 1, 1, 6, 1, true);
const BLAST_GEOMETRY = new SphereGeometry(1, 12, 8);
const Y_AXIS = new Vector3(0, 1, 0);

export class BossSystem {
  private readonly root = new Group();
  private readonly proceduralGroup = new Group();
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
  private readonly weakpointWorldPosition = new Vector3();
  private readonly projectileSpawnPosition = new Vector3();
  private readonly projectileTargetPosition = new Vector3();
  private readonly projectileMidpoint = new Vector3();
  private readonly projectileBeamDirection = new Vector3();
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
  private lastPreStrikeSoundTime = -99;
  private lastProjectileHitSoundTime = -99;
  private lastRemotePreStrikeId = 0;
  private remoteSnapshot: BossSnapshot | null = null;
  private remoteSnapshotTimer = 0;
  private modelRoot: Group | null = null;
  private rotorNodes: Object3D[] = [];
  private weakpointNodes: Object3D[] = [];
  private projectileSpawnNodes: Object3D[] = [];
  private readonly rotorBaseRotations = new Map<Object3D, { x: number; y: number; z: number }>();
  private warnedMissingNodes = false;

  constructor(
    private readonly scene: Scene,
    private readonly config: GameConfig,
  ) {
    this.root.name = 'ProceduralAirborneBoss';
    this.root.visible = false;
    this.proceduralGroup.name = 'BossProceduralFallback';
    this.root.add(this.proceduralGroup);
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
    this.proceduralGroup.add(this.hull);

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
    this.proceduralGroup.add(nose);

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
      this.proceduralGroup.add(wing);

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
      this.proceduralGroup.add(rotor);
      this.rotorNodes.push(rotor);
      this.rotorBaseRotations.set(rotor, {
        x: rotor.rotation.x,
        y: rotor.rotation.y,
        z: rotor.rotation.z,
      });
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
    this.proceduralGroup.add(this.weakpoint);
    this.weakpointNodes.push(this.weakpoint);
    this.root.add(this.keyLight);
    this.keyLight.position.set(0, -0.1, 3.4);

    this.scene.add(this.root);
    this.createProjectilePool();
    this.loadBossModel();
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
    this.lastPreStrikeSoundTime = -99;
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
      projectile.beamMesh.removeFromParent();
      projectile.blastMesh.removeFromParent();
      projectile.mesh.geometry.dispose();
      projectile.material.dispose();
      projectile.beamMaterial.dispose();
      projectile.blastMaterial.dispose();
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
    const weaponRange = this.getWeaponBossRange(weapon);
    if (!this.isCameraRayNearBossTarget(weaponRange, weapon)) {
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
      const beamMaterial = new MeshBasicMaterial({
        color: 0xff5632,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const beamMesh = new Mesh(BEAM_GEOMETRY, beamMaterial);
      beamMesh.name = `BossLaserBeam_${index}`;
      beamMesh.visible = false;
      this.scene.add(beamMesh);

      const blastMaterial = new MeshBasicMaterial({
        color: 0xffdf81,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const blastMesh = new Mesh(BLAST_GEOMETRY, blastMaterial);
      blastMesh.name = `BossLaneBlast_${index}`;
      blastMesh.visible = false;
      this.scene.add(blastMesh);
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
        beamMesh,
        beamMaterial,
        blastMesh,
        blastMaterial,
        blastTimer: 0,
        spawnNodeIndex: 0,
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
          projectile.blastTimer = this.config.boss.projectileImpactDuration;
          this.playProjectileHitSound();
        }
      } else {
        projectile.impactTimer = Math.max(0, projectile.impactTimer - deltaTime);
        projectile.blastTimer = Math.max(0, projectile.blastTimer - deltaTime);
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
    this.updateRotorPresentation();
    this.updateWeakpointPresentation(healthRatio, hitFlashRatio);

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
      this.updateProjectileBeam(projectile, telegraphRatio, impactActive);
      this.updateProjectileBlast(projectile);
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
    projectile.blastTimer = 0;
    projectile.spawnNodeIndex =
      this.projectileSpawnNodes.length > 0 ? projectile.id % this.projectileSpawnNodes.length : 0;
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
    projectile.beamMesh.visible = false;
    projectile.blastMesh.visible = false;
    projectile.material.opacity = 0;
    projectile.beamMaterial.opacity = 0;
    projectile.blastMaterial.opacity = 0;
    projectile.mesh.position.set(0, this.config.world.roadSurfaceY + 0.09, 999);
    projectile.beamMesh.position.set(0, 999, 0);
    projectile.blastMesh.position.set(0, 999, 0);
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

  private loadBossModel(): void {
    void import('three/examples/jsm/loaders/GLTFLoader.js')
      .then(({ GLTFLoader }) => {
        const loader = new GLTFLoader();
        loader.load(
          this.config.boss.assetPath,
          (gltf) => {
            const model = gltf.scene;
            model.name = 'HelicopterBossModel';
            model.position.set(...this.config.boss.modelPosition);
            model.rotation.set(
              this.degreesToRadians(this.config.boss.modelRotationDegrees[0]),
              this.degreesToRadians(this.config.boss.modelRotationDegrees[1]),
              this.degreesToRadians(this.config.boss.modelRotationDegrees[2]),
            );
            model.scale.setScalar(this.config.boss.modelScale);
            model.traverse((node) => {
              if (node instanceof Mesh) {
                node.castShadow = true;
                node.receiveShadow = true;
              }
            });
            this.root.add(model);
            this.modelRoot = model;
            this.bindBossModelNodes(model);
            this.proceduralGroup.visible = false;
          },
          undefined,
          (error) => {
            console.warn('[BossSystem] Failed to load helicopter boss model, using procedural fallback.', error);
          },
        );
      })
      .catch((error) => {
        console.warn('[BossSystem] Failed to initialize GLTFLoader for boss model.', error);
      });
  }

  private bindBossModelNodes(model: Object3D): void {
    this.rotorNodes = [];
    this.weakpointNodes = [];
    this.projectileSpawnNodes = [];
    this.rotorBaseRotations.clear();

    model.traverse((node) => {
      const name = node.name.toLowerCase();
      if (this.matchesAnyPattern(name, this.config.boss.rotorNodePatterns)) {
        this.rotorNodes.push(node);
        this.rotorBaseRotations.set(node, {
          x: node.rotation.x,
          y: node.rotation.y,
          z: node.rotation.z,
        });
      }
      if (this.matchesAnyPattern(name, this.config.boss.weakpointNodePatterns)) {
        this.weakpointNodes.push(node);
      }
      if (this.matchesAnyPattern(name, this.config.boss.projectileSpawnNodePatterns)) {
        this.projectileSpawnNodes.push(node);
      }
    });

    if (!this.warnedMissingNodes) {
      if (this.rotorNodes.length === 0) {
        console.warn('[BossSystem] No helicopter rotor nodes found; rotor animation disabled.');
      }
      if (this.weakpointNodes.length === 0) {
        console.warn('[BossSystem] No helicopter weakpoint nodes found; boss hit detection uses fallback center.');
        this.weakpointNodes.push(this.weakpoint);
      }
      if (this.projectileSpawnNodes.length === 0) {
        console.warn('[BossSystem] No helicopter projectile spawn nodes found; laser beams use boss center fallback.');
      }
      this.warnedMissingNodes = true;
    }
  }

  private matchesAnyPattern(name: string, patterns: string[]): boolean {
    return patterns.some((pattern) => name.includes(pattern.toLowerCase()));
  }

  private updateRotorPresentation(): void {
    const axis = this.config.boss.rotorSpinAxis;
    const spin = this.time * this.config.boss.rotorSpinSpeed;
    for (const rotor of this.rotorNodes) {
      const base = this.rotorBaseRotations.get(rotor);
      if (!base) {
        continue;
      }
      rotor.rotation.x = base.x;
      rotor.rotation.y = base.y;
      rotor.rotation.z = base.z;
      rotor.rotation[axis] = base[axis] + spin;
    }
  }

  private updateWeakpointPresentation(healthRatio: number, hitFlashRatio: number): void {
    if (!this.modelRoot) {
      return;
    }

    for (const node of this.weakpointNodes) {
      node.scale.setScalar(1 + (1 - healthRatio) * 0.16 + hitFlashRatio * 0.1 + Math.sin(this.time * 8) * 0.025);
      if (node instanceof Mesh && node.material instanceof MeshStandardMaterial) {
        node.material.emissive.setHex(0xff3c20);
        node.material.emissiveIntensity = 0.7 + (1 - healthRatio) * 1.1 + hitFlashRatio * 2.4;
      }
    }
  }

  private updateProjectileBeam(
    projectile: BossProjectileRecord,
    telegraphRatio: number,
    impactActive: boolean,
  ): void {
    this.getProjectileSpawnWorldPosition(projectile);
    this.projectileTargetPosition.set(
      projectile.mesh.position.x,
      this.config.world.roadSurfaceY + 0.34,
      projectile.mesh.position.z,
    );
    this.projectileBeamDirection.copy(this.projectileTargetPosition).sub(this.projectileSpawnPosition);
    const length = this.projectileBeamDirection.length();
    if (length <= 0.001) {
      projectile.beamMesh.visible = false;
      return;
    }

    this.projectileBeamDirection.multiplyScalar(1 / length);
    this.projectileMidpoint
      .copy(this.projectileSpawnPosition)
      .add(this.projectileTargetPosition)
      .multiplyScalar(0.5);
    projectile.beamMesh.visible = true;
    projectile.beamMesh.position.copy(this.projectileMidpoint);
    projectile.beamMesh.quaternion.setFromUnitVectors(Y_AXIS, this.projectileBeamDirection);
    const beamWidth = this.config.boss.laserBeamWidth * (impactActive ? 1.35 : 1);
    projectile.beamMesh.scale.set(beamWidth, length, beamWidth);
    projectile.beamMaterial.color.setHex(impactActive ? 0xffe59a : 0xff503a);
    projectile.beamMaterial.opacity = impactActive
      ? 0.62 * clamp(projectile.impactTimer / this.config.boss.projectileImpactDuration, 0, 1)
      : 0.16 + telegraphRatio * 0.34;
  }

  private updateProjectileBlast(projectile: BossProjectileRecord): void {
    if (projectile.blastTimer <= 0) {
      projectile.blastMesh.visible = false;
      projectile.blastMaterial.opacity = 0;
      return;
    }

    const ratio = clamp(projectile.blastTimer / this.config.boss.projectileImpactDuration, 0, 1);
    const expansion = 1 - ratio;
    projectile.blastMesh.visible = true;
    projectile.blastMesh.position.set(
      projectile.mesh.position.x,
      this.config.world.roadSurfaceY + 0.28,
      projectile.mesh.position.z,
    );
    projectile.blastMesh.scale.set(
      this.config.boss.blastSize * (0.45 + expansion * 1.45),
      this.config.boss.blastSize * (0.18 + expansion * 0.35),
      this.config.boss.blastSize * (0.45 + expansion * 1.45),
    );
    projectile.blastMaterial.opacity = 0.58 * ratio;
  }

  private getProjectileSpawnWorldPosition(projectile: BossProjectileRecord): void {
    const spawnNode = this.projectileSpawnNodes[projectile.spawnNodeIndex];
    if (spawnNode) {
      spawnNode.getWorldPosition(this.projectileSpawnPosition);
      return;
    }

    this.root.getWorldPosition(this.projectileSpawnPosition);
    this.projectileSpawnPosition.y -= 0.7;
    this.projectileSpawnPosition.z += 2.2;
  }

  private isCameraRayNearBossTarget(range: number, weapon: WeaponKind): boolean {
    const weakpointRadius = this.config.boss.hitRadius * (weapon === 'shotgun' ? 0.72 : 0.52);
    for (const node of this.weakpointNodes) {
      node.getWorldPosition(this.weakpointWorldPosition);
      if (this.isRayNearPoint(this.weakpointWorldPosition, range, weakpointRadius)) {
        return true;
      }
    }

    this.root.getWorldPosition(this.bossCenter);
    const bodyRadius = this.config.boss.hitRadius * (weapon === 'shotgun' ? 1.1 : 0.78);
    return this.isRayNearPoint(this.bossCenter, range, bodyRadius);
  }

  private isRayNearPoint(point: Vector3, range: number, radius: number): boolean {
    this.toBoss.copy(point).sub(this.rayOrigin);
    const projectedDistance = this.toBoss.dot(this.rayDirection);
    if (projectedDistance < 0 || projectedDistance > range) {
      return false;
    }

    this.closestPoint.copy(this.rayOrigin).addScaledVector(this.rayDirection, projectedDistance);
    return this.closestPoint.distanceToSquared(point) <= radius * radius;
  }

  private degreesToRadians(value: number): number {
    return (value * Math.PI) / 180;
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
      const wasKnownActive = Boolean(projectile?.active);
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
      if (telegraph.warningRatio >= 1 && !projectile.impactSoundPlayed) {
        projectile.blastTimer = this.config.boss.projectileImpactDuration;
      }
      projectile.impactSoundPlayed = telegraph.warningRatio >= 1;
      projectile.mesh.visible = true;
      if (!wasKnownActive && telegraph.id > this.lastRemotePreStrikeId) {
        this.lastRemotePreStrikeId = telegraph.id;
        this.playPreStrikeSound();
      }
    }
  }

  private playPreStrikeSound(): void {
    if (this.time - this.lastPreStrikeSoundTime < 0.12) {
      return;
    }

    this.lastPreStrikeSoundTime = this.time;
    this.preStrikeSound.play(this.config.boss.audio.preStrikeVolume, 1);
  }

  private playProjectileHitSound(): void {
    if (this.time - this.lastProjectileHitSoundTime < 0.08) {
      return;
    }

    this.lastProjectileHitSoundTime = this.time;
    this.projectileHitSound.play(this.config.boss.audio.projectileHitVolume, 1);
  }
}
