import type { GameConfig, RunEventType, RunSegment, ZombieType } from '../../core/types';
import { lerp, randomInt, randomRange } from '../../core/utils';
import type { EnemySystem } from './EnemySystem';

export class SpawnSystem {
  elapsedSeconds = 0;
  segment: RunSegment = 'rest';
  activeEvent: RunEventType = 'none';

  private nextSpawnIn = 0.2;
  private runnerCooldown = 0;
  private nextEventIn = 0;
  private eventTimer = 0;
  private eventDuration = 0;
  private lastEvent: Exclude<RunEventType, 'none'> | null = null;
  private scriptedBerserkTriggered = false;
  private openingForcedWalkerSpawns = 3;

  constructor(private readonly config: GameConfig) {}

  reset(): void {
    this.elapsedSeconds = 0;
    this.nextSpawnIn = 0.2;
    this.segment = 'rest';
    this.activeEvent = 'none';
    this.runnerCooldown = 0;
    this.nextEventIn = this.rollEventInterval();
    this.eventTimer = 0;
    this.eventDuration = 0;
    this.lastEvent = null;
    this.scriptedBerserkTriggered = false;
    this.openingForcedWalkerSpawns = 3;
  }

  notifyLatchResolved(): void {
    this.runnerCooldown = Math.max(
      this.runnerCooldown,
      randomRange(this.config.spawn.runnerCooldownMin, this.config.spawn.runnerCooldownMax),
    );
  }

  getEventTimer(): number {
    return this.eventTimer;
  }

  getEventDuration(): number {
    return this.eventDuration;
  }

  update(deltaTime: number, enemies: EnemySystem, segment: RunSegment): void {
    this.elapsedSeconds += deltaTime;
    this.segment = segment;
    this.nextSpawnIn -= deltaTime;
    this.runnerCooldown = Math.max(0, this.runnerCooldown - deltaTime);
    this.updateEvents(deltaTime);

    if (this.nextSpawnIn > 0) {
      return;
    }

    const ramp = Math.min(this.elapsedSeconds / this.config.spawn.rampDuration, 1);
    const baseSpawnInterval = lerp(
      this.config.spawn.intervalStart,
      this.config.spawn.intervalEnd,
      ramp,
    ) *
      this.config.pacing.spawnIntervalMultiplier[segment] *
      (this.activeEvent === 'berserkWave'
        ? this.config.pacing.events.berserkSpawnMultiplier
        : 1);
    const spawnInterval = this.getScriptedSpawnInterval(baseSpawnInterval);
    this.nextSpawnIn = spawnInterval;

    const batchBonusChance =
      this.config.spawn.batchChance +
      this.config.pacing.batchChanceBonus[segment] +
      (this.activeEvent === 'berserkWave' ? this.config.pacing.events.berserkBatchBonus : 0) +
      ramp * 0.18 +
      this.getOpeningBatchBonusChance();
    const berserkExtraSpawn =
      this.activeEvent === 'berserkWave' && Math.random() < 0.42 ? 1 : 0;
    const guaranteedOpeningSpawn =
      this.elapsedSeconds >= 3 && this.elapsedSeconds < 12 && Math.random() < 0.58 ? 1 : 0;
    const batchSize =
      1 + (Math.random() < batchBonusChance ? 1 : 0) + berserkExtraSpawn + guaranteedOpeningSpawn;
    const availableLanes = [...this.config.world.laneCenters];

    for (let index = 0; index < batchSize; index += 1) {
      if (enemies.getActiveCount() >= this.config.enemies.poolSize - 2) {
        break;
      }

      const laneIndex = randomInt(0, availableLanes.length - 1);
      const laneX = availableLanes.splice(laneIndex, 1)[0] ?? 0;
      const { minZ, maxZ, spacingMin, spacingMax } = this.getSpawnWindow();
      const spawnZ = randomRange(minZ, maxZ) - index * randomRange(spacingMin, spacingMax);

      const zombieType = this.pickZombieType(ramp);
      if (
        zombieType === 'runner' &&
        enemies.getActiveCountByType('runner') >= this.config.spawn.runnerMaxActive
      ) {
        continue;
      }
      enemies.spawn(zombieType, laneX, spawnZ);
      if (zombieType === 'runner') {
        this.runnerCooldown = randomRange(
          this.config.spawn.runnerCooldownMin,
          this.config.spawn.runnerCooldownMax,
        );
      }
      if (availableLanes.length === 0) {
        availableLanes.push(...this.config.world.laneCenters);
      }
    }

    const laneGroupChance =
      this.config.spawn.laneGroupChance +
      (this.activeEvent === 'berserkWave' ? 0.18 : 0) +
      (this.elapsedSeconds < 14 ? 0.16 : this.elapsedSeconds < 30 ? 0.08 : 0);
    if (
      (segment === 'chaos' || this.activeEvent === 'berserkWave') &&
      Math.random() < laneGroupChance &&
      enemies.getActiveCount() < this.config.enemies.poolSize - 1
    ) {
      const laneIndex = randomInt(0, this.config.world.laneCenters.length - 1);
      const laneX = this.config.world.laneCenters[laneIndex] ?? 0;
      enemies.spawn('walker', laneX + randomRange(-0.38, 0.38), randomRange(-112, -96));
    }
  }

  // The ramp keeps early seconds readable, then layers faster threats and tanks later.
  private pickZombieType(ramp: number): ZombieType {
    if (this.openingForcedWalkerSpawns > 0 && this.elapsedSeconds < 8) {
      this.openingForcedWalkerSpawns -= 1;
      return 'walker';
    }

    const weights: Array<{ type: ZombieType; weight: number }> = [
      {
        type: 'walker',
        weight:
          (this.elapsedSeconds < 12 ? 1.9 : this.elapsedSeconds < 20 ? 1.68 : this.elapsedSeconds < 55 ? 1.3 : 1.12) -
          ramp * 0.12 +
          (this.segment === 'rest' ? 0.18 : this.segment === 'dark' ? 0.04 : -0.04) +
          (this.activeEvent === 'berserkWave' ? 0.16 : 0),
      },
      {
        type: 'runner',
        weight:
          this.elapsedSeconds < 20 || ramp < 0.18 || this.runnerCooldown > 0
            ? 0
            : 0.04 +
              (this.elapsedSeconds < 55 ? 0.06 : 0.1) +
              ramp * 0.24 +
              (this.segment === 'dark' ? 0.08 : this.segment === 'chaos' ? 0.04 : -0.02) +
              (this.activeEvent === 'berserkWave' ? this.config.pacing.events.berserkRunnerBonus : 0),
      },
      {
        type: 'tank',
        weight:
          this.elapsedSeconds < 55 || ramp < 0.45
            ? 0
            : (ramp - 0.45) * 0.42 +
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

  private getScriptedSpawnInterval(baseSpawnInterval: number): number {
    if (this.elapsedSeconds < 8) {
      return Math.min(baseSpawnInterval, 0.52);
    }
    if (this.elapsedSeconds < 12) {
      return Math.min(baseSpawnInterval, 0.62);
    }
    if (this.elapsedSeconds < 30) {
      return Math.min(baseSpawnInterval, baseSpawnInterval * 0.88);
    }
    return baseSpawnInterval;
  }

  private getOpeningBatchBonusChance(): number {
    if (this.elapsedSeconds < 8) {
      return 0.22;
    }
    if (this.elapsedSeconds < 18) {
      return 0.14;
    }
    if (this.elapsedSeconds < 30) {
      return 0.08;
    }
    return 0;
  }

  private getSpawnWindow(): {
    minZ: number;
    maxZ: number;
    spacingMin: number;
    spacingMax: number;
  } {
    if (this.elapsedSeconds < 6) {
      return {
        minZ: -94,
        maxZ: -78,
        spacingMin: 4,
        spacingMax: 6.2,
      };
    }
    if (this.elapsedSeconds < 12) {
      return {
        minZ: -100,
        maxZ: -84,
        spacingMin: 4.4,
        spacingMax: 7,
      };
    }
    return {
      minZ: this.config.enemies.spawnMinZ,
      maxZ: this.config.enemies.spawnMaxZ,
      spacingMin: 5,
      spacingMax: 9,
    };
  }

  private updateEvents(deltaTime: number): void {
    if (this.activeEvent !== 'none') {
      this.eventTimer = Math.max(0, this.eventTimer - deltaTime);
      if (this.eventTimer <= 0) {
        this.activeEvent = 'none';
        this.eventDuration = 0;
        this.nextEventIn = this.rollEventInterval();
      }
      return;
    }

    if (!this.scriptedBerserkTriggered) {
      if (this.elapsedSeconds < 40) {
        return;
      }

      this.activeEvent = 'berserkWave';
      this.lastEvent = 'berserkWave';
      this.eventDuration = 9;
      this.eventTimer = this.eventDuration;
      this.scriptedBerserkTriggered = true;
      return;
    }

    if (this.elapsedSeconds < this.config.pacing.events.warmup) {
      return;
    }

    this.nextEventIn -= deltaTime;
    if (this.nextEventIn > 0) {
      return;
    }

    const nextEvent = this.rollEventType();
    this.activeEvent = nextEvent;
    this.lastEvent = nextEvent;
    this.eventDuration = randomRange(
      this.config.pacing.events.durationMin,
      this.config.pacing.events.durationMax,
    );
    this.eventTimer = this.eventDuration;
  }

  private rollEventType(): Exclude<RunEventType, 'none'> {
    const pool: Array<Exclude<RunEventType, 'none'>> = [
      'berserkWave',
      'slipperyRoad',
      'blackoutStretch',
    ];
    const filtered = this.lastEvent ? pool.filter((event) => event !== this.lastEvent) : pool;
    return filtered[randomInt(0, filtered.length - 1)] ?? 'berserkWave';
  }

  private rollEventInterval(): number {
    return randomRange(
      this.config.pacing.events.intervalMin,
      this.config.pacing.events.intervalMax,
    );
  }
}
