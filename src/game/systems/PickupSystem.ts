import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type {
  ActivePickup,
  GameConfig,
  LaneThreatState,
  LoadoutState,
  PickupEvent,
  PickupType,
} from '../../core/types';
import { randomInt, randomRange, sampleRoadCurveOffset } from '../../core/utils';

type PickupRecord = ActivePickup & {
  shotgunVariant: Group;
  bazookaVariant: Group;
  ammoCrateVariant: Group;
  glow: Mesh;
  beacon: Mesh;
};

export class PickupSystem {
  private readonly root = new Group();
  private readonly pickups: PickupRecord[] = [];
  private readonly bobVector = new Vector3();

  private shotgunTemplate: Group | null = null;
  private bazookaTemplate: Group | null = null;
  private shotgunLoadPromise: Promise<void> | null = null;
  private bazookaLoadPromise: Promise<void> | null = null;
  private nextSpawnZ = -110;

  constructor(
    private readonly scene: Scene,
    private readonly config: GameConfig,
  ) {
    this.root.name = 'PickupSystemRoot';
    this.scene.add(this.root);
    this.createPool();
    this.reset();
    void this.loadShotgunTemplate();
    void this.loadBazookaTemplate();
  }

  reset(): void {
    this.nextSpawnZ = randomRange(
      this.config.pickups.spawnMinZ,
      this.config.pickups.spawnMaxZ,
    );

    for (const pickup of this.pickups) {
      this.deactivate(pickup);
    }
  }

  update(
    deltaTime: number,
    playerX: number,
    forwardSpeed: number,
    elapsedSeconds: number,
    loadout: LoadoutState,
  ): PickupEvent[] {
    const events: PickupEvent[] = [];
    const scrollDistance = forwardSpeed * deltaTime;

    for (const pickup of this.pickups) {
      if (!pickup.active) {
        continue;
      }

      pickup.mesh.position.z += scrollDistance;
      this.groundToRoad(pickup, pickup.mesh.position.z, elapsedSeconds);
      pickup.mesh.rotation.y += pickup.spinSpeed * deltaTime;
      this.bobVector.set(0, Math.sin(elapsedSeconds * 5.2 + pickup.bobOffset) * 0.05, 0);
      pickup.mesh.position.y += this.bobVector.y;
      const pulse = 1 + Math.sin(elapsedSeconds * 4 + pickup.bobOffset) * 0.18;
      pickup.glow.scale.setScalar(1.08 * pulse);
      pickup.beacon.scale.set(
        0.92 + pulse * 0.12,
        1 + pulse * 0.28,
        0.92 + pulse * 0.12,
      );
      (pickup.glow.material as MeshBasicMaterial).opacity = 0.2 + Math.max(0, pulse - 0.88) * 0.22;
      (pickup.beacon.material as MeshBasicMaterial).opacity = 0.2 + Math.max(0, pulse - 0.86) * 0.16;

      if (pickup.mesh.position.z > this.config.pickups.cleanupZ) {
        this.deactivate(pickup);
        continue;
      }

      const closeEnoughInZ =
        Math.abs(pickup.mesh.position.z) <
        pickup.depth * 0.5 + this.config.pickups.hitboxDepth;
      const closeEnoughInX =
        Math.abs(pickup.mesh.position.x - playerX) <
        pickup.width * 0.5 + this.config.player.collisionRadius;

      if (closeEnoughInZ && closeEnoughInX) {
        events.push({
          type: pickup.kind,
          ammo: pickup.ammo,
        });
        this.deactivate(pickup);
      }
    }

    const devWeapons = this.config.debug.developmentWeapons;
    if (!devWeapons && elapsedSeconds < this.config.pickups.unlockTimeSeconds) {
      return events;
    }

    const bazookaUnlocked =
      devWeapons || elapsedSeconds >= this.config.pickups.bazookaUnlockTimeSeconds;
    const desiredActiveCount = bazookaUnlocked ? 4 : loadout.shotgunUnlocked ? 3 : 2;
    while (this.getActiveCount() < desiredActiveCount) {
      const slot = this.pickups.find((entry) => !entry.active);
      if (!slot) {
        break;
      }

      this.spawn(slot, loadout, bazookaUnlocked, elapsedSeconds);
    }

    return events;
  }

  getLaneHints(loadout: LoadoutState, elapsedSeconds: number): LaneThreatState[] {
    const hints: LaneThreatState[] = this.config.world.laneCenters.map((_, laneIndex) => ({
      laneIndex,
      score: 0,
      blocker: false,
      blockerType: null,
      blockerDistance: null,
      brokenLane: false,
      pothole: false,
      smallCount: 0,
      bruteCount: 0,
      pickupKind: null,
      pickupDistance: null,
      pickupValue: 0,
      pickupRisk: 0,
    }));

    for (const pickup of this.pickups) {
      if (!pickup.active) {
        continue;
      }

      const distanceAhead = -pickup.mesh.position.z;
      if (distanceAhead < 0 || distanceAhead > this.config.driver.pickupWindowDistance) {
        continue;
      }

      const lane = hints[pickup.lane];
      if (!lane) {
        continue;
      }

      const value = this.getPickupValue(pickup.kind, loadout, elapsedSeconds);
      if (value <= lane.pickupValue) {
        continue;
      }

      const proximity = 1 - Math.min(distanceAhead / this.config.driver.pickupWindowDistance, 1);
      const laneCenter = this.config.world.laneCenters[pickup.lane] ?? 0;
      const localOffset = Math.abs(pickup.laneLocalX - laneCenter);
      lane.pickupKind = pickup.kind;
      lane.pickupDistance = distanceAhead;
      lane.pickupValue = value;
      lane.pickupRisk = proximity * 0.35 + localOffset * 0.6;
    }

    return hints;
  }

  destroy(): void {
    this.reset();
    this.root.removeFromParent();
    this.disposeObject(this.shotgunTemplate);
    this.disposeObject(this.bazookaTemplate);
  }

  private createPool(): void {
    for (let index = 0; index < this.config.pickups.poolSize; index += 1) {
      const mesh = new Group();
      mesh.visible = false;

      const shotgunVariant = new Group();
      const bazookaVariant = new Group();
      const ammoCrateVariant = this.createAmmoCrateVariant();
      const glow = new Mesh(
        new SphereGeometry(0.55, 10, 10),
        new MeshBasicMaterial({
          color: 0xffc067,
          transparent: true,
          opacity: 0.26,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      );
      glow.position.y = 0.18;
      const beacon = new Mesh(
        new CylinderGeometry(0.24, 0.42, 2.7, 10, 1, true),
        new MeshBasicMaterial({
          color: 0xffd07b,
          transparent: true,
          opacity: 0.24,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
      );
      beacon.position.y = 1.5;
      mesh.add(beacon, glow, shotgunVariant, bazookaVariant, ammoCrateVariant);
      this.root.add(mesh);

      this.pickups.push({
        id: index,
        active: false,
        kind: 'shotgun',
        lane: 0,
        laneLocalX: 0,
        width: 1.8,
        depth: 1.2,
        ammo: this.config.pickups.shotgunPickupAmmo,
        bobOffset: Math.random() * Math.PI * 2,
        spinSpeed: randomRange(0.7, 1.2),
        mesh,
        shotgunVariant,
        bazookaVariant,
        ammoCrateVariant,
        glow,
        beacon,
      });

      this.applyShotgunVisual(this.pickups[index]);
      this.applyBazookaVisual(this.pickups[index]);
    }
  }

  private spawn(
    pickup: PickupRecord,
    loadout: LoadoutState,
    bazookaUnlocked: boolean,
    elapsedSeconds: number,
  ): void {
    const laneIndex = randomInt(0, this.config.world.laneCenters.length - 1);
    const laneCenter = this.config.world.laneCenters[laneIndex] ?? 0;
    let kind: PickupType = 'shotgun';
    if (!loadout.shotgunUnlocked || elapsedSeconds < 28) {
      kind = 'shotgun';
    } else if (
      bazookaUnlocked &&
      elapsedSeconds >= 45 &&
      elapsedSeconds <= 70 &&
      loadout.bazookaAmmo <= 0 &&
      Math.random() < this.config.pickups.bazookaSpawnChance * 1.2
    ) {
      kind = 'bazooka';
    } else if (
      loadout.shotgunUnlocked &&
      Math.random() < this.config.pickups.ammoCrateChance
    ) {
      kind = 'shotgunAmmo';
    }

    pickup.active = true;
    pickup.kind = kind;
    pickup.lane = laneIndex;
    pickup.laneLocalX = laneCenter + randomRange(-0.25, 0.25);
    pickup.mesh.visible = true;
    this.groundToRoad(pickup, this.nextSpawnZ, elapsedSeconds);
    pickup.mesh.rotation.set(0, randomRange(-0.3, 0.3), 0);
    pickup.spinSpeed = randomRange(0.8, 1.35);
    pickup.bobOffset = Math.random() * Math.PI * 2;
    if (kind === 'shotgun') {
      pickup.ammo = this.config.pickups.shotgunPickupAmmo;
      pickup.width = 1.9;
      pickup.depth = 1.2;
      pickup.shotgunVariant.visible = true;
      pickup.bazookaVariant.visible = false;
      pickup.ammoCrateVariant.visible = false;
      (pickup.glow.material as MeshBasicMaterial).color.setHex(0xffca6e);
      (pickup.beacon.material as MeshBasicMaterial).color.setHex(0xffca6e);
      this.nextSpawnZ -= randomRange(
        this.config.pickups.shotgunPickupSpacingMin,
        this.config.pickups.shotgunPickupSpacingMax,
      );
      return;
    }

    if (kind === 'bazooka') {
      pickup.ammo = this.config.bazooka.maxAmmo;
      pickup.width = 2.2;
      pickup.depth = 1.45;
      pickup.shotgunVariant.visible = false;
      pickup.bazookaVariant.visible = true;
      pickup.ammoCrateVariant.visible = false;
      (pickup.glow.material as MeshBasicMaterial).color.setHex(0xff8d5b);
      (pickup.beacon.material as MeshBasicMaterial).color.setHex(0xff8d5b);
      this.nextSpawnZ -= randomRange(
        this.config.pickups.bazookaPickupSpacingMin,
        this.config.pickups.bazookaPickupSpacingMax,
      );
      return;
    }

    pickup.ammo = randomInt(
      this.config.pickups.ammoCrateMin,
      this.config.pickups.ammoCrateMax,
    );
    pickup.width = 1.55;
    pickup.depth = 1.55;
    pickup.shotgunVariant.visible = false;
    pickup.bazookaVariant.visible = false;
    pickup.ammoCrateVariant.visible = true;
    (pickup.glow.material as MeshBasicMaterial).color.setHex(0x9cff8d);
    (pickup.beacon.material as MeshBasicMaterial).color.setHex(0x9cff8d);
    this.nextSpawnZ -= randomRange(
      this.config.pickups.ammoCrateSpacingMin,
      this.config.pickups.ammoCrateSpacingMax,
    );
  }

  private deactivate(pickup: PickupRecord): void {
    pickup.active = false;
    pickup.mesh.visible = false;
    pickup.mesh.position.set(0, 0, 999);
    pickup.laneLocalX = 0;
    pickup.shotgunVariant.visible = pickup.kind === 'shotgun';
    pickup.bazookaVariant.visible = pickup.kind === 'bazooka';
    pickup.ammoCrateVariant.visible = pickup.kind === 'shotgunAmmo';
  }

  private getActiveCount(): number {
    return this.pickups.reduce((count, pickup) => count + (pickup.active ? 1 : 0), 0);
  }

  private createAmmoCrateVariant(): Group {
    const group = new Group();
    group.visible = false;
    group.scale.setScalar(this.config.pickups.ammoCrateScale);

    const crateBase = new Mesh(
      new BoxGeometry(0.86, 0.52, 0.68),
      new MeshStandardMaterial({
        color: 0x5d4837,
        roughness: 0.98,
        metalness: 0.02,
      }),
    );
    crateBase.position.y = 0.24;
    group.add(crateBase);

    for (const x of [-0.22, 0.22]) {
      const strap = new Mesh(
        new BoxGeometry(0.08, 0.56, 0.7),
        new MeshStandardMaterial({
          color: 0x262623,
          roughness: 0.8,
          metalness: 0.2,
        }),
      );
      strap.position.set(x, 0.24, 0);
      group.add(strap);
    }

    for (const x of [-0.18, 0, 0.18]) {
      const shell = new Mesh(
        new CylinderGeometry(0.05, 0.05, 0.22, 10),
        new MeshStandardMaterial({
          color: 0xcf2e22,
          roughness: 0.84,
          metalness: 0.02,
        }),
      );
      shell.position.set(x, 0.58, 0.02);
      shell.rotation.z = Math.PI * 0.5;
      group.add(shell);
    }

    return group;
  }

  private async loadShotgunTemplate(): Promise<void> {
    if (this.shotgunLoadPromise) {
      return this.shotgunLoadPromise;
    }

    this.shotgunLoadPromise = (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(this.config.shotgun.viewmodel.assetPath);
        this.prepareTemplate(gltf.scene);
        this.shotgunTemplate = gltf.scene;
        for (const pickup of this.pickups) {
          this.applyShotgunVisual(pickup);
        }
      } catch (error) {
        console.warn('Failed to load shotgun pickup model, using fallback.', error);
      }
    })();

    return this.shotgunLoadPromise;
  }

  private async loadBazookaTemplate(): Promise<void> {
    if (this.bazookaLoadPromise) {
      return this.bazookaLoadPromise;
    }

    this.bazookaLoadPromise = (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const loader = new GLTFLoader();
        let scene: Group;

        try {
          const gltf = await loader.loadAsync(this.config.bazooka.viewmodel.assetPath);
          scene = gltf.scene;
        } catch {
          const gltf = await loader.loadAsync(this.config.bazooka.viewmodel.fallbackAssetPath);
          scene = gltf.scene;
        }

        this.prepareTemplate(scene);
        this.bazookaTemplate = scene;
        for (const pickup of this.pickups) {
          this.applyBazookaVisual(pickup);
        }
      } catch (error) {
        console.warn('Failed to load bazooka pickup model, using fallback.', error);
      }
    })();

    return this.bazookaLoadPromise;
  }

  private prepareTemplate(root: Group): void {
    root.traverse((object) => {
      object.frustumCulled = false;
      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.renderOrder = 4;
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

  private applyShotgunVisual(pickup: PickupRecord): void {
    pickup.shotgunVariant.clear();
    pickup.shotgunVariant.visible = pickup.kind === 'shotgun';

    const visual = this.shotgunTemplate
      ? this.shotgunTemplate.clone(true)
      : this.createFallbackShotgunPickup();
    visual.scale.setScalar(this.config.pickups.shotgunPickupScale);
    visual.rotation.set(-0.15, -Math.PI * 0.5, -0.22);
    visual.position.set(0, 0.18, 0);
    pickup.shotgunVariant.add(visual);
  }

  private applyBazookaVisual(pickup: PickupRecord): void {
    pickup.bazookaVariant.clear();
    pickup.bazookaVariant.visible = pickup.kind === 'bazooka';

    const visual = this.bazookaTemplate
      ? this.bazookaTemplate.clone(true)
      : this.createFallbackBazookaPickup();
    visual.scale.setScalar(this.config.pickups.bazookaPickupScale);
    visual.rotation.set(-0.14, -Math.PI * 0.5, -0.2);
    visual.position.set(0, 0.2, 0);
    pickup.bazookaVariant.add(visual);
  }

  private createFallbackShotgunPickup(): Group {
    const group = new Group();

    const barrel = new Mesh(
      new BoxGeometry(1.05, 0.06, 0.06),
      new MeshStandardMaterial({ color: 0x4a4340, roughness: 0.94, metalness: 0.08 }),
    );
    barrel.position.set(-0.24, 0.16, 0);
    group.add(barrel);

    const stock = new Mesh(
      new BoxGeometry(0.56, 0.18, 0.14),
      new MeshStandardMaterial({ color: 0x755b43, roughness: 0.98, metalness: 0 }),
    );
    stock.position.set(0.48, 0.04, 0);
    stock.rotation.z = -0.24;
    group.add(stock);

    const receiver = new Mesh(
      new BoxGeometry(0.38, 0.16, 0.12),
      new MeshStandardMaterial({ color: 0x61594f, roughness: 0.92, metalness: 0.06 }),
    );
    receiver.position.set(0.12, 0.15, 0);
    group.add(receiver);

    return group;
  }

  private createFallbackBazookaPickup(): Group {
    const group = new Group();

    const tube = new Mesh(
      new BoxGeometry(1.7, 0.16, 0.16),
      new MeshStandardMaterial({ color: 0x69645a, roughness: 0.94, metalness: 0.06 }),
    );
    const grip = new Mesh(
      new BoxGeometry(0.18, 0.36, 0.12),
      new MeshStandardMaterial({ color: 0x4b392d, roughness: 0.98, metalness: 0.02 }),
    );
    const rear = new Mesh(
      new BoxGeometry(0.16, 0.24, 0.14),
      new MeshStandardMaterial({ color: 0x302a27, roughness: 0.95, metalness: 0.04 }),
    );
    tube.position.set(-0.05, 0.18, 0);
    grip.position.set(0.18, -0.03, 0);
    rear.position.set(0.72, 0.04, 0);
    group.add(tube, grip, rear);

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

  private groundToRoad(pickup: PickupRecord, zPosition: number, elapsedSeconds: number): void {
    const curveOffset = sampleRoadCurveOffset(
      zPosition,
      elapsedSeconds,
      this.config.world.roadCurveFrequency,
      this.config.world.roadCurveAmplitude,
    );
    pickup.mesh.position.set(
      pickup.laneLocalX + curveOffset,
      this.config.world.roadSurfaceY + 0.85,
      zPosition,
    );
  }

  private getPickupValue(
    kind: PickupType,
    loadout: LoadoutState,
    elapsedSeconds: number,
  ): number {
    if (kind === 'shotgun') {
      return loadout.shotgunUnlocked ? 0.4 : elapsedSeconds < 30 ? 2.1 : 1.7;
    }

    if (kind === 'bazooka') {
      return loadout.bazookaAmmo <= 0 ? 2.15 : 0.65;
    }

    if (!loadout.shotgunUnlocked) {
      return 0.2;
    }

    const ammoRatio = loadout.shotgunAmmo / Math.max(this.config.shotgun.maxAmmo, 1);
    if (ammoRatio <= 0.2) {
      return 1.95;
    }
    if (ammoRatio <= 0.45) {
      return 1.45;
    }
    if (ammoRatio <= 0.75) {
      return 0.9;
    }

    return 0.35;
  }
}
