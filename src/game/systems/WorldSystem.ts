import {
  BoxGeometry,
  Camera,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Raycaster,
  Scene,
  SphereGeometry,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
} from 'three';
import type { ActiveObstacle, GameConfig } from '../../core/types';
import { randomInt, randomRange } from '../../core/utils';
import type { EnemySystem } from './EnemySystem';

type ObstacleRecord = ActiveObstacle & {
  barrierVariant: Group;
  wreckVariant: Group;
  barrelVariant: Group;
};

type HighwayChunk = {
  group: Group;
};

type ExplosionEffect = {
  group: Group;
  core: Mesh;
  shell: Mesh;
  light: PointLight;
  active: boolean;
  life: number;
  maxLife: number;
};

const ROAD_GEOMETRY = new BoxGeometry(22, 0.4, 40);
const SHOULDER_GEOMETRY = new BoxGeometry(3.2, 0.25, 40);
const TERRAIN_GEOMETRY = new BoxGeometry(12.5, 0.18, 40);
const DASH_GEOMETRY = new BoxGeometry(0.24, 0.03, 2.4);
const GUARD_GEOMETRY = new BoxGeometry(0.18, 0.4, 6.2);
const DEBRIS_GEOMETRY = new BoxGeometry(0.6, 0.35, 0.8);
const BARREL_BODY_GEOMETRY = new CylinderGeometry(0.58, 0.62, 1.55, 10, 3);
const BARREL_BAND_GEOMETRY = new CylinderGeometry(0.66, 0.66, 0.08, 10, 1, true);
const EXPLOSION_CORE_GEOMETRY = new IcosahedronGeometry(1, 0);
const EXPLOSION_SHELL_GEOMETRY = new SphereGeometry(1, 10, 10);

export class WorldSystem {
  private readonly worldRoot = new Group();
  private readonly chunks: HighwayChunk[] = [];
  private readonly obstacles: ObstacleRecord[] = [];
  private readonly explosions: ExplosionEffect[] = [];
  private readonly raycaster = new Raycaster();
  private readonly explosionCenter = new Vector3();

  private nextObstacleZ = -34;
  private nextBarrelEligibleZ = -72;
  private barrelTemplate: Group | null = null;
  private barrelLoadPromise: Promise<void> | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly config: GameConfig,
  ) {
    this.scene.add(this.worldRoot);
    this.createChunks();
    this.createObstacles();
    this.createExplosionPool();
    this.reset();
    void this.loadBarrelAssets();
  }

  reset(): void {
    this.positionChunks();
    this.nextObstacleZ = -34;
    this.nextBarrelEligibleZ = -72;

    for (const explosion of this.explosions) {
      this.deactivateExplosion(explosion);
    }

    for (const obstacle of this.obstacles) {
      this.recycleObstacle(obstacle);
    }
  }

  update(deltaTime: number, playerX: number): number {
    const scrollDistance = this.config.player.forwardSpeed * deltaTime;

    for (const chunk of this.chunks) {
      chunk.group.position.z += scrollDistance;
      if (chunk.group.position.z > this.config.world.chunkLength * 0.5) {
        chunk.group.position.z -= this.config.world.chunkLength * this.config.world.chunkCount;
      }
    }

    this.updateExplosions(deltaTime, scrollDistance);

    let collisionDamage = 0;
    for (const obstacle of this.obstacles) {
      obstacle.mesh.position.z += scrollDistance;

      if (obstacle.mesh.position.z > this.config.world.obstacleCleanupZ) {
        this.recycleObstacle(obstacle);
        continue;
      }

      const closeEnoughInZ =
        Math.abs(obstacle.mesh.position.z) <
        obstacle.depth * 0.5 + this.config.world.obstacleHitboxDepth;
      const closeEnoughInX =
        Math.abs(obstacle.mesh.position.x - playerX) <
        obstacle.width * 0.5 + this.config.player.collisionRadius;

      if (!obstacle.hasHitPlayer && closeEnoughInZ && closeEnoughInX) {
        obstacle.hasHitPlayer = true;
        collisionDamage += obstacle.damage;
        if (obstacle.type === 'barrel') {
          this.recycleObstacle(obstacle);
        }
      }
    }

    return collisionDamage;
  }

  raycast(
    camera: Camera,
    crosshair: Vector2,
    range: number,
  ): { obstacle: ObstacleRecord; point: Vector3; distance: number } | null {
    const activeBarrels = this.obstacles
      .filter((entry) => entry.active && entry.type === 'barrel')
      .map((entry) => entry.barrelVariant);

    if (activeBarrels.length === 0) {
      return null;
    }

    this.raycaster.setFromCamera(crosshair, camera);
    this.raycaster.near = 0;
    this.raycaster.far = range;

    const hits = this.raycaster.intersectObjects(activeBarrels, true);
    for (const hit of hits) {
      const obstacleId = hit.object.userData.obstacleId as number | undefined;
      if (obstacleId === undefined) {
        continue;
      }

      const obstacle = this.obstacles[obstacleId];
      if (!obstacle || !obstacle.active || obstacle.type !== 'barrel') {
        continue;
      }

      return {
        obstacle,
        point: hit.point.clone(),
        distance: hit.distance,
      };
    }

    return null;
  }

  triggerBarrelExplosion(obstacle: ObstacleRecord, enemies: EnemySystem): number {
    if (!obstacle.active || obstacle.type !== 'barrel') {
      return 0;
    }

    this.explosionCenter.copy(obstacle.mesh.position);
    this.explosionCenter.y = 0.72;
    this.spawnExplosion(this.explosionCenter);
    const scoreGain = enemies.applyExplosionDamage(
      this.explosionCenter,
      this.config.world.barrel.explosionRadius,
      this.config.world.barrel.tankDamage,
    );
    this.recycleObstacle(obstacle);
    return scoreGain;
  }

  private createChunks(): void {
    for (let index = 0; index < this.config.world.chunkCount; index += 1) {
      const chunkGroup = new Group();

      const road = new Mesh(
        ROAD_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x2d3035,
          flatShading: true,
          roughness: 0.98,
        }),
      );
      road.position.y = -0.42;
      chunkGroup.add(road);

      const leftShoulder = new Mesh(
        SHOULDER_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x6b655f,
          flatShading: true,
          roughness: 0.99,
        }),
      );
      leftShoulder.position.set(-12.5, -0.52, 0);
      chunkGroup.add(leftShoulder);

      const rightShoulder = leftShoulder.clone();
      rightShoulder.position.x = 12.5;
      chunkGroup.add(rightShoulder);

      const leftTerrain = new Mesh(
        TERRAIN_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x8b907c,
          flatShading: true,
          roughness: 1,
        }),
      );
      leftTerrain.position.set(-20.4, -0.58, 0);
      chunkGroup.add(leftTerrain);

      const rightTerrain = leftTerrain.clone();
      rightTerrain.position.x = 20.4;
      chunkGroup.add(rightTerrain);

      for (const x of [-3.66, 3.66]) {
        for (let dashIndex = 0; dashIndex < 10; dashIndex += 1) {
          const dash = new Mesh(
            DASH_GEOMETRY,
            new MeshStandardMaterial({
              color: 0xf2f0d7,
              flatShading: true,
              roughness: 0.82,
            }),
          );
          dash.position.set(x, -0.18, -18 + dashIndex * 4.1);
          chunkGroup.add(dash);
        }
      }

      for (const side of [-1, 1]) {
        for (let railIndex = 0; railIndex < 5; railIndex += 1) {
          if ((index + railIndex) % 4 === 0) {
            continue;
          }

          const rail = new Mesh(
            GUARD_GEOMETRY,
            new MeshStandardMaterial({
              color: 0x9da4aa,
              flatShading: true,
              roughness: 0.86,
            }),
          );
          rail.position.set(side * 10.9, -0.02, -15 + railIndex * 8);
          chunkGroup.add(rail);
        }
      }

      for (let debrisIndex = 0; debrisIndex < 10; debrisIndex += 1) {
        const debris = new Mesh(
          DEBRIS_GEOMETRY,
          new MeshStandardMaterial({
            color: debrisIndex % 2 === 0 ? 0x6f655e : 0x8a8078,
            flatShading: true,
            roughness: 1,
          }),
        );
        debris.position.set(
          randomRange(-13.6, 13.6),
          -0.16,
          randomRange(-18, 18),
        );
        debris.rotation.set(
          randomRange(-0.3, 0.25),
          randomRange(-0.3, 0.3),
          randomRange(-0.4, 0.4),
        );
        debris.scale.setScalar(randomRange(0.55, 1.45));
        chunkGroup.add(debris);
      }

      this.worldRoot.add(chunkGroup);
      this.chunks.push({ group: chunkGroup });
    }
  }

  private createObstacles(): void {
    for (let index = 0; index < this.config.world.obstaclePoolSize; index += 1) {
      const mesh = new Group();
      const barrierVariant = this.createBarrierVariant();
      const wreckVariant = this.createWreckVariant();
      const barrelVariant = this.createBarrelVariant();
      this.assignObstacleId(barrelVariant, index);

      mesh.add(barrierVariant, wreckVariant, barrelVariant);
      this.worldRoot.add(mesh);

      this.obstacles.push({
        id: index,
        poolId: index,
        mesh,
        active: true,
        lane: 0,
        width: 2.2,
        depth: 2,
        damage: this.config.world.obstacleDamage,
        hasHitPlayer: false,
        type: 'barrier',
        barrierVariant,
        wreckVariant,
        barrelVariant,
      });
    }
  }

  private createExplosionPool(): void {
    for (let index = 0; index < 6; index += 1) {
      const coreMaterial = new MeshBasicMaterial({
        color: 0xffb04a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const shellMaterial = new MeshBasicMaterial({
        color: 0xff6a2d,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const core = new Mesh(EXPLOSION_CORE_GEOMETRY, coreMaterial);
      const shell = new Mesh(EXPLOSION_SHELL_GEOMETRY, shellMaterial);
      const light = new PointLight(0xff9240, 0, 12, 2);
      const group = new Group();
      group.visible = false;
      group.add(core, shell, light);
      this.scene.add(group);
      this.explosions.push({
        group,
        core,
        shell,
        light,
        active: false,
        life: 0,
        maxLife: 0,
      });
    }
  }

  private positionChunks(): void {
    for (let index = 0; index < this.chunks.length; index += 1) {
      this.chunks[index].group.position.set(0, 0, -this.config.world.chunkLength * index);
    }
  }

  // Obstacles recycle from a pool so the endless road never needs dynamic allocation mid-run.
  private recycleObstacle(obstacle: ObstacleRecord): void {
    const laneIndex = randomInt(0, this.config.world.laneCenters.length - 1);
    const laneCenter = this.config.world.laneCenters[laneIndex] ?? 0;
    const spawnZ = this.nextObstacleZ;
    const canSpawnBarrel = spawnZ <= this.nextBarrelEligibleZ;
    const spawnBarrel =
      canSpawnBarrel && Math.random() < this.config.world.barrel.spawnChance;

    obstacle.active = true;
    obstacle.mesh.position.set(
      laneCenter + randomRange(-0.45, 0.45),
      0,
      spawnZ,
    );
    obstacle.mesh.rotation.y = randomRange(-0.28, 0.28);
    obstacle.hasHitPlayer = false;
    obstacle.lane = laneIndex;

    if (spawnBarrel) {
      obstacle.type = 'barrel';
      obstacle.damage = this.config.world.barrel.collisionDamage;
      obstacle.width = 1.45;
      obstacle.depth = 1.45;
      obstacle.barrierVariant.visible = false;
      obstacle.wreckVariant.visible = false;
      obstacle.barrelVariant.visible = true;
      this.nextBarrelEligibleZ =
        spawnZ - randomRange(
          this.config.world.barrel.spawnSpacingMin,
          this.config.world.barrel.spawnSpacingMax,
        );
    } else {
      obstacle.damage = this.config.world.obstacleDamage + randomInt(0, 3);
      obstacle.type = Math.random() < 0.55 ? 'barrier' : 'wreck';
      obstacle.barrierVariant.visible = obstacle.type === 'barrier';
      obstacle.wreckVariant.visible = obstacle.type === 'wreck';
      obstacle.barrelVariant.visible = false;
      obstacle.width = obstacle.type === 'barrier' ? 2.4 : 2.9;
      obstacle.depth = obstacle.type === 'barrier' ? 2.2 : 3.2;
    }

    this.nextObstacleZ -= randomRange(
      this.config.world.obstacleSpacingMin,
      this.config.world.obstacleSpacingMax,
    );
  }

  private createBarrierVariant(): Group {
    const group = new Group();

    const base = new Mesh(
      new BoxGeometry(2.2, 1.05, 1.1),
      new MeshStandardMaterial({
        color: 0xe1ddd3,
        flatShading: true,
        roughness: 0.95,
      }),
    );
    base.position.y = 0.42;
    group.add(base);

    const stripe = new Mesh(
      new BoxGeometry(2.28, 0.16, 1.16),
      new MeshStandardMaterial({
        color: 0xd06d2f,
        flatShading: true,
        roughness: 0.88,
      }),
    );
    stripe.position.y = 0.62;
    group.add(stripe);

    return group;
  }

  private createWreckVariant(): Group {
    const group = new Group();

    const body = new Mesh(
      new BoxGeometry(2.5, 0.9, 1.55),
      new MeshStandardMaterial({
        color: 0x6e3f39,
        flatShading: true,
        roughness: 0.86,
      }),
    );
    body.position.y = 0.5;
    group.add(body);

    const roof = new Mesh(
      new BoxGeometry(1.5, 0.44, 1.2),
      new MeshStandardMaterial({
        color: 0x946259,
        flatShading: true,
        roughness: 0.8,
      }),
    );
    roof.position.set(0.1, 1.06, 0);
    roof.rotation.z = 0.08;
    group.add(roof);

    const hood = new Mesh(
      new BoxGeometry(1.1, 0.24, 0.92),
      new MeshStandardMaterial({
        color: 0x3f3a39,
        flatShading: true,
        roughness: 0.94,
      }),
    );
    hood.position.set(0.66, 0.82, 0);
    hood.rotation.z = -0.2;
    group.add(hood);

    return group;
  }

  private createBarrelVariant(): Group {
    const group = new Group();
    group.position.y = 0.56;
    group.add(this.createFallbackBarrelMesh());
    return group;
  }

  private createFallbackBarrelMesh(): Group {
    const group = new Group();
    const body = new Mesh(
      BARREL_BODY_GEOMETRY,
      new MeshStandardMaterial({
        color: this.config.world.barrel.tintColor,
        roughness: 0.94,
        metalness: 0.02,
      }),
    );
    body.position.y = 0.18;
    group.add(body);

    for (const y of [-0.36, 0.18, 0.72]) {
      const band = new Mesh(
        BARREL_BAND_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x756b64,
          roughness: 0.72,
          metalness: 0.3,
        }),
      );
      band.position.y = y + 0.18;
      group.add(band);
    }

    return group;
  }

  private async loadBarrelAssets(): Promise<void> {
    if (this.barrelLoadPromise) {
      return this.barrelLoadPromise;
    }

    this.barrelLoadPromise = (async () => {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      const textureLoader = new TextureLoader();
      const [gltf, normalMap] = await Promise.all([
        loader.loadAsync(this.config.world.barrel.assetPath),
        textureLoader.loadAsync(this.config.world.barrel.normalMapPath),
      ]);

      normalMap.flipY = false;
      this.prepareBarrelTemplate(gltf.scene, normalMap);
      this.barrelTemplate = gltf.scene;

      for (const obstacle of this.obstacles) {
        this.applyBarrelVisual(obstacle);
      }
    })().catch((error) => {
      console.warn('Failed to load optimized barrel obstacle, using fallback mesh.', error);
    });

    return this.barrelLoadPromise;
  }

  private prepareBarrelTemplate(root: Group, normalMap: Texture): void {
    root.traverse((object) => {
      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.frustumCulled = false;
      maybeMesh.material = new MeshStandardMaterial({
        color: this.config.world.barrel.tintColor,
        roughness: 0.93,
        metalness: 0.04,
        normalMap,
      });
    });
  }

  private applyBarrelVisual(obstacle: ObstacleRecord): void {
    obstacle.barrelVariant.clear();
    obstacle.barrelVariant.position.y = 0.56;

    const visual = this.barrelTemplate
      ? this.barrelTemplate.clone(true)
      : this.createFallbackBarrelMesh();
    visual.scale.setScalar(this.config.world.barrel.scale);
    obstacle.barrelVariant.add(visual);
    this.assignObstacleId(obstacle.barrelVariant, obstacle.id);
  }

  private assignObstacleId(root: Group, obstacleId: number): void {
    root.traverse((object) => {
      object.userData.obstacleId = obstacleId;
    });
  }

  private spawnExplosion(position: Vector3): void {
    const effect = this.explosions.find((entry) => !entry.active);
    if (!effect) {
      return;
    }

    effect.active = true;
    effect.life = this.config.world.barrel.flashDuration;
    effect.maxLife = this.config.world.barrel.flashDuration;
    effect.group.visible = true;
    effect.group.position.copy(position);
    effect.core.scale.setScalar(0.2);
    effect.shell.scale.setScalar(0.2);
    (effect.core.material as MeshBasicMaterial).opacity = 0.95;
    (effect.shell.material as MeshBasicMaterial).opacity = 0.75;
    effect.light.intensity = 2.8;
  }

  private updateExplosions(deltaTime: number, scrollDistance: number): void {
    for (const effect of this.explosions) {
      if (!effect.active) {
        continue;
      }

      effect.life -= deltaTime;
      effect.group.position.z += scrollDistance * deltaTime;

      if (effect.life <= 0) {
        this.deactivateExplosion(effect);
        continue;
      }

      const progress = 1 - effect.life / effect.maxLife;
      const alpha = 1 - progress;
      const flashSize = this.config.world.barrel.flashSize;
      effect.core.scale.setScalar((0.4 + progress * flashSize * 0.72) * alpha);
      effect.shell.scale.setScalar(0.85 + progress * flashSize);
      (effect.core.material as MeshBasicMaterial).opacity = 0.95 * alpha;
      (effect.shell.material as MeshBasicMaterial).opacity = 0.5 * alpha;
      effect.light.intensity = 2.8 * alpha;
    }
  }

  private deactivateExplosion(effect: ExplosionEffect): void {
    effect.active = false;
    effect.life = 0;
    effect.maxLife = 0;
    effect.group.visible = false;
    effect.group.position.set(0, 0, 999);
    (effect.core.material as MeshBasicMaterial).opacity = 0;
    (effect.shell.material as MeshBasicMaterial).opacity = 0;
    effect.light.intensity = 0;
  }
}
