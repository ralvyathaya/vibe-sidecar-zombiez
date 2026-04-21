import type { GameConfig, RewardEvent, RewardState } from '../../core/types';
import { randomRange } from '../../core/utils';
import { SoundEffectPool } from '../audio/SoundEffectPool';

const STORAGE_KEYS = {
  bestScore: 'dead-rush-high-score',
  bestChain: 'dead-rush-best-chain',
  lastRunScore: 'dead-rush-last-run-score',
} as const;

export class RewardSystem {
  private readonly state: RewardState;
  private readonly rewardSound: SoundEffectPool;
  private readonly recentKillTimes: number[] = [];
  private elapsedSeconds = 0;
  private nextFixedMilestoneIndex = 0;
  private nextRepeatingMilestoneTime = 0;
  private finalizedRun = false;

  constructor(private readonly config: GameConfig) {
    this.state = this.createInitialState();
    this.rewardSound = new SoundEffectPool(this.config.rewards.audio.rewardPath, {
      poolSize: 4,
      volume: this.config.rewards.audio.rewardVolume,
      playbackRate: 1,
    });
    this.rewardSound.prime();
    this.resetRun();
  }

  destroy(): void {
    this.rewardSound.destroy();
  }

  resetRun(): void {
    this.elapsedSeconds = 0;
    this.recentKillTimes.length = 0;
    this.nextFixedMilestoneIndex = 0;
    this.nextRepeatingMilestoneTime =
      this.config.rewards.milestoneTimes[this.config.rewards.milestoneTimes.length - 1] +
      this.config.rewards.repeatingMilestoneEvery;
    this.finalizedRun = false;
    this.state.chainCount = 0;
    this.state.chainTimer = 0;
    this.state.chainTimerRatio = 0;
    this.state.multiplier = 1;
    this.state.bestChain = 0;
    this.state.comboBonusTotal = 0;
    this.state.milestoneBonusTotal = 0;
    this.state.explosiveBonusTotal = 0;
    this.state.recentCallout = '';
    this.state.recentCalloutTimer = 0;
    this.state.bestScore = this.readStoredNumber(STORAGE_KEYS.bestScore);
    this.state.bestChainRecord = this.readStoredNumber(STORAGE_KEYS.bestChain);
    this.state.lastRunScore = this.readStoredNumber(STORAGE_KEYS.lastRunScore);
  }

  update(deltaTime: number, elapsedSeconds: number): number {
    this.elapsedSeconds = elapsedSeconds;
    this.state.recentCalloutTimer = Math.max(0, this.state.recentCalloutTimer - deltaTime);
    if (this.state.recentCalloutTimer <= 0) {
      this.state.recentCallout = '';
    }

    if (this.state.chainCount > 0) {
      this.state.chainTimer = Math.max(0, this.state.chainTimer - deltaTime);
      if (this.state.chainTimer <= 0) {
        this.breakChain('CHAIN LOST', this.config.rewards.chainLostCalloutDuration);
      }
    }

    this.state.chainTimerRatio =
      this.state.chainCount > 0
        ? this.state.chainTimer / this.config.rewards.chainDuration
        : 0;

    return this.applyMilestones(elapsedSeconds);
  }

  registerKills(events: RewardEvent[]): number {
    if (events.length === 0) {
      return 0;
    }

    const startingMultiplier = this.state.multiplier;
    const eventTime = this.elapsedSeconds;
    const previousDoubleCount = this.countRecentKills(
      this.config.rewards.doubleKillWindow,
      eventTime,
    );
    const previousTripleCount = this.countRecentKills(
      this.config.rewards.tripleKillWindow,
      eventTime,
    );

    let awardedScore = 0;
    let dangerBonus = 0;
    let cueLevel: 'none' | 'minor' | 'major' | 'peak' = 'none';

    for (const event of events) {
      this.extendChain();
      awardedScore += Math.round(event.baseScore * this.state.multiplier);

      const eventDangerBonus =
        event.distanceToPlayer <= this.config.rewards.dangerKillDistance
          ? event.zombieType === 'tank'
            ? this.config.rewards.tankDangerKillBonus
            : this.config.rewards.dangerKillBonus
          : 0;

      if (eventDangerBonus > 0) {
        dangerBonus += eventDangerBonus;
      }

      this.recentKillTimes.push(eventTime);
    }

    this.trimKillTimes(eventTime);

    if (dangerBonus > 0) {
      this.state.comboBonusTotal += dangerBonus;
      awardedScore += dangerBonus;
    }

    const currentDoubleCount = this.countRecentKills(
      this.config.rewards.doubleKillWindow,
      eventTime,
    );
    const currentTripleCount = this.countRecentKills(
      this.config.rewards.tripleKillWindow,
      eventTime,
    );

    let callout = '';
    if (currentTripleCount >= 4 && previousTripleCount < 4) {
      awardedScore += this.config.rewards.bonuses.multiKill;
      this.state.comboBonusTotal += this.config.rewards.bonuses.multiKill;
      callout = `MULTI KILL +${this.config.rewards.bonuses.multiKill}`;
      cueLevel = 'peak';
    } else if (currentTripleCount >= 3 && previousTripleCount < 3) {
      awardedScore += this.config.rewards.bonuses.tripleKill;
      this.state.comboBonusTotal += this.config.rewards.bonuses.tripleKill;
      callout = `TRIPLE KILL +${this.config.rewards.bonuses.tripleKill}`;
      cueLevel = 'major';
    } else if (currentDoubleCount >= 2 && previousDoubleCount < 2) {
      awardedScore += this.config.rewards.bonuses.doubleKill;
      this.state.comboBonusTotal += this.config.rewards.bonuses.doubleKill;
      callout = `DOUBLE KILL +${this.config.rewards.bonuses.doubleKill}`;
      cueLevel = 'major';
    }

    const explosiveKillCount = events.filter((event) => event.wasExplosive).length;
    if (explosiveKillCount >= 2) {
      const explosiveBonus =
        (explosiveKillCount - 1) * this.config.rewards.explosiveBonusPerExtraKill;
      awardedScore += explosiveBonus;
      this.state.explosiveBonusTotal += explosiveBonus;
      if (!callout) {
        callout = `EXPLOSIVE BONUS +${explosiveBonus}`;
      }
      cueLevel = this.promoteCue(cueLevel, explosiveKillCount >= 3 ? 'major' : 'minor');
    }

    if (!callout && dangerBonus > 0) {
      callout = `DANGER KILL +${dangerBonus}`;
    }

    if (this.state.multiplier > startingMultiplier) {
      cueLevel = this.promoteCue(
        cueLevel,
        this.state.multiplier >= 2 ? 'major' : 'minor',
      );
    }

    if (callout) {
      this.setCallout(callout, this.config.rewards.calloutDuration);
    }

    if (cueLevel !== 'none') {
      this.playRewardCue(cueLevel);
    }

    return awardedScore;
  }

  breakChainFromDamage(): void {
    if (this.state.chainCount <= 0) {
      return;
    }

    this.breakChain('CHAIN LOST', this.config.rewards.chainLostCalloutDuration);
  }

  finalizeRun(finalScore: number): void {
    if (this.finalizedRun) {
      return;
    }

    this.state.lastRunScore = finalScore;
    if (finalScore > this.state.bestScore) {
      this.state.bestScore = finalScore;
    }
    if (this.state.bestChain > this.state.bestChainRecord) {
      this.state.bestChainRecord = this.state.bestChain;
    }

    this.writeStoredNumber(STORAGE_KEYS.lastRunScore, this.state.lastRunScore);
    this.writeStoredNumber(STORAGE_KEYS.bestScore, this.state.bestScore);
    this.writeStoredNumber(STORAGE_KEYS.bestChain, this.state.bestChainRecord);
    this.finalizedRun = true;
  }

  getState(): RewardState {
    return this.state;
  }

  private applyMilestones(elapsedSeconds: number): number {
    let awardedScore = 0;

    while (
      this.nextFixedMilestoneIndex < this.config.rewards.milestoneTimes.length &&
      elapsedSeconds >= this.config.rewards.milestoneTimes[this.nextFixedMilestoneIndex]
    ) {
      const milestoneTime = this.config.rewards.milestoneTimes[this.nextFixedMilestoneIndex];
      const milestoneValue = this.config.rewards.milestoneValues[this.nextFixedMilestoneIndex];
      this.nextFixedMilestoneIndex += 1;
      this.state.milestoneBonusTotal += milestoneValue;
      awardedScore += milestoneValue;
      this.setCallout(`${milestoneTime}s SURVIVED +${milestoneValue}`);
      this.playRewardCue('milestone');
    }

    while (elapsedSeconds >= this.nextRepeatingMilestoneTime) {
      this.state.milestoneBonusTotal += this.config.rewards.repeatingMilestoneValue;
      awardedScore += this.config.rewards.repeatingMilestoneValue;
      this.setCallout(
        `${this.nextRepeatingMilestoneTime}s SURVIVED +${this.config.rewards.repeatingMilestoneValue}`,
      );
      this.playRewardCue('milestone');
      this.nextRepeatingMilestoneTime += this.config.rewards.repeatingMilestoneEvery;
    }

    return awardedScore;
  }

  private extendChain(): void {
    this.state.chainCount += 1;
    this.state.chainTimer = this.config.rewards.chainDuration;
    this.state.chainTimerRatio = 1;
    this.state.bestChain = Math.max(this.state.bestChain, this.state.chainCount);
    this.state.multiplier = this.resolveMultiplier(this.state.chainCount);
  }

  private breakChain(callout: string, duration: number): void {
    this.state.chainCount = 0;
    this.state.chainTimer = 0;
    this.state.chainTimerRatio = 0;
    this.state.multiplier = 1;
    this.recentKillTimes.length = 0;
    this.setCallout(callout, duration);
  }

  private resolveMultiplier(chainCount: number): number {
    let resolvedMultiplier = 1;
    for (const threshold of this.config.rewards.multiplierThresholds) {
      if (chainCount >= threshold.kills) {
        resolvedMultiplier = threshold.multiplier;
      }
    }
    return resolvedMultiplier;
  }

  private trimKillTimes(currentTime: number): void {
    const maxWindow = Math.max(
      this.config.rewards.doubleKillWindow,
      this.config.rewards.tripleKillWindow,
    );
    while (this.recentKillTimes.length > 0 && currentTime - this.recentKillTimes[0] > maxWindow) {
      this.recentKillTimes.shift();
    }
  }

  private countRecentKills(windowSeconds: number, currentTime: number): number {
    let count = 0;
    for (const timestamp of this.recentKillTimes) {
      if (currentTime - timestamp <= windowSeconds) {
        count += 1;
      }
    }
    return count;
  }

  private setCallout(text: string, duration = this.config.rewards.calloutDuration): void {
    this.state.recentCallout = text;
    this.state.recentCalloutTimer = duration;
  }

  private promoteCue(
    current: 'none' | 'minor' | 'major' | 'peak',
    next: 'minor' | 'major' | 'peak',
  ): 'minor' | 'major' | 'peak' {
    const order = { none: 0, minor: 1, major: 2, peak: 3 } as const;
    if (current === 'none') {
      return next;
    }
    return order[next] > order[current] ? next : current;
  }

  private playRewardCue(kind: 'minor' | 'major' | 'peak' | 'milestone'): void {
    let volume = this.config.rewards.audio.rewardVolume;
    let playbackRate = 1;

    if (kind === 'minor') {
      volume *= 0.9;
      playbackRate = randomRange(0.94, 0.99);
    } else if (kind === 'major') {
      volume *= 1.08;
      playbackRate = randomRange(1.01, 1.08);
    } else if (kind === 'peak') {
      volume *= 1.22;
      playbackRate = randomRange(1.08, 1.16);
    } else {
      volume *= 0.98;
      playbackRate = randomRange(0.9, 0.97);
    }

    this.rewardSound.play(volume, playbackRate);
  }

  private createInitialState(): RewardState {
    return {
      chainCount: 0,
      chainTimer: 0,
      chainTimerRatio: 0,
      multiplier: 1,
      bestChain: 0,
      comboBonusTotal: 0,
      milestoneBonusTotal: 0,
      explosiveBonusTotal: 0,
      recentCallout: '',
      recentCalloutTimer: 0,
      bestScore: 0,
      bestChainRecord: 0,
      lastRunScore: 0,
    };
  }

  private readStoredNumber(key: string): number {
    try {
      const value = window.localStorage.getItem(key);
      if (value === null) {
        return 0;
      }

      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  }

  private writeStoredNumber(key: string, value: number): void {
    try {
      window.localStorage.setItem(key, `${Math.max(0, Math.round(value))}`);
    } catch {
      // Storage is best-effort only; the run score still works without persistence.
    }
  }
}
