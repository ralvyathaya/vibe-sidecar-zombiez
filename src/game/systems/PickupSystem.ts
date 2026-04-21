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
  PlayerState,
} from '../../core/types';
import { randomInt, randomRange, sampleRoadCurveOffset } from '../../core/utils';
import { SoundEffectPool } from '../audio/SoundEffectPool';

type PickupRecord = ActivePickup & {
  shotgunVariant: Group;
  bazookaVariant: Group;
  ammoCrateVariant: Group;
  medkitVariant: Group;
  nitroVariant: Group;
  glow: Mesh;
  beacon: Mesh;
};

export class PickupSystem {
  private readonly root = new Group();
  private readonly pickups: PickupRecord[] = [];
  private readonly bobVector = new Vector3();
  private readonly pickupSound: SoundEffectPool;

  private shotgunTemplate: Group | null = null;
  private bazookaTemplate: Group | null = null;
  private shotgunLoadPromise: Promise<void> | null = null;
  private bazookaLoadPromise: Promise<void> | null = null;
  private nextSpawnZ = -110;
  private scriptedBazookaSpawned = false;

  constructor(
    private readonly scene: Scene,
    private readonly config: GameConfig,
  ) {
    this.root.name = 'PickupSystemRoot';
    this.pickupSound = new SoundEffectPool(this.config.pickups.audio.pickupPath, {
      poolSize: 4,
      volume: this.config.pickups.audio.pickupVolume,
      playbackRate: 1,
    });
    this.pickupSound.prime();
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
    this.scriptedBazookaSpawned = false;

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
    player: PlayerState,
  ): PickupEvent[] {
    const events: PickupEvent[] = [];
    const scrollDistance = forwardSpeed * deltaTime;
    const devWeapons = this.config.debug.developmentWeapons;
    const weaponUnlocked = devWeapons || elapsedSeconds >= this.config.pickups.unlockTimeSeconds;
    const supportUnlocked =
      devWeapons || elapsedSeconds >= this.config.pickups.supportUnlockTimeSeconds;

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
        this.playPickupCue(pickup.kind);
        events.push({
          type: pickup.kind,
          ammo: pickup.ammo,
        });
        this.deactivate(pickup);
      }
    }

    if (!weaponUnlocked && !supportUnlocked) {
      return events;
    }

    const bazookaUnlocked =
      devWeapons || elapsedSeconds >= this.config.pickups.bazookaUnlockTimeSeconds;
    if (
      bazookaUnlocked &&
      !this.scriptedBazookaSpawned &&
      elapsedSeconds >= this.config.pickups.bazookaUnlockTimeSeconds &&
      loadout.bazookaAmmo <= 0 &&
      !this.hasActiveKind('bazooka')
    ) {
      const slot = this.pickups.find((entry) => !entry.active);
      if (slot) {
        this.spawn(slot, loadout, player, bazookaUnlocked, elapsedSeconds, 'bazooka');
        this.scriptedBazookaSpawned = true;
      }
    }
    const desiredWeaponCount =
      weaponUnlocked ? (bazookaUnlocked ? 3 : loadout.shotgunUnlocked ? 2 : 1) : 0;
    const desiredSupportCount = supportUnlocked ? 2 : 0;
    const desiredActiveCount = desiredWeaponCount + desiredSupportCount;
    while (this.getActiveCount() < desiredActiveCount) {
      const slot = this.pickups.find((entry) => !entry.active);
      if (!slot) {
        break;
      }

      this.spawn(slot, loadout, player, bazookaUnlocked, elapsedSeconds);
    }

    return events;
  }

  getLaneHints(
    loadout: LoadoutState,
    player: PlayerState,
    elapsedSeconds: number,
  ): LaneThreatState[] {
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

      const value = this.getPickupValue(pickup.kind, loadout, player, elapsedSeconds);
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
    this.pickupSound.destroy();
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
      const medkitVariant = this.createMedkitVariant();
      const nitroVariant = this.createNitroVariant();
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
      mesh.add(
        beacon,
        glow,
        shotgunVariant,
        bazookaVariant,
        ammoCrateVariant,
        medkitVariant,
        nitroVariant,
      );
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
        medkitVariant,
        nitroVariant,
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
    player: PlayerState,
    bazookaUnlocked: boolean,
    elapsedSeconds: number,
    forcedKind?: PickupType,
  ): void {
    const laneIndex = randomInt(0, this.config.world.laneCenters.length - 1);
    const laneCenter = this.config.world.laneCenters[laneIndex] ?? 0;
    const activeSupportCount = this.getActiveSupportCount();
    let kind: PickupType;
    if (forcedKind) {
      kind = forcedKind;
    } else {
      const supportCandidates = this.buildSupportPickupCandidates(loadout, player, elapsedSeconds);
      const canSpawnSupport =
        elapsedSeconds >= this.config.pickups.supportUnlockTimeSeconds &&
        activeSupportCount < 2 &&
        Math.random() < this.config.pickups.supportPickupChance &&
        supportCandidates.some((candidate) => candidate.weight > 0.001);
      if (canSpawnSupport) {
        kind = this.pickSupportPickup(loadout, player, elapsedSeconds, supportCandidates);
      } else if (!loadout.shotgunUnlocked || elapsedSeconds < this.config.pickups.unlockTimeSeconds) {
        kind = 'shotgun';
      } else if (
        bazookaUnlocked &&
        elapsedSeconds >= this.config.pickups.bazookaUnlockTimeSeconds &&
        elapsedSeconds <= 70 &&
        loadout.bazookaAmmo <= 0 &&
        Math.random() < this.config.pickups.bazookaSpawnChance * 1.2
      ) {
        kind = 'bazooka';
      } else if (loadout.shotgunUnlocked && Math.random() < this.config.pickups.ammoCrateChance) {
        kind = 'shotgunAmmo';
      } else {
        kind = 'shotgun';
      }
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
      pickup.medkitVariant.visible = false;
      pickup.nitroVariant.visible = false;
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
      pickup.medkitVariant.visible = false;
      pickup.nitroVariant.visible = false;
      (pickup.glow.material as MeshBasicMaterial).color.setHex(0xff8d5b);
      (pickup.beacon.material as MeshBasicMaterial).color.setHex(0xff8d5b);
      this.nextSpawnZ -= randomRange(
        this.config.pickups.bazookaPickupSpacingMin,
        this.config.pickups.bazookaPickupSpacingMax,
      );
      return;
    }

    if (kind === 'medkit') {
      pickup.ammo = this.config.pickups.medkitHeal;
      pickup.width = 1.45;
      pickup.depth = 1.35;
      pickup.shotgunVariant.visible = false;
      pickup.bazookaVariant.visible = false;
      pickup.ammoCrateVariant.visible = false;
      pickup.medkitVariant.visible = true;
      pickup.nitroVariant.visible = false;
      (pickup.glow.material as MeshBasicMaterial).color.setHex(0x8dffad);
      (pickup.beacon.material as MeshBasicMaterial).color.setHex(0x8dffad);
      this.nextSpawnZ -= randomRange(
        this.config.pickups.supportPickupSpacingMin,
        this.config.pickups.supportPickupSpacingMax,
      );
      return;
    }

    if (kind === 'nitroCan') {
      pickup.ammo = 0;
      pickup.width = 1.4;
      pickup.depth = 1.35;
      pickup.shotgunVariant.visible = false;
      pickup.bazookaVariant.visible = false;
      pickup.ammoCrateVariant.visible = false;
      pickup.medkitVariant.visible = false;
      pickup.nitroVariant.visible = true;
      (pickup.glow.material as MeshBasicMaterial).color.setHex(0xffd67a);
      (pickup.beacon.material as MeshBasicMaterial).color.setHex(0xffd67a);
      this.nextSpawnZ -= randomRange(
        this.config.pickups.supportPickupSpacingMin,
        this.config.pickups.supportPickupSpacingMax,
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
    pickup.medkitVariant.visible = false;
    pickup.nitroVariant.visible = false;
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
    pickup.medkitVariant.visible = pickup.kind === 'medkit';
    pickup.nitroVariant.visible = pickup.kind === 'nitroCan';
  }

  private getActiveCount(): number {
    return this.pickups.reduce((count, pickup) => count + (pickup.active ? 1 : 0), 0);
  }

  private getActiveSupportCount(): number {
    return this.pickups.reduce(
      (count, pickup) =>
        count +
        (pickup.active &&
        (pickup.kind === 'medkit' ||
          pickup.kind === 'shotgunAmmo' ||
          pickup.kind === 'nitroCan')
          ? 1
          : 0),
      0,
    );
  }

  private hasActiveKind(kind: PickupType): boolean {
    return this.pickups.some((pickup) => pickup.active && pickup.kind === kind);
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

  private createMedkitVariant(): Group {
    const group = new Group();
    group.visible = false;
    group.scale.setScalar(this.config.pickups.supportPickupScale);

    const body = new Mesh(
      new BoxGeometry(0.82, 0.56, 0.56),
      new MeshStandardMaterial({ color: 0xe4e6df, roughness: 0.94, metalness: 0.02 }),
    );
    body.position.y = 0.26;
    group.add(body);

    const stripe = new Mesh(
      new BoxGeometry(0.24, 0.18, 0.58),
      new MeshStandardMaterial({ color: 0xc83c35, roughness: 0.9, metalness: 0.02 }),
    );
    stripe.position.set(0, 0.32, 0);
    group.add(stripe);

    const cross = new Mesh(
      new BoxGeometry(0.48, 0.18, 0.22),
      new MeshStandardMaterial({ color: 0xc83c35, roughness: 0.9, metalness: 0.02 }),
    );
    cross.position.set(0, 0.32, 0);
    group.add(cross);

    return group;
  }

  private createNitroVariant(): Group {
    const group = new Group();
    group.visible = false;
    group.scale.setScalar(this.config.pickups.supportPickupScale);

    const can = new Mesh(
      new CylinderGeometry(0.24, 0.24, 0.78, 14),
      new MeshStandardMaterial({ color: 0xb06e2f, roughness: 0.84, metalness: 0.1 }),
    );
    can.position.y = 0.44;
    group.add(can);

    const band = new Mesh(
      new CylinderGeometry(0.245, 0.245, 0.18, 14),
      new MeshStandardMaterial({ color: 0xead7a6, roughness: 0.72, metalness: 0.04 }),
    );
    band.position.y = 0.46;
    group.add(band);

    const nozzle = new Mesh(
      new BoxGeometry(0.1, 0.22, 0.1),
      new MeshStandardMaterial({ color: 0x35383d, roughness: 0.82, metalness: 0.18 }),
    );
    nozzle.position.set(0, 0.9, 0);
    group.add(nozzle);

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

  private playPickupCue(kind: PickupType): void {
    let volume = this.config.pickups.audio.pickupVolume;
    let playbackRate = randomRange(0.98, 1.04);

    if (kind === 'shotgun') {
      volume *= 1.1;
      playbackRate = randomRange(0.94, 0.99);
    } else if (kind === 'bazooka') {
      volume *= 1.24;
      playbackRate = randomRange(0.88, 0.95);
    } else if (kind === 'medkit') {
      volume *= 0.96;
      playbackRate = randomRange(1.02, 1.08);
    } else if (kind === 'nitroCan') {
      volume *= 1.08;
      playbackRate = randomRange(0.94, 1);
    }

    this.pickupSound.play(volume, playbackRate);
  }

  private getPickupValue(
    kind: PickupType,
    loadout: LoadoutState,
    player: PlayerState,
    elapsedSeconds: number,
  ): number {
    if (kind === 'shotgun') {
      return loadout.shotgunUnlocked ? 0.4 : elapsedSeconds < 30 ? 2.1 : 1.7;
    }

    if (kind === 'bazooka') {
      return loadout.bazookaAmmo <= 0 ? 2.15 : 0.65;
    }

    if (kind === 'medkit') {
      if (elapsedSeconds < this.config.pickups.medkitEarliestSeconds) {
        return 0.08;
      }
      const healthRatio = player.health / Math.max(player.maxHealth, 1);
      if (healthRatio <= 0.3) {
        return 2.45;
      }
      if (healthRatio <= 0.55) {
        return 1.7;
      }
      return 0.55;
    }

    if (kind === 'nitroCan') {
      if (elapsedSeconds < this.config.pickups.nitroEarliestSeconds) {
        return 0.2;
      }
      return player.nitroTimer > 0 ? 0.4 : 1.55;
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

  private pickSupportPickup(
    loadout: LoadoutState,
    player: PlayerState,
    elapsedSeconds: number,
    presetCandidates = this.buildSupportPickupCandidates(loadout, player, elapsedSeconds),
  ): PickupType {
    const candidates = presetCandidates;
    const totalWeight = candidates.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight <= 0.001) {
      return 'nitroCan';
    }
    let roll = Math.random() * totalWeight;

    for (const entry of candidates) {
      roll -= entry.weight;
      if (roll <= 0) {
        return entry.type;
      }
    }

    return 'medkit';
  }

  private buildSupportPickupCandidates(
    loadout: LoadoutState,
    player: PlayerState,
    elapsedSeconds: number,
  ): Array<{ type: PickupType; weight: number }> {
    const healthRatio = player.health / Math.max(player.maxHealth, 1);
    const medkitBias =
      healthRatio < 0.48 ? this.config.pickups.medkitLowHealthBias : 0;
    const medkitWeight =
      elapsedSeconds < this.config.pickups.medkitEarliestSeconds
        ? 0
        : healthRatio <= 0.34
          ? 0.34 + medkitBias
          : healthRatio <= 0.58
            ? 0.16 + medkitBias * 0.45
            : 0.05;
    const shotgunAmmoRatio = loadout.shotgunAmmo / Math.max(this.config.shotgun.maxAmmo, 1);
    const ammoBias = !loadout.shotgunUnlocked
      ? 0
      : shotgunAmmoRatio <= 0.2
        ? 0.72
        : shotgunAmmoRatio <= 0.45
          ? 0.42
          : shotgunAmmoRatio <= 0.7
            ? 0.2
            : 0.05;

    return [
      { type: 'medkit', weight: medkitWeight },
      { type: 'shotgunAmmo', weight: ammoBias },
      {
        type: 'nitroCan',
        weight:
          elapsedSeconds < this.config.pickups.nitroEarliestSeconds
            ? 0
            : player.nitroTimer > 0
              ? 0.08
              : 0.34,
      },
    ];
  }
}
