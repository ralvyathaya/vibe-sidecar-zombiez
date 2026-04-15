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
  Vector2,
  Vector3,
} from 'three';
import type { GameConfig, WeaponStatus } from '../../core/types';
import { approach, clamp, randomRange } from '../../core/utils';
import { SoundEffectPool } from '../audio/SoundEffectPool';
import type { EnemySystem } from '../systems/EnemySystem';
import type { InputSystem } from '../systems/InputSystem';
import type { PlayerSystem } from '../systems/PlayerSystem';
import type { WorldSystem } from '../systems/WorldSystem';

const TRACER_AXIS = new Vector3(1, 0, 0);

type TracerEffect = {
  group: Group;
  beam: Mesh;
  glow: Mesh;
  tip: Mesh;
  active: boolean;
  life: number;
  maxLife: number;
};

export class ShotgunWeapon {
  private readonly viewmodelRoot = new Group();
  private readonly contentRoot = new Group();
  private readonly worldEffectsRoot = new Group();
  private readonly muzzleAnchor = new Group();
  private readonly tracers: TracerEffect[] = [];
  private readonly spreadCrosshair = new Vector2();
  private readonly traceDirection = new Vector3();
  private readonly muzzleWorld = new Vector3();
  private readonly traceEnd = new Vector3();
  private readonly missRaycaster = new Raycaster();
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
  private readonly muzzleLight = new PointLight(0xffb464, 0, 7.5, 2);
  private readonly viewmodelKeyLight = new PointLight(0xffcd99, 0.14, 2.4, 2);
  private readonly viewmodelFillLight = new PointLight(0xdccfbd, 0.02, 1.6, 2);
  private readonly gunshotSound: SoundEffectPool;
  private readonly basePosition: Vector3;
  private readonly baseRotation = new Vector3();

  private loadedScene: Object3D | null = null;
  private cooldown = 0;
  private ammo = 0;
  private muzzleFlashTimer = 0;
  private hitConfirmTimer = 0;
  private fireKick = 0;
  private pumpOffset = 0;
  private pumpDelayTimer = 0;
  private spinTimer = 0;

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

    this.viewmodelRoot.name = 'ShotgunViewmodel';
    this.contentRoot.name = 'ShotgunContentRoot';
    this.worldEffectsRoot.name = 'ShotgunWorldEffects';
    this.muzzleAnchor.name = 'ShotgunMuzzleAnchor';

    this.muzzleFlashCore.renderOrder = 14;
    this.muzzleFlashStreak.renderOrder = 14;
    this.muzzleFlashCore.position.x = -0.08;
    this.muzzleFlashStreak.position.x = -0.96;
    this.muzzleFlash.add(this.muzzleFlashCore, this.muzzleFlashStreak, this.muzzleLight);
    this.muzzleFlash.visible = false;
    this.viewmodelKeyLight.position.set(0.2, 0.08, 0.28);
    this.viewmodelFillLight.position.set(-0.08, 0.05, 0.18);
    this.contentRoot.add(
      this.viewmodelKeyLight,
      this.viewmodelFillLight,
      this.muzzleAnchor,
    );
    this.viewmodelRoot.add(this.contentRoot);
    this.camera.add(this.viewmodelRoot);
    this.camera.parent?.add(this.worldEffectsRoot);

    this.createTracerPool();
    this.applyViewmodelPose();
    this.setEquipped(false);
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
    this.muzzleFlash.visible = false;
    this.muzzleLight.intensity = 0;
    this.resetTracers();
    this.gunshotSound.stopAll();
    this.applyViewmodelPose();
  }

  setEquipped(equipped: boolean): void {
    this.viewmodelRoot.visible = equipped;
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

  updateRunning(
    deltaTime: number,
    input: InputSystem,
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
  ): void {
    this.cooldown = Math.max(0, this.cooldown - deltaTime);
    this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - deltaTime);
    input.consumeReloadPressed();

    if (input.isFireHeld() && this.cooldown <= 0 && this.ammo > 0) {
      this.fire(player, enemies, world);
    }

    this.updateTracers(deltaTime);
    this.updatePresentation(deltaTime);
  }

  updateIdle(deltaTime: number): void {
    this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - deltaTime);
    this.updateTracers(deltaTime);
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
      crosshairKick: this.fireKick,
      canReload: false,
    };
  }

  destroy(): void {
    this.camera.remove(this.viewmodelRoot);
    this.worldEffectsRoot.removeFromParent();
    this.disposeObject(this.loadedScene);
    this.disposeTracerPool();
    this.muzzleFlashCore.geometry.dispose();
    this.muzzleFlashStreak.geometry.dispose();
    this.muzzleFlashCoreMaterial.dispose();
    this.muzzleFlashStreakMaterial.dispose();
    this.gunshotSound.destroy();
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
      box.min.x - size.x * 0.025,
      box.min.y + size.y * 0.58,
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

  private fire(player: PlayerSystem, enemies: EnemySystem, world: WorldSystem): void {
    this.cooldown = 1 / this.config.shotgun.fireRate;
    this.ammo = Math.max(0, this.ammo - 1);
    this.muzzleFlashTimer = this.config.shotgun.viewmodel.muzzleFlashDuration;
    this.muzzleFlash.visible = true;
    this.fireKick = 1;
    this.pumpOffset = 1;
    this.pumpDelayTimer = this.config.shotgun.viewmodel.pumpDelay;
    this.spinTimer = 0;
    player.applyRecoil(this.config.shotgun.cameraKick);
    this.gunshotSound.play(
      this.config.shotgun.audio.gunshotVolume,
      randomRange(0.76, 0.84),
    );
    this.randomizeMuzzleFlash();
    this.muzzleAnchor.getWorldPosition(this.muzzleWorld);

    let scoreGain = 0;

    for (let pelletIndex = 0; pelletIndex < this.config.shotgun.pelletsPerShot; pelletIndex += 1) {
      if (pelletIndex === 0) {
        this.spreadCrosshair.set(0, 0);
      } else {
        this.spreadCrosshair.set(
          randomRange(-1, 1) * this.config.shotgun.spread,
          randomRange(-1, 1) * this.config.shotgun.spread,
        );
      }

      const hitZombie = enemies.raycast(this.camera, this.spreadCrosshair, this.config.shotgun.range);
      const hitBarrel = world.raycast(this.camera, this.spreadCrosshair, this.config.shotgun.range);
      const hitEnemyFirst =
        hitZombie &&
        (!hitBarrel || hitZombie.distance <= hitBarrel.distance);

      if (hitEnemyFirst && hitZombie) {
        scoreGain += enemies.damage(
          hitZombie.zombie,
          this.config.shotgun.damagePerPellet,
          hitZombie.point,
        );
        this.hitConfirmTimer = 0.12;

        if (pelletIndex < this.config.shotgun.pelletVisualCount) {
          this.missRaycaster.setFromCamera(this.spreadCrosshair, this.camera);
          this.traceEnd.copy(this.muzzleWorld).addScaledVector(
            this.missRaycaster.ray.direction,
            Math.min(
              this.muzzleWorld.distanceTo(hitZombie.point),
              randomRange(
                this.config.shotgun.pelletTraceMinLength,
                this.config.shotgun.pelletTraceMaxLength,
              ),
            ),
          );
          this.spawnTracer(this.muzzleWorld, this.traceEnd);
        }
        continue;
      }

      if (hitBarrel) {
        scoreGain += world.triggerBarrelExplosion(hitBarrel.obstacle, enemies);
        this.hitConfirmTimer = 0.1;

        if (pelletIndex < this.config.shotgun.pelletVisualCount) {
          this.missRaycaster.setFromCamera(this.spreadCrosshair, this.camera);
          this.traceEnd.copy(this.muzzleWorld).addScaledVector(
            this.missRaycaster.ray.direction,
            Math.min(
              this.muzzleWorld.distanceTo(hitBarrel.point),
              randomRange(
                this.config.shotgun.pelletTraceMinLength,
                this.config.shotgun.pelletTraceMaxLength,
              ),
            ),
          );
          this.spawnTracer(this.muzzleWorld, this.traceEnd);
        }
        continue;
      }

      if (pelletIndex < this.config.shotgun.pelletVisualCount) {
        this.missRaycaster.setFromCamera(this.spreadCrosshair, this.camera);
        this.traceEnd.copy(this.muzzleWorld).addScaledVector(
          this.missRaycaster.ray.direction,
          randomRange(
            this.config.shotgun.pelletTraceMinLength,
            this.config.shotgun.pelletTraceMaxLength,
          ),
        );
        this.spawnTracer(this.muzzleWorld, this.traceEnd);
      }
    }

    if (scoreGain > 0) {
      player.state.score += scoreGain;
    }
  }

  private updatePresentation(deltaTime: number): void {
    this.fireKick = approach(this.fireKick, 0, deltaTime * this.config.shotgun.viewmodel.recoilRecovery);

    if (this.pumpDelayTimer > 0) {
      this.pumpDelayTimer = Math.max(0, this.pumpDelayTimer - deltaTime);
      this.pumpOffset = 1;
      if (this.pumpDelayTimer <= 0) {
        this.spinTimer = this.config.shotgun.viewmodel.spinDuration;
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

    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - deltaTime);
      const flashAlpha = this.muzzleFlashTimer / this.config.shotgun.viewmodel.muzzleFlashDuration;
      this.muzzleFlashCoreMaterial.opacity = 0.95 * flashAlpha;
      this.muzzleFlashStreakMaterial.opacity = 0.92 * flashAlpha;
      this.muzzleLight.intensity = 4.6 * flashAlpha;
      this.muzzleFlash.visible = flashAlpha > 0.01;
    } else {
      this.muzzleFlash.visible = false;
      this.muzzleLight.intensity = 0;
    }

    this.applyViewmodelPose();
  }

  private applyViewmodelPose(): void {
    const recoilBack = this.config.shotgun.viewmodel.recoilBack * this.fireKick;
    const recoilLift = this.config.shotgun.viewmodel.recoilLift * this.fireKick;
    const recoilPitch = MathUtils.degToRad(this.config.shotgun.viewmodel.recoilPitchDegrees) * this.fireKick;
    const recoilRoll = MathUtils.degToRad(this.config.shotgun.viewmodel.recoilRollDegrees) * this.fireKick;
    const spinProgress =
      this.spinTimer > 0
        ? 1 - this.spinTimer / this.config.shotgun.viewmodel.spinDuration
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
    this.muzzleFlash.rotation.x = randomRange(-0.3, 0.3);
    this.muzzleFlash.rotation.y = randomRange(-0.15, 0.15);
    this.muzzleFlash.rotation.z = randomRange(-0.6, 0.6);
    this.muzzleFlashCore.scale.setScalar(flashSize * randomRange(1.02, 1.42));
    this.muzzleFlashStreak.scale.set(
      flashSize * randomRange(3.2, 4.4),
      flashSize * randomRange(0.28, 0.42),
      flashSize * randomRange(0.28, 0.42),
    );
  }

  private createTracerPool(): void {
    for (let index = 0; index < 16; index += 1) {
      const beamMaterial = new MeshBasicMaterial({
        color: 0xffe2bb,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const glowMaterial = new MeshBasicMaterial({
        color: 0xffa865,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const tipMaterial = new MeshBasicMaterial({
        color: 0xfff2dc,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });

      const beam = new Mesh(
        new BoxGeometry(1, 0.018, 0.018),
        beamMaterial,
      );
      const glow = new Mesh(
        new BoxGeometry(1, 0.045, 0.045),
        glowMaterial,
      );
      const tip = new Mesh(new OctahedronGeometry(0.04, 0), tipMaterial);

      beam.visible = false;
      glow.visible = false;
      tip.visible = false;

      const group = new Group();
      group.visible = false;
      group.add(beam, glow, tip);
      this.worldEffectsRoot.add(group);
      this.tracers.push({
        group,
        beam,
        glow,
        tip,
        active: false,
        life: 0,
        maxLife: 0,
      });
    }
  }

  private spawnTracer(start: Vector3, end: Vector3): void {
    const tracer = this.tracers.find((entry) => !entry.active);
    if (!tracer) {
      return;
    }

    this.traceDirection.subVectors(end, start);
    const length = this.traceDirection.length();
    if (length < 0.001) {
      return;
    }

    tracer.active = true;
    tracer.life = this.config.shotgun.pelletTraceDuration;
    tracer.maxLife = this.config.shotgun.pelletTraceDuration;
    tracer.group.visible = true;
    tracer.group.position.copy(start).addScaledVector(this.traceDirection, 0.5);
    tracer.group.quaternion.setFromUnitVectors(TRACER_AXIS, this.traceDirection.normalize());
    tracer.beam.visible = true;
    tracer.glow.visible = true;
    tracer.tip.visible = true;
    tracer.beam.scale.set(length, 1, 1);
    tracer.glow.scale.set(length, 1, 1);
    tracer.tip.position.set(length * 0.5, 0, 0);
    (tracer.beam.material as MeshBasicMaterial).opacity = 0.72;
    (tracer.glow.material as MeshBasicMaterial).opacity = 0.42;
    (tracer.tip.material as MeshBasicMaterial).opacity = 0.65;
  }

  private updateTracers(deltaTime: number): void {
    for (const tracer of this.tracers) {
      if (!tracer.active) {
        continue;
      }

      tracer.life -= deltaTime;
      if (tracer.life <= 0) {
        tracer.active = false;
        tracer.group.visible = false;
        tracer.beam.visible = false;
        tracer.glow.visible = false;
        tracer.tip.visible = false;
        continue;
      }

      const alpha = tracer.life / tracer.maxLife;
      (tracer.beam.material as MeshBasicMaterial).opacity = 0.72 * alpha;
      (tracer.glow.material as MeshBasicMaterial).opacity = 0.42 * alpha;
      (tracer.tip.material as MeshBasicMaterial).opacity = 0.65 * alpha;
    }
  }

  private resetTracers(): void {
    for (const tracer of this.tracers) {
      tracer.active = false;
      tracer.life = 0;
      tracer.maxLife = 0;
      tracer.group.visible = false;
      tracer.beam.visible = false;
      tracer.glow.visible = false;
      tracer.tip.visible = false;
    }
  }

  private disposeTracerPool(): void {
    for (const tracer of this.tracers) {
      tracer.beam.geometry.dispose();
      tracer.glow.geometry.dispose();
      tracer.tip.geometry.dispose();
      (tracer.beam.material as MeshBasicMaterial).dispose();
      (tracer.glow.material as MeshBasicMaterial).dispose();
      (tracer.tip.material as MeshBasicMaterial).dispose();
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
