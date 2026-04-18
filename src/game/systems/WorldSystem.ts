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
  Vector2,
  Vector3,
} from 'three';
import type { ActiveObstacle, GameConfig } from '../../core/types';
import { randomInt, randomRange } from '../../core/utils';
import { SoundEffectPool } from '../audio/SoundEffectPool';
import type { EnemySystem } from './EnemySystem';

type ObstacleRecord = ActiveObstacle & {
  barricadeVariant: Group;
  concreteBlockVariant: Group;
  wreckVariant: Group;
  carVariant: Group;
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

type BreakEffectPiece = {
  mesh: Mesh;
  velocity: Vector3;
  rotationVelocity: Vector3;
  baseScale: number;
};

type BreakEffect = {
  group: Group;
  pieces: BreakEffectPiece[];
  dust: Mesh[];
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
const BARRICADE_FALLBACK_BASE = new BoxGeometry(2.2, 1.05, 0.82);
const CONCRETE_FALLBACK_BASE = new BoxGeometry(2.08, 1.1, 1.16);
const CONCRETE_FALLBACK_CAP = new BoxGeometry(1.96, 0.14, 1.02);
const CAR_FALLBACK_BODY = new BoxGeometry(1.78, 0.42, 3.3);
const CAR_FALLBACK_CABIN = new BoxGeometry(1.34, 0.46, 1.68);
const CAR_FALLBACK_HOOD = new BoxGeometry(1.46, 0.18, 1.08);
const CAR_FALLBACK_WHEEL = new CylinderGeometry(0.32, 0.32, 0.26, 10, 1);
const BARREL_BODY_GEOMETRY = new CylinderGeometry(0.58, 0.62, 1.55, 10, 3);
const BARREL_BAND_GEOMETRY = new CylinderGeometry(0.66, 0.66, 0.08, 10, 1, true);
const BREAK_PIECE_GEOMETRY = new BoxGeometry(1, 1, 1);
const BREAK_DUST_GEOMETRY = new IcosahedronGeometry(1, 0);
const EXPLOSION_CORE_GEOMETRY = new IcosahedronGeometry(1, 0);
const EXPLOSION_SHELL_GEOMETRY = new SphereGeometry(1, 10, 10);

export class WorldSystem {
  private readonly worldRoot = new Group();
  private readonly chunks: HighwayChunk[] = [];
  private readonly obstacles: ObstacleRecord[] = [];
  private readonly explosions: ExplosionEffect[] = [];
  private readonly breakEffects: BreakEffect[] = [];
  private readonly raycaster = new Raycaster();
  private readonly explosionCenter = new Vector3();
  private readonly projectileSegment = new Vector3();
  private readonly projectileClosestPoint = new Vector3();
  private readonly projectileHitPoint = new Vector3();
  private readonly obstacleImpactSound: SoundEffectPool;

  private nextObstacleZ = -34;
  private nextBarrelEligibleZ = -72;
  private nextCarEligibleZ = -124;
  private barrelTemplate: Group | null = null;
  private barricadeTemplate: Group | null = null;
  private concreteBlockTemplate: Group | null = null;
  private carTemplate: Group | null = null;
  private barrelLoadPromise: Promise<void> | null = null;
  private barricadeLoadPromise: Promise<void> | null = null;
  private concreteBlockLoadPromise: Promise<void> | null = null;
  private carLoadPromise: Promise<void> | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly config: GameConfig,
  ) {
    this.obstacleImpactSound = new SoundEffectPool(this.config.world.audio.obstacleImpactPath, {
      poolSize: 4,
      volume: this.config.world.audio.obstacleImpactVolume,
    });
    this.scene.add(this.worldRoot);
    this.createChunks();
    this.createObstacles();
    this.createExplosionPool();
    this.createBreakEffectPool();
    this.reset();
    void this.loadBarrelAssets();
    void this.loadBarricadeAssets();
    void this.loadConcreteBlockAssets();
    void this.loadCarAssets();
  }

  reset(): void {
    this.positionChunks();
    this.nextObstacleZ = -34;
    this.nextBarrelEligibleZ = -72;
    this.nextCarEligibleZ = -124;
    this.obstacleImpactSound.stopAll();

    for (const explosion of this.explosions) {
      this.deactivateExplosion(explosion);
    }

    for (const effect of this.breakEffects) {
      this.deactivateBreakEffect(effect);
    }

    for (const obstacle of this.obstacles) {
      this.recycleObstacle(obstacle);
    }
  }

  destroy(): void {
    this.reset();
    this.obstacleImpactSound.destroy();
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
    this.updateBreakEffects(deltaTime, scrollDistance);

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
        this.playObstacleImpactSound(obstacle);

        if (obstacle.type === 'barrel') {
          this.recycleObstacle(obstacle);
          continue;
        }

        if (obstacle.type === 'car') {
          continue;
        }

        this.spawnBreakEffect(obstacle);
        this.recycleObstacle(obstacle);
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

  findProjectileImpact(
    start: Vector3,
    end: Vector3,
    radius: number,
  ): { obstacle: ActiveObstacle; point: Vector3; distance: number } | null {
    this.projectileSegment.copy(end).sub(start);
    const segmentLength = this.projectileSegment.length();
    if (segmentLength <= 0.0001) {
      return null;
    }

    this.projectileSegment.multiplyScalar(1 / segmentLength);
    let closestHit: { obstacle: ActiveObstacle; point: Vector3; distance: number } | null = null;

    for (const obstacle of this.obstacles) {
      if (!obstacle.active) {
        continue;
      }

      const distanceAlong = Math.max(
        0,
        Math.min(
          segmentLength,
          obstacle.mesh.position
            .clone()
            .sub(start)
            .dot(this.projectileSegment),
        ),
      );

      this.projectileClosestPoint
        .copy(start)
        .addScaledVector(this.projectileSegment, distanceAlong);

      const xReach = obstacle.width * 0.5 + radius;
      const zReach = obstacle.depth * 0.5 + radius;
      const withinX = Math.abs(this.projectileClosestPoint.x - obstacle.mesh.position.x) <= xReach;
      const withinZ = Math.abs(this.projectileClosestPoint.z - obstacle.mesh.position.z) <= zReach;
      if (!withinX || !withinZ) {
        continue;
      }

      if (!closestHit || distanceAlong < closestHit.distance) {
        this.projectileHitPoint.copy(this.projectileClosestPoint);
        this.projectileHitPoint.y = this.config.world.roadSurfaceY + 0.72;
        closestHit = {
          obstacle,
          point: this.projectileHitPoint.clone(),
          distance: distanceAlong,
        };
      }
    }

    return closestHit;
  }

  applyProjectileImpact(obstacle: ActiveObstacle): void {
    const record = obstacle as ObstacleRecord;
    if (!record.active) {
      return;
    }

    if (record.type === 'car') {
      return;
    }

    if (record.type === 'barrel') {
      this.recycleObstacle(record);
      return;
    }

    this.spawnBreakEffect(record);
    this.recycleObstacle(record);
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
      const barricadeVariant = this.createBarricadeVariant();
      const concreteBlockVariant = this.createConcreteBlockVariant();
      const wreckVariant = this.createWreckVariant();
      const carVariant = this.createCarVariant();
      const barrelVariant = this.createBarrelVariant();
      this.assignObstacleId(barrelVariant, index);

      mesh.add(barricadeVariant, concreteBlockVariant, wreckVariant, carVariant, barrelVariant);
      this.worldRoot.add(mesh);

      this.obstacles.push({
        id: index,
        poolId: index,
        mesh,
        active: true,
        lane: 0,
        width: this.config.world.barricade.width,
        depth: this.config.world.barricade.depth,
        damage: this.config.world.barricade.collisionDamage,
        hasHitPlayer: false,
        type: 'barricade',
        barricadeVariant,
        concreteBlockVariant,
        wreckVariant,
        carVariant,
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

  // Break bursts are pooled so obstacle collisions stay cheap even during long endless runs.
  private createBreakEffectPool(): void {
    for (let index = 0; index < 7; index += 1) {
      const group = new Group();
      const pieces: BreakEffectPiece[] = [];
      const dust: Mesh[] = [];
      group.visible = false;

      for (let pieceIndex = 0; pieceIndex < this.config.world.breakEffect.pieceCount; pieceIndex += 1) {
        const piece = new Mesh(
          BREAK_PIECE_GEOMETRY,
          new MeshStandardMaterial({
            color: 0xbdb7ad,
            roughness: 0.98,
            metalness: 0.02,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
        );
        piece.visible = false;
        group.add(piece);
        pieces.push({
          mesh: piece,
          velocity: new Vector3(),
          rotationVelocity: new Vector3(),
          baseScale: 1,
        });
      }

      for (let dustIndex = 0; dustIndex < this.config.world.breakEffect.dustCount; dustIndex += 1) {
        const puff = new Mesh(
          BREAK_DUST_GEOMETRY,
          new MeshBasicMaterial({
            color: 0x7f766d,
            transparent: true,
            opacity: 0,
            depthWrite: false,
          }),
        );
        puff.visible = false;
        group.add(puff);
        dust.push(puff);
      }

      this.scene.add(group);
      this.breakEffects.push({
        group,
        pieces,
        dust,
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
    const canSpawnCar = spawnZ <= this.nextCarEligibleZ;
    const spawnCar =
      canSpawnCar && Math.random() < this.config.world.car.spawnChance;
    const canSpawnBarrel = spawnZ <= this.nextBarrelEligibleZ;
    const spawnBarrel =
      !spawnCar && canSpawnBarrel && Math.random() < this.config.world.barrel.spawnChance;

    obstacle.active = true;
    obstacle.hasHitPlayer = false;
    obstacle.lane = laneIndex;

    if (spawnCar) {
      obstacle.type = 'car';
      obstacle.damage = this.config.world.car.collisionDamage;
      obstacle.width = this.config.world.car.width;
      obstacle.depth = this.config.world.car.depth;
      obstacle.barricadeVariant.visible = false;
      obstacle.concreteBlockVariant.visible = false;
      obstacle.wreckVariant.visible = false;
      obstacle.carVariant.visible = true;
      obstacle.barrelVariant.visible = false;
      this.nextCarEligibleZ =
        spawnZ - randomRange(
          this.config.world.car.spawnSpacingMin,
          this.config.world.car.spawnSpacingMax,
        );
    } else if (spawnBarrel) {
      obstacle.type = 'barrel';
      obstacle.damage = this.config.world.barrel.collisionDamage;
      obstacle.width = 1.45;
      obstacle.depth = 1.45;
      obstacle.barricadeVariant.visible = false;
      obstacle.concreteBlockVariant.visible = false;
      obstacle.wreckVariant.visible = false;
      obstacle.carVariant.visible = false;
      obstacle.barrelVariant.visible = true;
      this.nextBarrelEligibleZ =
        spawnZ - randomRange(
          this.config.world.barrel.spawnSpacingMin,
          this.config.world.barrel.spawnSpacingMax,
        );
    } else {
      this.applyRoadObstacleType(obstacle, this.chooseRoadObstacleType());
    }

    const laneOffset = obstacle.type === 'car'
      ? randomRange(-0.08, 0.08)
      : randomRange(-0.45, 0.45);
    obstacle.mesh.position.set(laneCenter + laneOffset, 0, spawnZ);
    obstacle.mesh.rotation.y = obstacle.type === 'car'
      ? randomRange(-0.06, 0.06)
      : randomRange(-0.28, 0.28);

    this.nextObstacleZ -= randomRange(
      this.config.world.obstacleSpacingMin,
      this.config.world.obstacleSpacingMax,
    );
  }

  private applyRoadObstacleType(
    obstacle: ObstacleRecord,
    type: 'barricade' | 'concreteBlock' | 'wreck',
  ): void {
    obstacle.type = type;
    obstacle.barricadeVariant.visible = type === 'barricade';
    obstacle.concreteBlockVariant.visible = type === 'concreteBlock';
    obstacle.wreckVariant.visible = type === 'wreck';
    obstacle.carVariant.visible = false;
    obstacle.barrelVariant.visible = false;

    if (type === 'barricade') {
      obstacle.damage = this.config.world.barricade.collisionDamage;
      obstacle.width = this.config.world.barricade.width;
      obstacle.depth = this.config.world.barricade.depth;
      return;
    }

    if (type === 'concreteBlock') {
      obstacle.damage = this.config.world.concreteBlock.collisionDamage;
      obstacle.width = this.config.world.concreteBlock.width;
      obstacle.depth = this.config.world.concreteBlock.depth;
      return;
    }

    obstacle.damage = this.config.world.obstacleDamage + randomInt(0, 3);
    obstacle.width = 2.9;
    obstacle.depth = 3.2;
  }

  private chooseRoadObstacleType(): 'barricade' | 'concreteBlock' | 'wreck' {
    const barricadeWeight = this.config.world.barricade.spawnWeight;
    const concreteWeight = this.config.world.concreteBlock.spawnWeight;
    const wreckWeight = this.config.world.wreckSpawnWeight;
    const totalWeight = barricadeWeight + concreteWeight + wreckWeight;
    const roll = Math.random() * totalWeight;

    if (roll < barricadeWeight) {
      return 'barricade';
    }

    if (roll < barricadeWeight + concreteWeight) {
      return 'concreteBlock';
    }

    return 'wreck';
  }

  private createBarricadeVariant(): Group {
    const group = new Group();
    group.position.y = this.config.world.barricade.yOffset;
    group.add(this.createFallbackBarricadeMesh());
    return group;
  }

  private createFallbackBarricadeMesh(): Group {
    const group = new Group();

    const base = new Mesh(
      BARRICADE_FALLBACK_BASE,
      new MeshStandardMaterial({
        color: 0xe1ddd3,
        flatShading: true,
        roughness: 0.96,
      }),
    );
    base.position.y = 0.42;
    group.add(base);

    const upperRail = new Mesh(
      new BoxGeometry(2.3, 0.16, 0.9),
      new MeshStandardMaterial({
        color: 0xd9d2c6,
        flatShading: true,
        roughness: 0.94,
      }),
    );
    upperRail.position.y = 0.89;
    group.add(upperRail);

    const stripe = new Mesh(
      new BoxGeometry(2.34, 0.18, 0.92),
      new MeshStandardMaterial({
        color: 0xd06d2f,
        flatShading: true,
        roughness: 0.88,
      }),
    );
    stripe.position.y = 0.57;
    group.add(stripe);

    return group;
  }

  private createConcreteBlockVariant(): Group {
    const group = new Group();
    group.position.y = this.config.world.concreteBlock.yOffset;
    group.add(this.createFallbackConcreteBlockMesh());
    return group;
  }

  private createFallbackConcreteBlockMesh(): Group {
    const group = new Group();

    const base = new Mesh(
      CONCRETE_FALLBACK_BASE,
      new MeshStandardMaterial({
        color: 0xbab9b3,
        flatShading: true,
        roughness: 1,
      }),
    );
    base.position.y = 0.44;
    group.add(base);

    const cap = new Mesh(
      CONCRETE_FALLBACK_CAP,
      new MeshStandardMaterial({
        color: 0xd0cec8,
        flatShading: true,
        roughness: 1,
      }),
    );
    cap.position.y = 0.96;
    group.add(cap);

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

  private createCarVariant(): Group {
    const group = new Group();
    group.position.y = this.config.world.car.yOffset;
    group.add(this.createFallbackCarMesh());
    return group;
  }

  private createFallbackCarMesh(): Group {
    const group = new Group();
    group.rotation.y = Math.PI * 0.5;

    const bodyMaterial = new MeshStandardMaterial({
      color: 0x4e5963,
      flatShading: true,
      roughness: 0.9,
      metalness: 0.08,
    });
    const trimMaterial = new MeshStandardMaterial({
      color: 0x202328,
      flatShading: true,
      roughness: 0.94,
      metalness: 0.04,
    });
    const glassMaterial = new MeshStandardMaterial({
      color: 0x8ca6bb,
      flatShading: true,
      roughness: 0.42,
      metalness: 0.06,
    });

    const body = new Mesh(CAR_FALLBACK_BODY, bodyMaterial);
    body.position.y = 0.44;
    group.add(body);

    const cabin = new Mesh(CAR_FALLBACK_CABIN, bodyMaterial);
    cabin.position.set(0, 0.87, -0.08);
    group.add(cabin);

    const hood = new Mesh(CAR_FALLBACK_HOOD, trimMaterial);
    hood.position.set(0, 0.58, 1.04);
    hood.rotation.x = -0.06;
    group.add(hood);

    const windshield = new Mesh(
      new BoxGeometry(1.18, 0.22, 0.68),
      glassMaterial,
    );
    windshield.position.set(0, 0.95, 0.34);
    windshield.rotation.x = -0.22;
    group.add(windshield);

    for (const x of [-0.86, 0.86]) {
      for (const z of [-1.08, 1.08]) {
        const wheel = new Mesh(CAR_FALLBACK_WHEEL, trimMaterial);
        wheel.rotation.z = Math.PI * 0.5;
        wheel.position.set(x, 0.24, z);
        group.add(wheel);
      }
    }

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

  private spawnBreakEffect(obstacle: ObstacleRecord): void {
    const effect = this.breakEffects.find((entry) => !entry.active);
    if (!effect) {
      return;
    }

    const colors = this.getBreakColors(obstacle.type);
    const burst = this.config.world.breakEffect;
    effect.active = true;
    effect.life = burst.lifetime;
    effect.maxLife = burst.lifetime;
    effect.group.visible = true;
    effect.group.position.copy(obstacle.mesh.position);
    effect.group.position.y = this.config.world.roadSurfaceY + 0.14;

    for (let index = 0; index < effect.pieces.length; index += 1) {
      const piece = effect.pieces[index];
      const material = piece.mesh.material as MeshStandardMaterial;
      const useAccent = index % 3 === 0;
      piece.mesh.visible = true;
      piece.baseScale = burst.pieceSize * randomRange(0.74, 1.26);
      piece.mesh.scale.setScalar(piece.baseScale);
      piece.mesh.position.set(
        randomRange(-0.3, 0.3),
        randomRange(0.12, 0.86),
        randomRange(-0.22, 0.22),
      );
      piece.mesh.rotation.set(
        randomRange(-0.8, 0.8),
        randomRange(-0.8, 0.8),
        randomRange(-0.8, 0.8),
      );
      piece.velocity.set(
        randomRange(-1, 1) * burst.horizontalSpeed,
        burst.upwardSpeed + randomRange(-0.1, 1.2),
        randomRange(-0.45, 0.85) * burst.horizontalSpeed * 0.7,
      );
      piece.rotationVelocity.set(
        randomRange(-7, 7),
        randomRange(-7, 7),
        randomRange(-7, 7),
      );
      material.color.setHex(useAccent ? colors.accent : colors.base);
      material.opacity = 1;
    }

    for (let index = 0; index < effect.dust.length; index += 1) {
      const puff = effect.dust[index];
      const material = puff.material as MeshBasicMaterial;
      const baseScale = burst.dustSize * randomRange(0.72, 1.15);
      puff.visible = true;
      puff.position.set(
        randomRange(-0.32, 0.32),
        randomRange(0.02, 0.1),
        randomRange(-0.18, 0.18),
      );
      puff.scale.setScalar(baseScale);
      puff.userData.baseScale = baseScale;
      material.color.setHex(colors.dust);
      material.opacity = 0.3;
    }
  }

  private getBreakColors(type: ActiveObstacle['type']): {
    base: number;
    accent: number;
    dust: number;
  } {
    if (type === 'barricade') {
      return {
        base: this.config.world.barricade.tintColor,
        accent: 0xd57a39,
        dust: 0xb1a89d,
      };
    }

    if (type === 'concreteBlock') {
      return {
        base: this.config.world.concreteBlock.tintColor,
        accent: 0x8c8d88,
        dust: 0x767772,
      };
    }

    if (type === 'car') {
      return {
        base: 0x4e5963,
        accent: 0x23272c,
        dust: 0x5b6168,
      };
    }

    return {
      base: 0x6e3f39,
      accent: 0x3f3a39,
      dust: 0x58514e,
    };
  }

  private playObstacleImpactSound(obstacle: ObstacleRecord): void {
    const baseVolume = this.config.world.audio.obstacleImpactVolume;

    if (obstacle.type === 'barrel') {
      this.obstacleImpactSound.play(baseVolume * 0.82, randomRange(0.88, 0.95));
      return;
    }

    if (obstacle.type === 'wreck') {
      this.obstacleImpactSound.play(baseVolume * 0.9, randomRange(0.84, 0.92));
      return;
    }

    if (obstacle.type === 'car') {
      this.obstacleImpactSound.play(baseVolume * 1.06, randomRange(0.72, 0.82));
      return;
    }

    if (obstacle.type === 'concreteBlock') {
      this.obstacleImpactSound.play(baseVolume, randomRange(0.9, 0.98));
      return;
    }

    this.obstacleImpactSound.play(baseVolume * 0.96, randomRange(0.96, 1.04));
  }

  private async loadBarrelAssets(): Promise<void> {
    if (this.barrelLoadPromise) {
      return this.barrelLoadPromise;
    }

    this.barrelLoadPromise = this.loadObstacleTemplate(
      this.config.world.barrel.assetPath,
    )
      .then((template) => {
        this.barrelTemplate = template;
        for (const obstacle of this.obstacles) {
          this.applyBarrelVisual(obstacle);
        }
      })
      .catch((error) => {
        console.warn('Failed to load optimized barrel obstacle, using fallback mesh.', error);
      });

    return this.barrelLoadPromise;
  }

  private async loadBarricadeAssets(): Promise<void> {
    if (this.barricadeLoadPromise) {
      return this.barricadeLoadPromise;
    }

    this.barricadeLoadPromise = this.loadObstacleTemplate(
      this.config.world.barricade.assetPath,
    )
      .then((template) => {
        this.barricadeTemplate = template;
        for (const obstacle of this.obstacles) {
          this.applyBarricadeVisual(obstacle);
        }
      })
      .catch((error) => {
        console.warn('Failed to load barricade obstacle, using fallback mesh.', error);
      });

    return this.barricadeLoadPromise;
  }

  private async loadConcreteBlockAssets(): Promise<void> {
    if (this.concreteBlockLoadPromise) {
      return this.concreteBlockLoadPromise;
    }

    this.concreteBlockLoadPromise = this.loadObstacleTemplate(
      this.config.world.concreteBlock.assetPath,
    )
      .then((template) => {
        this.concreteBlockTemplate = template;
        for (const obstacle of this.obstacles) {
          this.applyConcreteBlockVisual(obstacle);
        }
      })
      .catch((error) => {
        console.warn('Failed to load concrete block obstacle, using fallback mesh.', error);
      });

    return this.concreteBlockLoadPromise;
  }

  private async loadCarAssets(): Promise<void> {
    if (this.carLoadPromise) {
      return this.carLoadPromise;
    }

    this.carLoadPromise = this.loadObstacleTemplate(
      this.config.world.car.assetPath,
    )
      .catch(async (error) => {
        console.warn('Failed to load textured car obstacle, falling back to base mesh.', error);
        return this.loadObstacleTemplate(this.config.world.car.fallbackAssetPath);
      })
      .then((template) => {
        this.carTemplate = template;
        for (const obstacle of this.obstacles) {
          this.applyCarVisual(obstacle);
        }
      })
      .catch((error) => {
        console.warn('Failed to load car obstacle, using fallback mesh.', error);
      });

    return this.carLoadPromise;
  }

  private async loadObstacleTemplate(assetPath: string): Promise<Group> {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(assetPath);
    this.prepareObstacleTemplate(gltf.scene);
    return gltf.scene;
  }

  private prepareObstacleTemplate(root: Group): void {
    root.traverse((object) => {
      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.frustumCulled = false;
      if (Array.isArray(maybeMesh.material)) {
        for (const material of maybeMesh.material) {
          material.depthWrite = true;
        }
      } else {
        maybeMesh.material.depthWrite = true;
      }
    });
  }

  private applyBarricadeVisual(obstacle: ObstacleRecord): void {
    this.replaceVariantVisual(
      obstacle.barricadeVariant,
      this.barricadeTemplate,
      () => this.createFallbackBarricadeMesh(),
      this.config.world.barricade.scale,
      this.config.world.barricade.yOffset,
    );
  }

  private applyConcreteBlockVisual(obstacle: ObstacleRecord): void {
    this.replaceVariantVisual(
      obstacle.concreteBlockVariant,
      this.concreteBlockTemplate,
      () => this.createFallbackConcreteBlockMesh(),
      this.config.world.concreteBlock.scale,
      this.config.world.concreteBlock.yOffset,
    );
  }

  private applyBarrelVisual(obstacle: ObstacleRecord): void {
    this.replaceVariantVisual(
      obstacle.barrelVariant,
      this.barrelTemplate,
      () => this.createFallbackBarrelMesh(),
      this.config.world.barrel.scale,
      0.56,
      obstacle.id,
    );
  }

  private applyCarVisual(obstacle: ObstacleRecord): void {
    obstacle.carVariant.clear();
    obstacle.carVariant.position.y = this.config.world.car.yOffset;
    const visual = this.carTemplate ? this.carTemplate.clone(true) : this.createFallbackCarMesh();
    visual.scale.setScalar(this.config.world.car.scale);
    obstacle.carVariant.add(visual);
  }

  private replaceVariantVisual(
    target: Group,
    template: Group | null,
    fallbackFactory: () => Group,
    scale: number,
    yOffset: number,
    obstacleId?: number,
  ): void {
    target.clear();
    target.position.y = yOffset;
    const visual = template ? template.clone(true) : fallbackFactory();
    visual.scale.setScalar(scale);
    target.add(visual);

    if (obstacleId !== undefined) {
      this.assignObstacleId(target, obstacleId);
    }
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
      effect.group.position.z += scrollDistance;

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

  private updateBreakEffects(deltaTime: number, scrollDistance: number): void {
    for (const effect of this.breakEffects) {
      if (!effect.active) {
        continue;
      }

      effect.life -= deltaTime;
      effect.group.position.z += scrollDistance;

      if (effect.life <= 0) {
        this.deactivateBreakEffect(effect);
        continue;
      }

      const progress = 1 - effect.life / effect.maxLife;
      const alpha = 1 - progress;

      for (const piece of effect.pieces) {
        const material = piece.mesh.material as MeshStandardMaterial;
        piece.mesh.position.addScaledVector(piece.velocity, deltaTime);
        piece.velocity.y -= this.config.world.breakEffect.gravity * deltaTime;
        piece.mesh.rotation.x += piece.rotationVelocity.x * deltaTime;
        piece.mesh.rotation.y += piece.rotationVelocity.y * deltaTime;
        piece.mesh.rotation.z += piece.rotationVelocity.z * deltaTime;
        piece.mesh.scale.setScalar(piece.baseScale * (1 - progress * 0.08));
        material.opacity = alpha;

        if (piece.mesh.position.y < 0.04) {
          piece.mesh.position.y = 0.04;
          piece.velocity.x *= 0.94;
          piece.velocity.z *= 0.94;
          piece.velocity.y *= -0.12;
        }
      }

      for (const puff of effect.dust) {
        const material = puff.material as MeshBasicMaterial;
        const baseScale = (puff.userData.baseScale as number | undefined) ?? this.config.world.breakEffect.dustSize;
        puff.scale.setScalar(baseScale * (0.75 + progress * 1.65));
        material.opacity = 0.28 * alpha;
      }
    }
  }

  private deactivateBreakEffect(effect: BreakEffect): void {
    effect.active = false;
    effect.life = 0;
    effect.maxLife = 0;
    effect.group.visible = false;
    effect.group.position.set(0, 0, 999);

    for (const piece of effect.pieces) {
      const material = piece.mesh.material as MeshStandardMaterial;
      piece.mesh.visible = false;
      piece.mesh.position.set(0, 0, 0);
      piece.velocity.set(0, 0, 0);
      piece.rotationVelocity.set(0, 0, 0);
      material.opacity = 0;
    }

    for (const puff of effect.dust) {
      const material = puff.material as MeshBasicMaterial;
      puff.visible = false;
      puff.position.set(0, 0, 0);
      puff.scale.setScalar(0.001);
      material.opacity = 0;
      puff.userData.baseScale = undefined;
    }
  }

}
