import {
  AdditiveBlending,
  Box3,
  BoxGeometry,
  Camera,
  Color,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  PointLight,
  Raycaster,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three';
import type { GameConfig, RewardEvent, WeaponStatus } from '../../core/types';
import { approach, clamp, randomRange } from '../../core/utils';
import { SoundEffectPool } from '../audio/SoundEffectPool';
import type { EnemySystem } from '../systems/EnemySystem';
import type { InputSystem } from '../systems/InputSystem';
import type { PlayerSystem } from '../systems/PlayerSystem';
import type { RewardSystem } from '../systems/RewardSystem';
import type { WorldSystem } from '../systems/WorldSystem';

const EFFECT_FORWARD_AXIS = new Vector3(1, 0, 0);

type PelletStreak = {
  group: Group;
  beam: Mesh;
  glow: Mesh;
  active: boolean;
  life: number;
  maxLife: number;
  direction: Vector3;
  speed: number;
};

type ImpactBurst = {
  group: Group;
  core: Mesh;
  streakA: Mesh;
  streakB: Mesh;
  active: boolean;
  life: number;
  maxLife: number;
};

export class ShotgunWeapon {
  private readonly viewmodelRoot = new Group();
  private readonly contentRoot = new Group();
  private readonly worldEffectsRoot = new Group();
  private readonly muzzleAnchor = new Group();
  private readonly pelletStreaks: PelletStreak[] = [];
  private readonly impactBursts: ImpactBurst[] = [];
  private readonly spreadCrosshair = new Vector2();
  private readonly pelletRaycaster = new Raycaster();
  private readonly pelletDirection = new Vector3();
  private readonly muzzleWorld = new Vector3();
  private readonly playerPosition = new Vector3();
  private readonly pelletBurstTarget = new Vector3();
  private readonly pelletBurstDirection = new Vector3();
  private readonly muzzleForwardWorld = new Vector3();
  private readonly muzzleForwardPoint = new Vector3();
  private readonly muzzleFlash = new Group();
  private readonly muzzleFlashCoreMaterial = new MeshBasicMaterial({
    color: 0xffd78f,
    transparent: true,
    opacity: 0.95,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  private readonly muzzleFlashStreakMaterial = new MeshBasicMaterial({
    color: 0xff9652,
    transparent: true,
    opacity: 0.88,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  private readonly muzzleFlashCore = new Mesh(
    new OctahedronGeometry(1, 0),
    this.muzzleFlashCoreMaterial,
  );
  private readonly muzzleFlashStreak = new Mesh(
    new BoxGeometry(1, 0.3, 0.3),
    this.muzzleFlashStreakMaterial,
  );
  private readonly muzzleFlashSpriteMaterial = new SpriteMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  private readonly muzzleFlashSprite = new Sprite(this.muzzleFlashSpriteMaterial);
  private readonly muzzleBlastPetals: Mesh[] = [];
  private readonly muzzleLight = new PointLight(0xffb464, 0, 7.5, 2);
  private readonly viewmodelKeyLight = new PointLight(0xffcd99, 0.14, 2.4, 2);
  private readonly viewmodelFillLight = new PointLight(0xdccfbd, 0.02, 1.6, 2);
  private readonly gunshotSound: SoundEffectPool;
  private readonly delaySound: SoundEffectPool;
  private readonly basePosition: Vector3;
  private readonly baseRotation = new Vector3();

  private loadedScene: Object3D | null = null;
  private gunshotTimingProbe: HTMLAudioElement | null = null;
  private delayTimingProbe: HTMLAudioElement | null = null;
  private resolvedGunshotDuration = 0;
  private cooldown = 0;
  private ammo = 0;
  private muzzleFlashTimer = 0;
  private hitConfirmTimer = 0;
  private fireKick = 0;
  private pumpOffset = 0;
  private pumpDelayTimer = 0;
  private spinTimer = 0;
  private resolvedSpinDuration = 0;
  private activeSpinDuration = 0;
  private cycleActive = false;
  private pendingDelaySound = false;

  constructor(
    private readonly camera: Camera,
    private readonly config: GameConfig,
  ) {
    const [rotX, rotY, rotZ] = this.config.shotgun.viewmodel.rotationDegrees;
    this.basePosition = new Vector3(...this.config.shotgun.viewmodel.position);
    this.baseRotation.set(
      MathUtils.degToRad(rotX),
      MathUtils.degToRad(rotY),
      MathUtils.degToRad(rotZ),
    );
    this.gunshotSound = new SoundEffectPool(this.config.shotgun.audio.gunshotPath, {
      poolSize: 3,
      volume: this.config.shotgun.audio.gunshotVolume,
    });
    this.delaySound = new SoundEffectPool(this.config.shotgun.audio.delayPath, {
      poolSize: 3,
      volume: this.config.shotgun.audio.delayVolume,
    });
    this.gunshotSound.prime();
    this.delaySound.prime();
    this.resolvedSpinDuration = this.config.shotgun.viewmodel.spinDuration;
    this.activeSpinDuration = this.config.shotgun.viewmodel.spinDuration;

    this.viewmodelRoot.name = 'ShotgunViewmodel';
    this.contentRoot.name = 'ShotgunContentRoot';
    this.worldEffectsRoot.name = 'ShotgunWorldEffects';
    this.muzzleAnchor.name = 'ShotgunMuzzleAnchor';

    this.muzzleFlashCore.renderOrder = 14;
    this.muzzleFlashStreak.renderOrder = 14;
    this.muzzleFlashSprite.renderOrder = 15;
    this.muzzleFlashCore.position.x = -0.18;
    this.muzzleFlashStreak.position.x = -0.82;
    this.muzzleFlashSprite.position.set(-0.12, 0, 0);
    this.muzzleFlashSprite.center.set(0.12, 0.5);
    this.muzzleFlash.add(
      this.muzzleFlashSprite,
      this.muzzleFlashCore,
      this.muzzleFlashStreak,
      this.muzzleLight,
    );
    this.createMuzzleBlastPetals();
    this.createPelletStreakPool();
    this.createImpactBurstPool();
    this.muzzleFlash.visible = false;
    this.viewmodelKeyLight.position.set(0.2, 0.08, 0.28);
    this.viewmodelFillLight.position.set(-0.08, 0.05, 0.18);
    // Keep the shotgun flash anchored to the real muzzle tip so the sprite,
    // the blast meshes, and the pellet feedback all originate from one place.
    this.muzzleAnchor.add(this.muzzleFlash);
    this.contentRoot.add(
      this.viewmodelKeyLight,
      this.viewmodelFillLight,
      this.muzzleAnchor,
    );
    this.viewmodelRoot.add(this.contentRoot);
    this.camera.add(this.viewmodelRoot);
    this.camera.parent?.add(this.worldEffectsRoot);
    this.worldEffectsRoot.visible = false;

    this.applyViewmodelPose();
    this.setEquipped(false);
    this.preloadGunshotTiming();
    this.preloadDelayTiming();
    void this.loadMuzzleFlashSprite();
    void this.loadViewmodel();
  }

  reset(): void {
    this.cooldown = 0;
    this.ammo = 0;
    this.muzzleFlashTimer = 0;
    this.hitConfirmTimer = 0;
    this.fireKick = 0;
    this.pumpOffset = 0;
    this.pumpDelayTimer = 0;
    this.spinTimer = 0;
    this.activeSpinDuration = this.resolvedSpinDuration;
    this.cycleActive = false;
    this.pendingDelaySound = false;
    this.muzzleFlash.visible = false;
    this.muzzleLight.intensity = 0;
    this.muzzleFlashSpriteMaterial.opacity = 0;
    this.gunshotSound.stopAll();
    this.delaySound.stopAll();
    this.clearPelletStreaks();
    this.clearImpactBursts();
    this.worldEffectsRoot.visible = false;
    this.setMuzzleBlastOpacity(0);
    this.applyViewmodelPose();
  }

  setEquipped(equipped: boolean): void {
    this.viewmodelRoot.visible = equipped;
    this.worldEffectsRoot.visible = equipped;
    if (equipped) {
      return;
    }

    this.cooldown = 0;
    this.delaySound.stopAll();
    this.muzzleFlash.visible = false;
    this.muzzleLight.intensity = 0;
    this.muzzleFlashSpriteMaterial.opacity = 0;
    this.pumpOffset = 0;
    this.pumpDelayTimer = 0;
    this.spinTimer = 0;
    this.activeSpinDuration = this.resolvedSpinDuration;
    this.cycleActive = false;
    this.pendingDelaySound = false;
    this.clearPelletStreaks();
    this.clearImpactBursts();
    this.worldEffectsRoot.visible = false;
    this.setMuzzleBlastOpacity(0);
    this.applyViewmodelPose();
  }

  setAmmo(ammo: number): number {
    this.ammo = clamp(ammo, 0, this.config.shotgun.maxAmmo);
    return this.ammo;
  }

  addAmmo(amount: number): number {
    return this.setAmmo(this.ammo + amount);
  }

  getAmmo(): number {
    return this.ammo;
  }

  playEquipIntro(): void {
    if (!this.viewmodelRoot.visible) {
      return;
    }

    this.pendingDelaySound = false;
    this.cycleActive = true;
    this.pumpDelayTimer = 0;
    this.pumpOffset = 0.42;
    this.spinTimer = this.resolvedSpinDuration;
    this.activeSpinDuration = this.resolvedSpinDuration;
    this.cooldown = Math.max(this.cooldown, this.resolvedSpinDuration + 0.08);
    this.fireKick = Math.max(this.fireKick, 0.28);
    this.delaySound.play(this.config.shotgun.audio.delayVolume, 1);
  }

  isCycling(): boolean {
    return this.cycleActive || this.pendingDelaySound || this.pumpDelayTimer > 0 || this.spinTimer > 0;
  }

  updateRunning(
    deltaTime: number,
    input: InputSystem,
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
    rewards: RewardSystem,
  ): void {
    this.cooldown = Math.max(0, this.cooldown - deltaTime);
    this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - deltaTime);
    input.consumeReloadPressed();

    if (
      input.isFireHeld() &&
      this.cooldown <= 0 &&
      this.ammo > 0 &&
      !this.isCycling()
    ) {
      this.fire(player, enemies, world, rewards);
    }

    this.updatePelletStreaks(deltaTime);
    this.updateImpactBursts(deltaTime);
    this.updatePresentation(deltaTime);
  }

  updateIdle(deltaTime: number): void {
    this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - deltaTime);
    this.updatePelletStreaks(deltaTime);
    this.updateImpactBursts(deltaTime);
    this.updatePresentation(deltaTime);
  }

  getStatus(): WeaponStatus {
    return {
      weaponType: 'shotgun',
      weaponLabel: 'Shotgun',
      ammoInMagazine: this.ammo,
      magazineSize: this.config.shotgun.maxAmmo,
      reloading: false,
      reloadProgress: 0,
      reserveAmmoText: '',
      showReserve: false,
      showReloadHint: false,
      roundStyle: 'shell',
      hitConfirm: this.hitConfirmTimer,
      crosshairStyle: 'shotgun',
      crosshairGap: this.getCrosshairGap(),
      crosshairKick: this.fireKick,
      canReload: false,
    };
  }

  destroy(): void {
    this.camera.remove(this.viewmodelRoot);
    this.worldEffectsRoot.removeFromParent();
    this.disposeObject(this.loadedScene);
    this.disposePelletStreakPool();
    this.disposeImpactBurstPool();
    for (const petal of this.muzzleBlastPetals) {
      petal.geometry.dispose();
      (petal.material as MeshBasicMaterial).dispose();
    }
    this.muzzleFlashCore.geometry.dispose();
    this.muzzleFlashStreak.geometry.dispose();
    this.muzzleFlashCoreMaterial.dispose();
    this.muzzleFlashStreakMaterial.dispose();
    this.muzzleFlashSpriteMaterial.map?.dispose();
    this.muzzleFlashSpriteMaterial.dispose();
    this.gunshotSound.destroy();
    this.delaySound.destroy();
    this.disposeGunshotTimingProbe();
    this.disposeDelayTimingProbe();
  }

  private async loadViewmodel(): Promise<void> {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(this.config.shotgun.viewmodel.assetPath);
      this.mountModel(gltf.scene);
    } catch (error) {
      console.warn('Failed to load shotgun GLB, using fallback viewmodel.', error);
      this.mountModel(this.createEmergencyFallbackModel());
    }
  }

  private mountModel(model: Object3D): void {
    if (this.loadedScene) {
      this.contentRoot.remove(this.loadedScene);
      this.disposeObject(this.loadedScene);
    }

    this.prepareModel(model);
    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const gripPivot = new Vector3(
      center.x + size.x * 0.1,
      box.min.y + size.y * 0.32,
      center.z,
    );

    model.position.set(-gripPivot.x, -gripPivot.y, -gripPivot.z);
    this.contentRoot.add(model);
    this.loadedScene = model;

    const muzzlePosition = new Vector3(
      box.min.x + size.x * 0.01,
      box.min.y + size.y * 0.595,
      center.z,
    ).sub(gripPivot);
    const [muzzleOffsetX, muzzleOffsetY, muzzleOffsetZ] = this.config.shotgun.viewmodel.muzzleOffset;
    muzzlePosition.x += muzzleOffsetX;
    muzzlePosition.y += muzzleOffsetY;
    muzzlePosition.z += muzzleOffsetZ;
    this.muzzleAnchor.position.copy(muzzlePosition);

    this.applyViewmodelPose();
  }

  private prepareModel(model: Object3D): void {
    model.traverse((object) => {
      object.frustumCulled = false;
      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.renderOrder = 10;
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];
      for (const material of materials) {
        const litMaterial = material as Partial<MeshStandardMaterial> & {
          color?: Color;
        };

        if ('depthWrite' in litMaterial) {
          litMaterial.depthWrite = true;
        }

        if (litMaterial.color instanceof Color) {
          litMaterial.color.multiply(new Color(0.8, 0.77, 0.73));
        }

        if (typeof litMaterial.roughness === 'number') {
          litMaterial.roughness = Math.max(litMaterial.roughness, 0.94);
        }

        if (typeof litMaterial.metalness === 'number') {
          litMaterial.metalness = Math.min(litMaterial.metalness, 0.05);
        }
      }
    });
  }

  private fire(
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
    rewards: RewardSystem,
  ): void {
    const visualPelletIndices = this.getRepresentativePelletIndices();

    this.activeSpinDuration = this.resolvedSpinDuration;
    this.cooldown = this.getCycleDuration();
    this.ammo = Math.max(0, this.ammo - 1);
    this.cycleActive = true;
    this.pendingDelaySound = true;
    this.muzzleFlashTimer = this.config.shotgun.viewmodel.muzzleFlashDuration;
    this.muzzleFlash.visible = true;
    this.fireKick = 1.25;
    this.pumpOffset = 1;
    this.pumpDelayTimer = this.getPumpDelayAfterShot();
    this.spinTimer = 0;
    player.applyRecoil(this.config.shotgun.cameraKick);
    this.gunshotSound.play(
      this.config.shotgun.audio.gunshotVolume,
      1,
    );
    this.randomizeMuzzleFlash();
    this.muzzleAnchor.getWorldPosition(this.muzzleWorld);

    const rewardEvents: RewardEvent[] = [];
    const latchedKill = enemies.hasLatchedRunner()
      ? enemies.damageLatchedRunner(
          this.config.shotgun.damagePerPellet + this.config.ride.latchShotgunBonusDamage,
        )
      : null;
    if (latchedKill) {
      this.hitConfirmTimer = 0.14;
      this.spawnImpactBurst(this.muzzleWorld);
      rewardEvents.push({
        baseScore: latchedKill.baseScore,
        weaponType: 'shotgun',
        zombieType: latchedKill.zombieType,
        killCount: 1,
        wasExplosive: false,
        distanceToPlayer: player.getPosition(this.playerPosition).distanceTo(latchedKill.position),
      });
    }

    for (let pelletIndex = 0; pelletIndex < this.config.shotgun.pelletsPerShot; pelletIndex += 1) {
      this.samplePelletScreenPoint(pelletIndex, this.config.shotgun.pelletsPerShot);
      this.pelletRaycaster.setFromCamera(this.spreadCrosshair, this.camera);
      this.pelletDirection.copy(this.pelletRaycaster.ray.direction);

      const hitZombie = enemies.raycast(this.camera, this.spreadCrosshair, this.config.shotgun.range);
      const hitBarrel = world.raycast(this.camera, this.spreadCrosshair, this.config.shotgun.range);
      const hitEnemyFirst =
        hitZombie &&
        (!hitBarrel || hitZombie.distance <= hitBarrel.distance);

      if (visualPelletIndices.has(pelletIndex)) {
        // The burst uses the same sampled screen-space spread as the actual pellet
        // hit logic, but converts it into a muzzle-originating direction so the
        // visible blast opens outward as a fan from the barrel.
        const visibleLength = randomRange(
          this.config.shotgun.pelletTraceMinLength,
          this.config.shotgun.pelletTraceMaxLength,
        );
        this.resolvePelletBurstDirection();
        this.spawnPelletStreak(this.muzzleWorld, this.pelletBurstDirection, visibleLength);
      }

      if (hitEnemyFirst && hitZombie) {
        const kill = enemies.damage(
          hitZombie.zombie,
          this.config.shotgun.damagePerPellet,
          hitZombie.point,
        );
        this.hitConfirmTimer = 0.12;
        this.spawnImpactBurst(hitZombie.point);
        if (kill) {
          rewardEvents.push({
            baseScore: kill.baseScore,
            weaponType: 'shotgun' as const,
            zombieType: kill.zombieType,
            killCount: 1,
            wasExplosive: false,
            distanceToPlayer: player.getPosition(this.playerPosition).distanceTo(kill.position),
          });
        }
        continue;
      }

      if (hitBarrel) {
        const kills = world.triggerBarrelExplosion(hitBarrel.obstacle, enemies);
        this.hitConfirmTimer = 0.1;
        this.spawnImpactBurst(hitBarrel.point);
        if (kills.length > 0) {
          const playerPosition = player.getPosition(this.playerPosition);
          for (const kill of kills) {
            rewardEvents.push({
              baseScore: kill.baseScore,
              weaponType: 'shotgun' as const,
              zombieType: kill.zombieType,
              killCount: kills.length,
              wasExplosive: true,
              distanceToPlayer: playerPosition.distanceTo(kill.position),
            });
          }
        }
        continue;
      }
    }

    if (rewardEvents.length > 0) {
      player.state.score += rewards.registerKills(rewardEvents);
    }
  }

  private resolvePelletBurstDirection(): void {
    this.muzzleForwardPoint.set(1, 0, 0);
    this.muzzleAnchor.localToWorld(this.muzzleForwardPoint);
    this.muzzleForwardWorld
      .copy(this.muzzleForwardPoint)
      .sub(this.muzzleWorld);

    if (this.muzzleForwardWorld.lengthSq() > 0.000001) {
      this.muzzleForwardWorld.normalize();
    } else {
      this.muzzleForwardWorld.copy(this.pelletDirection);
    }

    const burstAimDistance = clamp(
      this.config.shotgun.pelletTraceMaxLength * 0.22,
      4.2,
      7.2,
    );
    this.pelletBurstTarget
      .copy(this.pelletRaycaster.ray.origin)
      .addScaledVector(this.pelletDirection, burstAimDistance);

    this.pelletBurstDirection
      .copy(this.pelletBurstTarget)
      .sub(this.muzzleWorld);

    if (this.pelletBurstDirection.lengthSq() <= 0.000001) {
      this.pelletBurstDirection.copy(this.muzzleForwardWorld);
      return;
    }

    this.pelletBurstDirection.normalize();
  }

  private getRepresentativePelletIndices(): Set<number> {
    const pelletCount = this.config.shotgun.pelletsPerShot;
    const visualCount = clamp(this.config.shotgun.pelletVisualCount, 0, pelletCount);
    const selected = new Set<number>();
    if (visualCount <= 0) {
      return selected;
    }

    if (visualCount === 1) {
      selected.add(Math.floor((pelletCount - 1) * 0.5));
      return selected;
    }

    for (let visualIndex = 0; visualIndex < visualCount; visualIndex += 1) {
      const pelletIndex = Math.round(
        (visualIndex / (visualCount - 1)) * (pelletCount - 1),
      );
      selected.add(pelletIndex);
    }

    return selected;
  }

  private updatePresentation(deltaTime: number): void {
    this.fireKick = approach(this.fireKick, 0, deltaTime * this.config.shotgun.viewmodel.recoilRecovery);

    if (this.pumpDelayTimer > 0) {
      this.pumpDelayTimer = Math.max(0, this.pumpDelayTimer - deltaTime);
      this.pumpOffset = 1;
      if (this.pumpDelayTimer <= 0 && this.pendingDelaySound) {
        this.spinTimer = this.activeSpinDuration;
        this.pendingDelaySound = false;
        this.delaySound.play(
          this.config.shotgun.audio.delayVolume,
          1,
        );
      }
    } else {
      this.pumpOffset = approach(
        this.pumpOffset,
        0,
        deltaTime * this.config.shotgun.viewmodel.pumpRecovery,
      );
    }

    if (this.spinTimer > 0) {
      this.spinTimer = Math.max(0, this.spinTimer - deltaTime);
    }

    if (
      this.cycleActive &&
      !this.pendingDelaySound &&
      this.pumpDelayTimer <= 0 &&
      this.spinTimer <= 0
    ) {
      this.cycleActive = false;
    }

    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - deltaTime);
      const flashAlpha = this.muzzleFlashTimer / this.config.shotgun.viewmodel.muzzleFlashDuration;
      this.muzzleFlashSpriteMaterial.opacity = 1 * flashAlpha;
      this.muzzleFlashCoreMaterial.opacity = 0.76 * flashAlpha;
      this.muzzleFlashStreakMaterial.opacity = 0.88 * flashAlpha;
      this.setMuzzleBlastOpacity(1 * flashAlpha);
      this.muzzleLight.intensity = 8.4 * flashAlpha;
      this.muzzleFlash.visible = flashAlpha > 0.01;
    } else {
      this.muzzleFlash.visible = false;
      this.muzzleLight.intensity = 0;
      this.muzzleFlashSpriteMaterial.opacity = 0;
      this.setMuzzleBlastOpacity(0);
    }

    this.applyViewmodelPose();
  }

  private preloadDelayTiming(): void {
    if (this.delayTimingProbe) {
      return;
    }

    const probe = new Audio();
    probe.preload = 'metadata';
    probe.crossOrigin = 'anonymous';
    this.delayTimingProbe = probe;

    const cleanup = () => {
      probe.removeEventListener('loadedmetadata', handleMetadata);
      probe.removeEventListener('error', handleError);
      if (this.delayTimingProbe === probe) {
        this.delayTimingProbe = null;
      }
    };

    const handleMetadata = () => {
      if (Number.isFinite(probe.duration) && probe.duration > 0) {
        this.resolvedSpinDuration = clamp(probe.duration, 0.32, 0.6);
        if (this.pumpDelayTimer <= 0 && this.spinTimer <= 0) {
          this.activeSpinDuration = this.resolvedSpinDuration;
        }
      }
      cleanup();
    };

    const handleError = () => {
      cleanup();
    };

    probe.addEventListener('loadedmetadata', handleMetadata);
    probe.addEventListener('error', handleError);
    probe.src = this.config.shotgun.audio.delayPath;
    probe.load();
  }

  private preloadGunshotTiming(): void {
    if (this.gunshotTimingProbe) {
      return;
    }

    const probe = new Audio();
    probe.preload = 'metadata';
    probe.crossOrigin = 'anonymous';
    this.gunshotTimingProbe = probe;

    const cleanup = () => {
      probe.removeEventListener('loadedmetadata', handleMetadata);
      probe.removeEventListener('error', handleError);
      if (this.gunshotTimingProbe === probe) {
        this.gunshotTimingProbe = null;
      }
    };

    const handleMetadata = () => {
      if (Number.isFinite(probe.duration) && probe.duration > 0) {
        this.resolvedGunshotDuration = probe.duration;
      }
      cleanup();
    };

    const handleError = () => {
      cleanup();
    };

    probe.addEventListener('loadedmetadata', handleMetadata);
    probe.addEventListener('error', handleError);
    probe.src = this.config.shotgun.audio.gunshotPath;
    probe.load();
  }

  private disposeGunshotTimingProbe(): void {
    if (!this.gunshotTimingProbe) {
      return;
    }

    this.gunshotTimingProbe.removeAttribute('src');
    this.gunshotTimingProbe.load();
    this.gunshotTimingProbe = null;
  }

  private disposeDelayTimingProbe(): void {
    if (!this.delayTimingProbe) {
      return;
    }

    this.delayTimingProbe.removeAttribute('src');
    this.delayTimingProbe.load();
    this.delayTimingProbe = null;
  }

  private getCycleDuration(): number {
    return this.getPumpDelayAfterShot() + this.activeSpinDuration;
  }

  private getPumpDelayAfterShot(): number {
    const minimumDelay = this.config.shotgun.viewmodel.pumpDelay;
    if (this.resolvedGunshotDuration <= 0) {
      return minimumDelay;
    }

    return Math.max(
      minimumDelay,
      Math.min(this.resolvedGunshotDuration + 0.02, 0.26),
    );
  }

  private async loadMuzzleFlashSprite(): Promise<void> {
    try {
      const texture = await new TextureLoader().loadAsync(
        this.config.shotgun.viewmodel.muzzleFlashSpritePath,
      );
      texture.generateMipmaps = false;
      this.muzzleFlashSpriteMaterial.map = texture;
      this.muzzleFlashSpriteMaterial.needsUpdate = true;
    } catch (error) {
      console.warn('Failed to load shotgun muzzle flash sprite.', error);
    }
  }

  // The shotgun UI bracket width is derived from the same spread value used by pellets,
  // so crosshair tuning and gameplay spread stay visually honest.
  private getCurrentSpread(): number {
    return this.config.shotgun.spread + this.fireKick * this.config.shotgun.spreadKick;
  }

  private getCrosshairGap(): number {
    return clamp(14 + this.getCurrentSpread() * 980, 30, 52);
  }

  private getCrosshairBracketWidth(gap: number): number {
    return 8 + gap * 0.16;
  }

  private getCrosshairBracketHeight(gap: number): number {
    return 18 + gap * 0.7;
  }

  private createMuzzleBlastPetals(): void {
    for (let index = 0; index < 8; index += 1) {
      const material = new MeshBasicMaterial({
        color: index % 2 === 0 ? 0xffd189 : 0xff9c54,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      const petal = new Mesh(new BoxGeometry(1, 0.14, 0.14), material);
      petal.renderOrder = 14;
      petal.visible = false;
      this.muzzleBlastPetals.push(petal);
      this.muzzleFlash.add(petal);
    }
  }

  private setMuzzleBlastOpacity(alpha: number): void {
    for (const petal of this.muzzleBlastPetals) {
      petal.visible = alpha > 0.01;
      (petal.material as MeshBasicMaterial).opacity = alpha;
    }
  }

  private createPelletStreakPool(): void {
    for (let index = 0; index < 12; index += 1) {
      const beamMaterial = new MeshBasicMaterial({
        color: 0xfff2cf,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      const glowMaterial = new MeshBasicMaterial({
        color: 0xffad63,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      });
      const beam = new Mesh(new BoxGeometry(1, 1, 1), beamMaterial);
      const glow = new Mesh(new BoxGeometry(1, 1, 1), glowMaterial);
      beam.renderOrder = 13;
      glow.renderOrder = 12;
      const group = new Group();
      group.visible = false;
      group.add(glow, beam);
      this.worldEffectsRoot.add(group);
      this.pelletStreaks.push({
        group,
        beam,
        glow,
        active: false,
        life: 0,
        maxLife: 0,
        direction: new Vector3(),
        speed: 0,
      });
    }
  }

  private createImpactBurstPool(): void {
    for (let index = 0; index < 18; index += 1) {
      const coreMaterial = new MeshBasicMaterial({
        color: 0xffd08d,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const streakMaterial = new MeshBasicMaterial({
        color: 0xff8d54,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const core = new Mesh(new OctahedronGeometry(0.08, 0), coreMaterial);
      const streakA = new Mesh(new BoxGeometry(0.3, 0.03, 0.03), streakMaterial);
      const streakB = new Mesh(new BoxGeometry(0.3, 0.03, 0.03), streakMaterial.clone());
      const group = new Group();
      group.visible = false;
      group.add(core, streakA, streakB);
      this.worldEffectsRoot.add(group);
      this.impactBursts.push({
        group,
        core,
        streakA,
        streakB,
        active: false,
        life: 0,
        maxLife: 0,
      });
    }
  }

  private spawnPelletStreak(start: Vector3, direction: Vector3, length: number): void {
    const streak = this.pelletStreaks.find((entry) => !entry.active);
    if (!streak || length <= 0.05) {
      return;
    }

    streak.active = true;
    streak.life = this.config.shotgun.pelletTraceDuration;
    streak.maxLife = this.config.shotgun.pelletTraceDuration;
    streak.direction.set(0, 0, 0);
    streak.speed = 0;
    streak.group.visible = true;
    // Start slightly forward from the muzzle tip so the burst reads from the
    // barrel itself and stays out of the player's face.
    streak.group.position
      .copy(start)
      .addScaledVector(direction, this.config.shotgun.pelletTraceMuzzleForward);
    streak.group.quaternion.setFromUnitVectors(EFFECT_FORWARD_AXIS, direction);
    streak.beam.position.set(length * 0.5, 0, 0);
    streak.glow.position.set(length * 0.5, 0, 0);
    streak.beam.scale.set(length, 0.09, 0.09);
    streak.glow.scale.set(length, 0.24, 0.24);
    (streak.beam.material as MeshBasicMaterial).opacity = 1;
    (streak.glow.material as MeshBasicMaterial).opacity = 0.5;
  }

  private spawnImpactBurst(position: Vector3): void {
    const burst = this.impactBursts.find((entry) => !entry.active);
    if (!burst) {
      return;
    }

    burst.active = true;
    burst.life = 0.08;
    burst.maxLife = 0.08;
    burst.group.visible = true;
    burst.group.position.copy(position);
    burst.group.rotation.set(
      randomRange(-0.5, 0.5),
      randomRange(-0.5, 0.5),
      randomRange(0, Math.PI * 2),
    );
    burst.core.scale.setScalar(randomRange(0.85, 1.3));
    burst.streakA.rotation.z = randomRange(-0.5, 0.5);
    burst.streakB.rotation.z = burst.streakA.rotation.z + Math.PI * 0.5;
    (burst.core.material as MeshBasicMaterial).opacity = 0.8;
    (burst.streakA.material as MeshBasicMaterial).opacity = 0.52;
    (burst.streakB.material as MeshBasicMaterial).opacity = 0.52;
  }

  private updatePelletStreaks(deltaTime: number): void {
    const scrollDistance = this.config.player.forwardSpeed * deltaTime;

    for (const streak of this.pelletStreaks) {
      if (!streak.active) {
        continue;
      }

      streak.life -= deltaTime;
      streak.group.position.z += scrollDistance;
      if (streak.life <= 0) {
        this.deactivatePelletStreak(streak);
        continue;
      }

      const alpha = streak.life / streak.maxLife;
      const beamAlpha = alpha * alpha;
      (streak.beam.material as MeshBasicMaterial).opacity = 1 * beamAlpha;
      (streak.glow.material as MeshBasicMaterial).opacity = 0.5 * alpha;
    }
  }

  private updateImpactBursts(deltaTime: number): void {
    for (const burst of this.impactBursts) {
      if (!burst.active) {
        continue;
      }

      burst.life -= deltaTime;
      if (burst.life <= 0) {
        burst.active = false;
        burst.group.visible = false;
        continue;
      }

      const alpha = burst.life / burst.maxLife;
      burst.group.scale.setScalar(1 + (1 - alpha) * 0.7);
      (burst.core.material as MeshBasicMaterial).opacity = 0.8 * alpha;
      (burst.streakA.material as MeshBasicMaterial).opacity = 0.52 * alpha;
      (burst.streakB.material as MeshBasicMaterial).opacity = 0.52 * alpha;
    }
  }

  private clearPelletStreaks(): void {
    for (const streak of this.pelletStreaks) {
      this.deactivatePelletStreak(streak);
    }
  }

  private deactivatePelletStreak(streak: PelletStreak): void {
    streak.active = false;
    streak.life = 0;
    streak.maxLife = 0;
    streak.speed = 0;
    streak.direction.set(0, 0, 0);
    streak.group.visible = false;
    streak.group.position.set(0, 0, 999);
    (streak.beam.material as MeshBasicMaterial).opacity = 0;
    (streak.glow.material as MeshBasicMaterial).opacity = 0;
  }

  private clearImpactBursts(): void {
    for (const burst of this.impactBursts) {
      burst.active = false;
      burst.life = 0;
      burst.maxLife = 0;
      burst.group.visible = false;
    }
  }

  private disposePelletStreakPool(): void {
    for (const streak of this.pelletStreaks) {
      streak.beam.geometry.dispose();
      streak.glow.geometry.dispose();
      (streak.beam.material as MeshBasicMaterial).dispose();
      (streak.glow.material as MeshBasicMaterial).dispose();
    }
  }

  private disposeImpactBurstPool(): void {
    for (const burst of this.impactBursts) {
      burst.core.geometry.dispose();
      burst.streakA.geometry.dispose();
      burst.streakB.geometry.dispose();
      (burst.core.material as MeshBasicMaterial).dispose();
      (burst.streakA.material as MeshBasicMaterial).dispose();
      (burst.streakB.material as MeshBasicMaterial).dispose();
    }
  }

  private samplePelletScreenPoint(
    pelletIndex: number,
    pelletCount: number,
  ): void {
    const gap = this.getCrosshairGap();
    const radiusXPx = gap + this.getCrosshairBracketWidth(gap) * 0.5 + 2;
    const radiusYPx = this.getCrosshairBracketHeight(gap) * 0.42;
    const angle =
      (pelletIndex / Math.max(pelletCount, 1)) * Math.PI * 2 + randomRange(-0.38, 0.38);
    const radius = 0.16 + 0.84 * Math.sqrt(Math.random());
    const offsetXPx = Math.cos(angle) * radius * radiusXPx;
    const offsetYPx = Math.sin(angle) * radius * radiusYPx;
    const viewportWidth = Math.max(window.innerWidth, 1);
    const viewportHeight = Math.max(window.innerHeight, 1);

    this.spreadCrosshair.set(
      (offsetXPx / viewportWidth) * 2,
      (-offsetYPx / viewportHeight) * 2,
    );
  }

  private applyViewmodelPose(): void {
    const recoilBack = this.config.shotgun.viewmodel.recoilBack * this.fireKick;
    const recoilLift = this.config.shotgun.viewmodel.recoilLift * this.fireKick;
    const recoilPitch = MathUtils.degToRad(this.config.shotgun.viewmodel.recoilPitchDegrees) * this.fireKick;
    const recoilRoll = MathUtils.degToRad(this.config.shotgun.viewmodel.recoilRollDegrees) * this.fireKick;
    const spinProgress =
      this.spinTimer > 0 && this.activeSpinDuration > 0
        ? 1 - this.spinTimer / this.activeSpinDuration
        : 0;
    const easedSpin = MathUtils.smootherstep(spinProgress, 0, 1);
    const spinRoll = Math.PI * 2 * this.config.shotgun.viewmodel.spinTurns * easedSpin;
    const spinPitch = Math.sin(easedSpin * Math.PI) * 0.2;
    const spinDrop = Math.sin(easedSpin * Math.PI) * 0.07;

    this.viewmodelRoot.position.copy(this.basePosition);
    this.viewmodelRoot.position.x -= recoilBack;
    this.viewmodelRoot.position.y += recoilLift - spinDrop;
    this.viewmodelRoot.rotation.set(
      this.baseRotation.x + recoilPitch + spinPitch,
      this.baseRotation.y,
      this.baseRotation.z - recoilRoll + spinRoll,
    );
    this.viewmodelRoot.scale.setScalar(this.config.shotgun.viewmodel.scale);

    this.contentRoot.position.set(
      -this.config.shotgun.viewmodel.pumpTravel * this.pumpOffset,
      0,
      0,
    );
  }

  private randomizeMuzzleFlash(): void {
    const flashSize = this.config.shotgun.viewmodel.muzzleFlashSize;
    const blastWidth = this.getCrosshairGap() * 0.014;
    this.muzzleFlash.position.set(0, 0, 0);
    this.muzzleFlash.rotation.x = randomRange(-0.18, 0.18);
    this.muzzleFlash.rotation.y = randomRange(-0.1, 0.1);
    this.muzzleFlash.rotation.z = randomRange(-0.35, 0.35);
    this.muzzleFlashSpriteMaterial.rotation = randomRange(-0.14, 0.14);
    this.muzzleFlashSprite.scale.set(
      flashSize * randomRange(3.6, 4.4),
      flashSize * randomRange(1.55, 1.95),
      1,
    );
    this.muzzleFlashCore.visible = true;
    this.muzzleFlashStreak.visible = true;
    this.muzzleFlashCore.scale.setScalar(flashSize * randomRange(0.92, 1.14));
    this.muzzleFlashStreak.scale.set(
      flashSize * randomRange(2.9, 3.5),
      flashSize * randomRange(0.22, 0.3),
      flashSize * randomRange(0.22, 0.3),
    );

    for (const petal of this.muzzleBlastPetals) {
      petal.visible = true;
      petal.position.set(
        randomRange(-0.95, -0.18),
        randomRange(-blastWidth, blastWidth),
        randomRange(-blastWidth, blastWidth),
      );
      petal.rotation.set(
        randomRange(-0.3, 0.3),
        randomRange(-0.3, 0.3),
        randomRange(-0.6, 0.6),
      );
      petal.scale.set(
        flashSize * randomRange(0.7, 1.2),
        flashSize * randomRange(0.1, 0.18),
        flashSize * randomRange(0.1, 0.18),
      );
    }
  }

  private createEmergencyFallbackModel(): Object3D {
    const group = new Group();
    const barrel = new Mesh(
      new BoxGeometry(1.55, 0.08, 0.08),
      new MeshStandardMaterial({ color: 0x49413b, roughness: 0.9, metalness: 0.05 }),
    );
    barrel.position.set(-0.55, 0.22, 0);
    group.add(barrel);

    const receiver = new Mesh(
      new BoxGeometry(0.48, 0.18, 0.14),
      new MeshStandardMaterial({ color: 0x62574d, roughness: 0.92, metalness: 0.02 }),
    );
    receiver.position.set(0.18, 0.18, 0);
    group.add(receiver);

    const stock = new Mesh(
      new BoxGeometry(0.62, 0.2, 0.14),
      new MeshStandardMaterial({ color: 0x6e553f, roughness: 0.98, metalness: 0 }),
    );
    stock.position.set(0.56, 0.08, 0);
    stock.rotation.z = -0.24;
    group.add(stock);

    const foregrip = new Mesh(
      new BoxGeometry(0.34, 0.12, 0.12),
      new MeshStandardMaterial({ color: 0x7a6046, roughness: 0.99, metalness: 0 }),
    );
    foregrip.position.set(-0.06, 0.13, 0);
    group.add(foregrip);

    return group;
  }

  private disposeObject(object: Object3D | null): void {
    if (!object) {
      return;
    }

    object.traverse((entry) => {
      const maybeMesh = entry as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.geometry.dispose();
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];
      for (const material of materials) {
        material.dispose();
      }
    });
  }
}
