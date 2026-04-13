import {
  Box3,
  BoxGeometry,
  Camera,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { GameConfig, WeaponStatus } from '../../core/types';
import { approach, clamp } from '../../core/utils';
import type { EnemySystem } from '../systems/EnemySystem';
import type { InputSystem } from '../systems/InputSystem';
import type { PlayerSystem } from '../systems/PlayerSystem';

const SLIDE_NODE_PATTERN = /(slide|bolt|upper|top)/i;
const MAGAZINE_NODE_PATTERN = /(mag|magazine|clip)/i;

type AnimatedTarget = {
  node: Object3D;
  basePosition: Vector3;
  baseRotation: Vector3;
};

export class PistolWeapon {
  private readonly viewmodelRoot = new Group();
  private readonly contentRoot = new Group();
  private readonly muzzleAnchor = new Group();
  private readonly fallbackSlideAnchor = new Group();
  private readonly fallbackMagazineAnchor = new Group();
  private readonly muzzleFlashMaterial = new MeshBasicMaterial({
    color: 0xffcf75,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  private readonly muzzleFlash = new Mesh(
    new OctahedronGeometry(1, 0),
    this.muzzleFlashMaterial,
  );
  private readonly crosshair = new Vector2(0, 0);
  private readonly basePosition: Vector3;
  private readonly baseRotation = new Vector3();

  private loadedScene: Object3D | null = null;
  private slideTarget: AnimatedTarget | null = null;
  private magazineTarget: AnimatedTarget | null = null;
  private cooldown = 0;
  private reloadTimer = 0;
  private reloadElapsed = 0;
  private muzzleFlashTimer = 0;
  private hitConfirmTimer = 0;
  private dryFireTimer = 0;
  private fireKick = 0;
  private slideOffset = 0;

  constructor(
    private readonly camera: Camera,
    private readonly config: GameConfig,
  ) {
    const [rotX, rotY, rotZ] = this.config.weapon.viewmodel.rotationDegrees;
    this.basePosition = new Vector3(...this.config.weapon.viewmodel.position);
    this.baseRotation.set(
      MathUtils.degToRad(rotX),
      MathUtils.degToRad(rotY),
      MathUtils.degToRad(rotZ),
    );

    this.viewmodelRoot.name = 'PistolViewmodel';
    this.contentRoot.name = 'PistolContentRoot';
    this.muzzleAnchor.name = 'PistolMuzzleAnchor';
    this.fallbackSlideAnchor.name = 'PistolSlideAnchor';
    this.fallbackMagazineAnchor.name = 'PistolMagazineAnchor';

    this.muzzleFlash.visible = false;
    this.muzzleAnchor.add(this.muzzleFlash);
    this.contentRoot.add(
      this.muzzleAnchor,
      this.fallbackSlideAnchor,
      this.fallbackMagazineAnchor,
    );
    this.viewmodelRoot.add(this.contentRoot);
    this.camera.add(this.viewmodelRoot);

    this.applyViewmodelPose(false);
    void this.loadViewmodel();
  }

  reset(player: PlayerSystem): void {
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.reloadElapsed = 0;
    this.muzzleFlashTimer = 0;
    this.hitConfirmTimer = 0;
    this.dryFireTimer = 0;
    this.fireKick = 0;
    this.slideOffset = 0;
    this.muzzleFlash.visible = false;

    player.state.ammoInMagazine = this.config.weapon.magazineSize;
    player.state.reloading = false;

    this.restoreAnimatedNodes();
    this.applyViewmodelPose(false);
  }

  updateRunning(
    deltaTime: number,
    input: InputSystem,
    player: PlayerSystem,
    enemies: EnemySystem,
  ): void {
    this.cooldown = Math.max(0, this.cooldown - deltaTime);
    this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - deltaTime);
    this.dryFireTimer = Math.max(0, this.dryFireTimer - deltaTime);

    this.updateReload(deltaTime, player);

    if (input.consumeReloadPressed()) {
      this.startReload(player);
    }

    if (!player.state.reloading && input.isFireHeld() && this.cooldown <= 0) {
      if (player.state.ammoInMagazine > 0) {
        this.fire(player, enemies);
      } else {
        this.dryFireTimer = 0.16;
        this.cooldown = 0.12;
      }
    }

    this.updatePresentation(deltaTime, player.state.reloading);
  }

  updateIdle(deltaTime: number): void {
    this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - deltaTime);
    this.dryFireTimer = Math.max(0, this.dryFireTimer - deltaTime);
    this.updatePresentation(deltaTime, this.reloadTimer > 0);
  }

  getStatus(player: PlayerSystem): WeaponStatus {
    return {
      ammoInMagazine: player.state.ammoInMagazine,
      magazineSize: this.config.weapon.magazineSize,
      reloading: player.state.reloading,
      reloadProgress: player.state.reloading
        ? this.reloadElapsed / this.config.weapon.reloadDuration
        : 0,
      reserveAmmoText: Number.isFinite(player.state.ammoReserve)
        ? `${player.state.ammoReserve}`
        : 'INF',
      hitConfirm: this.hitConfirmTimer,
      canReload:
        !player.state.reloading &&
        player.state.ammoInMagazine < this.config.weapon.magazineSize,
    };
  }

  destroy(): void {
    this.camera.remove(this.viewmodelRoot);
    this.disposeObject(this.loadedScene);
    this.disposeObject(this.fallbackSlideAnchor);
    this.disposeObject(this.fallbackMagazineAnchor);
    this.muzzleFlash.geometry.dispose();
    this.muzzleFlashMaterial.dispose();
  }

  private async loadViewmodel(): Promise<void> {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(this.config.weapon.viewmodel.assetPath);
      this.mountModel(gltf.scene);
    } catch (error) {
      console.warn('Failed to load pistol GLB, using a lightweight fallback.', error);
      this.mountModel(this.createEmergencyFallbackModel());
    }
  }

  private mountModel(model: Object3D): void {
    if (this.loadedScene) {
      this.contentRoot.remove(this.loadedScene);
      this.disposeObject(this.loadedScene);
    }

    this.fallbackSlideAnchor.clear();
    this.fallbackMagazineAnchor.clear();
    this.slideTarget = null;
    this.magazineTarget = null;

    this.prepareModel(model);

    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const gripPivot = new Vector3(
      center.x,
      box.min.y + size.y * 0.36,
      box.max.z - size.z * 0.18,
    );

    model.position.set(-gripPivot.x, -gripPivot.y, -gripPivot.z);
    this.contentRoot.add(model);
    this.loadedScene = model;

    this.configureAttachmentAnchors(box, size, center, gripPivot);

    const slideNode = this.findNamedNode(model, SLIDE_NODE_PATTERN);
    const magazineNode = this.findNamedNode(model, MAGAZINE_NODE_PATTERN);

    if (slideNode) {
      this.slideTarget = this.captureAnimatedTarget(slideNode);
    } else {
      this.createFallbackSlide(size);
    }

    if (magazineNode) {
      this.magazineTarget = this.captureAnimatedTarget(magazineNode);
    } else {
      this.createFallbackMagazine(size);
    }

    this.restoreAnimatedNodes();
    this.applyViewmodelPose(false);
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
        if ('depthWrite' in material) {
          material.depthWrite = true;
        }
      }
    });
  }

  private configureAttachmentAnchors(
    box: Box3,
    size: Vector3,
    center: Vector3,
    gripPivot: Vector3,
  ): void {
    const muzzlePosition = new Vector3(
      center.x,
      box.min.y + size.y * 0.56,
      box.min.z - size.z * 0.18,
    ).sub(gripPivot);
    this.muzzleAnchor.position.copy(muzzlePosition);

    this.fallbackSlideAnchor.position.copy(
      new Vector3(
        center.x,
        box.max.y - size.y * 0.14,
        box.max.z - size.z * 0.32,
      ).sub(gripPivot),
    );

    this.fallbackMagazineAnchor.position.copy(
      new Vector3(
        center.x,
        box.min.y + size.y * 0.31,
        box.max.z - size.z * 0.22,
      ).sub(gripPivot),
    );
  }

  private createFallbackSlide(size: Vector3): void {
    const slideProxy = new Mesh(
      new BoxGeometry(size.x * 0.38, size.y * 0.12, size.z * 0.62),
      new MeshStandardMaterial({
        color: 0x25262a,
        roughness: 0.55,
        metalness: 0.4,
      }),
    );
    slideProxy.renderOrder = 11;
    this.fallbackSlideAnchor.add(slideProxy);
    this.slideTarget = this.captureAnimatedTarget(this.fallbackSlideAnchor);
  }

  private createFallbackMagazine(size: Vector3): void {
    const magazineProxy = new Mesh(
      new BoxGeometry(size.x * 0.12, size.y * 0.34, size.z * 0.26),
      new MeshStandardMaterial({
        color: 0x1c1b1f,
        roughness: 0.6,
        metalness: 0.3,
      }),
    );
    magazineProxy.position.y = -size.y * 0.17;
    magazineProxy.renderOrder = 11;
    this.fallbackMagazineAnchor.add(magazineProxy);
    this.magazineTarget = this.captureAnimatedTarget(this.fallbackMagazineAnchor);
  }

  private fire(player: PlayerSystem, enemies: EnemySystem): void {
    this.cooldown = 1 / this.config.weapon.fireRate;
    this.muzzleFlashTimer = this.config.weapon.viewmodel.muzzleFlashDuration;
    this.muzzleFlash.visible = true;
    player.state.ammoInMagazine -= 1;
    player.applyRecoil(this.config.weapon.cameraKick);

    this.fireKick = 1;
    this.slideOffset = this.config.weapon.viewmodel.slideTravel;
    this.randomizeMuzzleFlash();

    const hitZombie = enemies.raycast(this.camera, this.crosshair, this.config.weapon.range);
    if (hitZombie) {
      const scoreValue = enemies.damage(hitZombie, this.config.weapon.damagePerShot);
      this.hitConfirmTimer = 0.1;
      if (scoreValue > 0) {
        player.state.score += scoreValue;
      }
    }
  }

  private startReload(player: PlayerSystem): void {
    if (
      player.state.reloading ||
      player.state.ammoInMagazine === this.config.weapon.magazineSize
    ) {
      return;
    }

    player.state.reloading = true;
    this.reloadTimer = this.config.weapon.reloadDuration;
    this.reloadElapsed = 0;
  }

  private updateReload(deltaTime: number, player: PlayerSystem): void {
    if (!player.state.reloading) {
      return;
    }

    this.reloadTimer = Math.max(0, this.reloadTimer - deltaTime);
    this.reloadElapsed = clamp(
      this.reloadElapsed + deltaTime,
      0,
      this.config.weapon.reloadDuration,
    );

    if (this.reloadTimer <= 0) {
      player.state.reloading = false;
      player.state.ammoInMagazine = this.config.weapon.magazineSize;
      this.reloadElapsed = 0;
    }
  }

  // The loader prefers real slide/magazine nodes, then falls back to proxy anchors if the GLB is a single mesh.
  private updatePresentation(deltaTime: number, reloading: boolean): void {
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - deltaTime);
    this.fireKick = approach(
      this.fireKick,
      0,
      this.config.weapon.viewmodel.recoilRecovery * deltaTime,
    );
    this.slideOffset = approach(
      this.slideOffset,
      0,
      this.config.weapon.viewmodel.slideRecovery * deltaTime,
    );

    this.muzzleFlash.visible = this.muzzleFlashTimer > 0;
    this.muzzleFlashMaterial.opacity =
      this.muzzleFlashTimer > 0
        ? clamp(
            this.muzzleFlashTimer / this.config.weapon.viewmodel.muzzleFlashDuration,
            0,
            1,
          )
        : 0;

    this.applyViewmodelPose(reloading);
    this.applySlidePose();
    this.applyMagazinePose(reloading);
  }

  private applyViewmodelPose(reloading: boolean): void {
    const reloadProgress =
      reloading && this.config.weapon.reloadDuration > 0
        ? this.reloadElapsed / this.config.weapon.reloadDuration
        : 0;
    const reloadArc = reloading ? Math.sin(reloadProgress * Math.PI) : 0;
    const recoilPitch = MathUtils.degToRad(
      this.fireKick * this.config.weapon.viewmodel.recoilPitchDegrees,
    );
    const recoilRoll = MathUtils.degToRad(
      this.fireKick * this.config.weapon.viewmodel.recoilRollDegrees,
    );
    const reloadTilt = MathUtils.degToRad(
      reloadArc * this.config.weapon.viewmodel.reloadTiltDegrees,
    );

    this.viewmodelRoot.position.set(
      this.basePosition.x - reloadArc * 0.035,
      this.basePosition.y + this.fireKick * this.config.weapon.viewmodel.recoilLift -
        reloadArc * this.config.weapon.viewmodel.reloadLift,
      this.basePosition.z + this.fireKick * this.config.weapon.viewmodel.recoilBack +
        reloadArc * 0.045,
    );
    this.viewmodelRoot.rotation.set(
      this.baseRotation.x + recoilPitch + reloadTilt * 0.35,
      this.baseRotation.y,
      this.baseRotation.z + recoilRoll + reloadTilt,
    );
    this.viewmodelRoot.scale.setScalar(this.config.weapon.viewmodel.scale);
  }

  private applySlidePose(): void {
    if (!this.slideTarget) {
      return;
    }

    this.slideTarget.node.position.copy(this.slideTarget.basePosition);
    this.slideTarget.node.position.z += this.slideOffset;
  }

  private applyMagazinePose(reloading: boolean): void {
    if (!this.magazineTarget) {
      return;
    }

    this.magazineTarget.node.position.copy(this.magazineTarget.basePosition);
    this.magazineTarget.node.rotation.set(
      this.magazineTarget.baseRotation.x,
      this.magazineTarget.baseRotation.y,
      this.magazineTarget.baseRotation.z,
    );

    if (!reloading || this.config.weapon.reloadDuration <= 0) {
      return;
    }

    const progress = this.reloadElapsed / this.config.weapon.reloadDuration;
    const magazineDrop = this.computeMagazineDrop(progress);
    const magazineTilt = MathUtils.degToRad(
      this.config.weapon.viewmodel.magazineTiltDegrees,
    );

    this.magazineTarget.node.position.y -= magazineDrop * this.config.weapon.viewmodel.magazineDrop;
    this.magazineTarget.node.position.z += magazineDrop * 0.05;
    this.magazineTarget.node.rotation.x -= magazineDrop * magazineTilt;
    this.magazineTarget.node.rotation.z += magazineDrop * magazineTilt * 0.18;
  }

  private computeMagazineDrop(progress: number): number {
    if (progress <= 0.24) {
      return easeOutQuad(progress / 0.24);
    }

    if (progress <= 0.68) {
      return 1;
    }

    if (progress <= 1) {
      return 1 - easeInOutQuad((progress - 0.68) / 0.32);
    }

    return 0;
  }

  private randomizeMuzzleFlash(): void {
    const baseSize = this.config.weapon.viewmodel.muzzleFlashSize;
    const scale = baseSize * (0.9 + Math.random() * 0.25);
    this.muzzleFlash.scale.set(scale * 0.75, scale * 0.75, scale * 1.45);
  }

  private restoreAnimatedNodes(): void {
    if (this.slideTarget) {
      this.slideTarget.node.position.copy(this.slideTarget.basePosition);
    }

    if (this.magazineTarget) {
      this.magazineTarget.node.position.copy(this.magazineTarget.basePosition);
      this.magazineTarget.node.rotation.set(
        this.magazineTarget.baseRotation.x,
        this.magazineTarget.baseRotation.y,
        this.magazineTarget.baseRotation.z,
      );
    }
  }

  private captureAnimatedTarget(node: Object3D): AnimatedTarget {
    return {
      node,
      basePosition: node.position.clone(),
      baseRotation: new Vector3(node.rotation.x, node.rotation.y, node.rotation.z),
    };
  }

  private findNamedNode(root: Object3D, pattern: RegExp): Object3D | null {
    let match: Object3D | null = null;

    root.traverse((object) => {
      if (match || !object.name) {
        return;
      }

      if (pattern.test(object.name)) {
        match = object;
      }
    });

    return match;
  }

  private createEmergencyFallbackModel(): Object3D {
    const root = new Group();
    const darkMaterial = new MeshStandardMaterial({
      color: 0x26221f,
      roughness: 0.7,
      metalness: 0.25,
    });
    const accentMaterial = new MeshStandardMaterial({
      color: 0x85603a,
      roughness: 0.55,
      metalness: 0.25,
    });

    const body = new Mesh(new BoxGeometry(0.9, 0.34, 1.9), darkMaterial);
    body.position.set(0, 0.22, 0);
    root.add(body);

    const slide = new Mesh(new BoxGeometry(0.72, 0.18, 1.18), accentMaterial);
    slide.position.set(0, 0.42, -0.14);
    slide.name = 'FallbackSlide';
    root.add(slide);

    const grip = new Mesh(new BoxGeometry(0.26, 0.78, 0.36), darkMaterial);
    grip.position.set(0, -0.4, 0.56);
    grip.rotation.x = -0.25;
    root.add(grip);

    const magazine = new Mesh(new BoxGeometry(0.18, 0.54, 0.22), accentMaterial);
    magazine.position.set(0, -0.66, 0.6);
    magazine.name = 'FallbackMagazine';
    root.add(magazine);

    return root;
  }

  private disposeObject(root: Object3D | null): void {
    if (!root) {
      return;
    }

    root.traverse((object) => {
      const maybeMesh = object as Mesh;
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

const easeOutQuad = (value: number): number => 1 - (1 - value) * (1 - value);

const easeInOutQuad = (value: number): number =>
  value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
