import type { GameConfig, RunEventType, RunSegment, ZombieType } from '../../core/types';
import { lerp, randomInt, randomRange } from '../../core/utils';
import type { EnemySystem } from './EnemySystem';

export class SpawnSystem {
  elapsedSeconds = 0;
  segment: RunSegment = 'rest';
  activeEvent: RunEventType = 'none';

  private nextSpawnIn = 0.7;
  private runnerCooldown = 0;
  private nextEventIn = 0;
  private eventTimer = 0;
  private eventDuration = 0;
  private lastEvent: Exclude<RunEventType, 'none'> | null = null;

  constructor(private readonly config: GameConfig) {}

  reset(): void {
    this.elapsedSeconds = 0;
    this.nextSpawnIn = 0.7;
    this.segment = 'rest';
    this.activeEvent = 'none';
    this.runnerCooldown = 0;
    this.nextEventIn = this.rollEventInterval();
    this.eventTimer = 0;
    this.eventDuration = 0;
    this.lastEvent = null;
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
    const spawnInterval = lerp(
      this.config.spawn.intervalStart,
      this.config.spawn.intervalEnd,
      ramp,
    ) *
      this.config.pacing.spawnIntervalMultiplier[segment] *
      (this.activeEvent === 'berserkWave'
        ? this.config.pacing.events.berserkSpawnMultiplier
        : 1);
    this.nextSpawnIn = spawnInterval;

    const batchSize =
      1 + (
        Math.random() <
        this.config.spawn.batchChance +
          this.config.pacing.batchChanceBonus[segment] +
          (this.activeEvent === 'berserkWave' ? this.config.pacing.events.berserkBatchBonus : 0) +
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

    if (
      (segment === 'chaos' || this.activeEvent === 'berserkWave') &&
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
          (this.elapsedSeconds < 20 ? 1.62 : this.elapsedSeconds < 55 ? 1.3 : 1.12) -
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
