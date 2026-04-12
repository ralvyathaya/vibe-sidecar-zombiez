import type { GameConfig, ZombieType } from '../../core/types';
import { lerp, randomInt, randomRange } from '../../core/utils';
import type { EnemySystem } from './EnemySystem';

export class SpawnSystem {
  elapsedSeconds = 0;

  private nextSpawnIn = 0.7;

  constructor(private readonly config: GameConfig) {}

  reset(): void {
    this.elapsedSeconds = 0;
    this.nextSpawnIn = 0.7;
  }

  update(deltaTime: number, enemies: EnemySystem): void {
    this.elapsedSeconds += deltaTime;
    this.nextSpawnIn -= deltaTime;

    if (this.nextSpawnIn > 0) {
      return;
    }

    const ramp = Math.min(this.elapsedSeconds / this.config.spawn.rampDuration, 1);
    const spawnInterval = lerp(
      this.config.spawn.intervalStart,
      this.config.spawn.intervalEnd,
      ramp,
    );
    this.nextSpawnIn = spawnInterval;

    const batchSize =
      1 + (Math.random() < this.config.spawn.batchChance + ramp * 0.18 ? 1 : 0);
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

      enemies.spawn(this.pickZombieType(ramp), laneX, spawnZ);
      if (availableLanes.length === 0) {
        availableLanes.push(...this.config.world.laneCenters);
      }
    }
  }

  // The ramp keeps early seconds readable, then layers faster threats and tanks later.
  private pickZombieType(ramp: number): ZombieType {
    const weights: Array<{ type: ZombieType; weight: number }> = [
      { type: 'walker', weight: 1.25 - ramp * 0.45 },
      { type: 'runner', weight: ramp < 0.12 ? 0 : 0.2 + ramp * 0.95 },
      { type: 'tank', weight: ramp < 0.45 ? 0 : (ramp - 0.45) * 0.9 },
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
