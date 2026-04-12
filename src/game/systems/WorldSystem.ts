import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
} from 'three';
import type { ActiveObstacle, GameConfig } from '../../core/types';
import { randomInt, randomRange } from '../../core/utils';

type ObstacleRecord = ActiveObstacle & {
  barrierVariant: Group;
  wreckVariant: Group;
};

type HighwayChunk = {
  group: Group;
};

const ROAD_GEOMETRY = new BoxGeometry(22, 0.4, 40);
const SHOULDER_GEOMETRY = new BoxGeometry(3.2, 0.25, 40);
const DASH_GEOMETRY = new BoxGeometry(0.24, 0.03, 2.4);
const GUARD_GEOMETRY = new BoxGeometry(0.18, 0.4, 6.2);
const DEBRIS_GEOMETRY = new BoxGeometry(0.6, 0.35, 0.8);

export class WorldSystem {
  private readonly worldRoot = new Group();
  private readonly chunks: HighwayChunk[] = [];
  private readonly obstacles: ObstacleRecord[] = [];
  private nextObstacleZ = -34;

  constructor(
    private readonly scene: Scene,
    private readonly config: GameConfig,
  ) {
    this.scene.add(this.worldRoot);
    this.createChunks();
    this.createObstacles();
    this.reset();
  }

  reset(): void {
    this.positionChunks();

    this.nextObstacleZ = -34;
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
      }
    }

    return collisionDamage;
  }

  private createChunks(): void {
    for (let index = 0; index < this.config.world.chunkCount; index += 1) {
      const chunkGroup = new Group();

      const road = new Mesh(
        ROAD_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x2f2d32,
          flatShading: true,
          roughness: 1,
        }),
      );
      road.position.y = -0.42;
      chunkGroup.add(road);

      const leftShoulder = new Mesh(
        SHOULDER_GEOMETRY,
        new MeshStandardMaterial({
          color: 0x76614f,
          flatShading: true,
          roughness: 1,
        }),
      );
      leftShoulder.position.set(-12.5, -0.52, 0);
      chunkGroup.add(leftShoulder);

      const rightShoulder = leftShoulder.clone();
      rightShoulder.position.x = 12.5;
      chunkGroup.add(rightShoulder);

      for (const x of [-3.66, 3.66]) {
        for (let dashIndex = 0; dashIndex < 10; dashIndex += 1) {
          const dash = new Mesh(
            DASH_GEOMETRY,
            new MeshStandardMaterial({
              color: 0xf0e6c8,
              flatShading: true,
              roughness: 0.9,
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
              color: 0x8d7662,
              flatShading: true,
              roughness: 0.85,
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
            color: debrisIndex % 2 === 0 ? 0x5b493d : 0x7e5a48,
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

      mesh.add(barrierVariant, wreckVariant);
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

    obstacle.mesh.position.set(
      laneCenter + randomRange(-0.45, 0.45),
      0,
      this.nextObstacleZ,
    );
    obstacle.mesh.rotation.y = randomRange(-0.28, 0.28);
    obstacle.hasHitPlayer = false;
    obstacle.lane = laneIndex;
    obstacle.damage = this.config.world.obstacleDamage + randomInt(0, 3);
    obstacle.type = Math.random() < 0.55 ? 'barrier' : 'wreck';
    obstacle.barrierVariant.visible = obstacle.type === 'barrier';
    obstacle.wreckVariant.visible = obstacle.type === 'wreck';
    obstacle.width = obstacle.type === 'barrier' ? 2.4 : 2.9;
    obstacle.depth = obstacle.type === 'barrier' ? 2.2 : 3.2;

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
        color: 0xba9166,
        flatShading: true,
        roughness: 0.92,
      }),
    );
    base.position.y = 0.42;
    group.add(base);

    const stripe = new Mesh(
      new BoxGeometry(2.28, 0.16, 1.16),
      new MeshStandardMaterial({
        color: 0x3c2415,
        flatShading: true,
        roughness: 0.9,
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
        color: 0x5b2121,
        flatShading: true,
        roughness: 0.88,
      }),
    );
    body.position.y = 0.5;
    group.add(body);

    const roof = new Mesh(
      new BoxGeometry(1.5, 0.44, 1.2),
      new MeshStandardMaterial({
        color: 0x8b3a2a,
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
        color: 0x332222,
        flatShading: true,
        roughness: 0.96,
      }),
    );
    hood.position.set(0.66, 0.82, 0);
    hood.rotation.z = -0.2;
    group.add(hood);

    return group;
  }
}
