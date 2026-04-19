import type { GameConfig, RunSegment, ZombieType } from '../../core/types';
import { lerp, randomInt, randomRange } from '../../core/utils';
import type { EnemySystem } from './EnemySystem';

export class SpawnSystem {
  elapsedSeconds = 0;
  segment: RunSegment = 'rest';

  private nextSpawnIn = 0.7;
  private runnerCooldown = 0;

  constructor(private readonly config: GameConfig) {}

  reset(): void {
    this.elapsedSeconds = 0;
    this.nextSpawnIn = 0.7;
    this.segment = 'rest';
    this.runnerCooldown = 0;
  }

  update(deltaTime: number, enemies: EnemySystem, segment: RunSegment): void {
    this.elapsedSeconds += deltaTime;
    this.segment = segment;
    this.nextSpawnIn -= deltaTime;
    this.runnerCooldown = Math.max(0, this.runnerCooldown - deltaTime);

    if (this.nextSpawnIn > 0) {
      return;
    }

    const ramp = Math.min(this.elapsedSeconds / this.config.spawn.rampDuration, 1);
    const spawnInterval = lerp(
      this.config.spawn.intervalStart,
      this.config.spawn.intervalEnd,
      ramp,
    ) * this.config.pacing.spawnIntervalMultiplier[segment];
    this.nextSpawnIn = spawnInterval;

    const batchSize =
      1 + (
        Math.random() <
        this.config.spawn.batchChance +
          this.config.pacing.batchChanceBonus[segment] +
          ramp * 0.18
        ? 1
        : 0
      );
    const availableLanes = [...this.config.world.laneCenters];

    for (let index = 0; index < batchSize; index += 1) {
      if (enemies.getActiveCount() >= this.config.enemies.poolSize - 2) {
        break;
      }

      const laneIndex = randomInt(0, availableLanes.length - 1);
      const laneX = availableLanes.splice(laneIndex, 1)[0] ?? 0;
      const spawnZ = randomRange(
        this.config.enemies.spawnMinZ,
        this.config.enemies.spawnMaxZ,
      ) - index * randomRange(5, 9);

      const zombieType = this.pickZombieType(ramp);
      enemies.spawn(zombieType, laneX, spawnZ);
      if (zombieType === 'runner') {
        this.runnerCooldown = this.segment === 'dark' ? 2.6 : 3.1;
      }
      if (availableLanes.length === 0) {
        availableLanes.push(...this.config.world.laneCenters);
      }
    }

    if (
      segment === 'chaos' &&
      Math.random() < this.config.spawn.laneGroupChance &&
      enemies.getActiveCount() < this.config.enemies.poolSize - 1
    ) {
      const laneIndex = randomInt(0, this.config.world.laneCenters.length - 1);
      const laneX = this.config.world.laneCenters[laneIndex] ?? 0;
      enemies.spawn('walker', laneX + randomRange(-0.38, 0.38), randomRange(-112, -96));
    }
  }

  // The ramp keeps early seconds readable, then layers faster threats and tanks later.
  private pickZombieType(ramp: number): ZombieType {
    const weights: Array<{ type: ZombieType; weight: number }> = [
      {
        type: 'walker',
        weight:
          1.42 -
          ramp * 0.18 +
          (this.segment === 'rest' ? 0.18 : this.segment === 'dark' ? 0.04 : -0.04),
      },
      {
        type: 'runner',
        weight:
          ramp < 0.18 || this.runnerCooldown > 0
            ? 0
            : 0.08 +
              ramp * 0.42 +
              (this.segment === 'dark' ? 0.14 : this.segment === 'chaos' ? 0.08 : -0.04),
      },
      {
        type: 'tank',
        weight:
          ramp < 0.5
            ? 0
            : (ramp - 0.5) * 0.56 +
              (this.segment === 'chaos' ? 0.12 : this.segment === 'rest' ? -0.08 : 0.02),
      },
    ];

    const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const entry of weights) {
      roll -= entry.weight;
      if (roll <= 0) {
        return entry.type;
      }
    }

    return 'walker';
  }
}
