import type {
  DriverIntentType,
  DriverPromptDecision,
  DriverPromptResolution,
  DriverPromptState,
  GameConfig,
  LaneThreatState,
  RideState,
  RunSegment,
} from '../../core/types';
import { clamp, lerp, randomRange } from '../../core/utils';

export class DriverSystem {
  private laneIndex = 1;
  private targetLaneIndex = 1;
  private laneFromIndex = 1;
  private laneToIndex = 1;
  private laneChangeTimer = 0;
  private laneChangeDurationCurrent = 0;
  private laneRescanTimer = 0;
  private nextPromptIn = 0;
  private promptLockout = 0;
  private manualBoostTimer = 0;
  private brakeTimer = 0;
  private scrapeTimer = 0;
  private shakeOffTimer = 0;
  private forceGapTimer = 0;
  private cautiousHoldTimer = 0;
  private cutLeftBiasTimer = 0;
  private manualBrakeCooldown = 0;
  private manualBoostCooldown = 0;
  private segmentIndex = 0;
  private segment: RunSegment = 'rest';
  private segmentElapsed = 0;
  private prompt: DriverPromptState | null = null;
  private pendingResolution: DriverPromptResolution | null = null;
  private laneThreats: LaneThreatState[] = [];

  constructor(private readonly config: GameConfig) {
    this.reset();
  }

  reset(): void {
    this.laneIndex = 1;
    this.targetLaneIndex = 1;
    this.laneFromIndex = 1;
    this.laneToIndex = 1;
    this.laneChangeTimer = 0;
    this.laneChangeDurationCurrent = this.config.driver.laneChangeDuration;
    this.laneRescanTimer = 0;
    this.nextPromptIn = this.rollPromptTimer();
    this.promptLockout = 0;
    this.manualBoostTimer = 0;
    this.brakeTimer = 0;
    this.scrapeTimer = 0;
    this.shakeOffTimer = 0;
    this.forceGapTimer = 0;
    this.cautiousHoldTimer = 0;
    this.cutLeftBiasTimer = 0;
    this.manualBrakeCooldown = 0;
    this.manualBoostCooldown = 0;
    this.segmentIndex = 0;
    this.segment = this.config.pacing.sequence[0] ?? 'rest';
    this.segmentElapsed = 0;
    this.prompt = null;
    this.pendingResolution = null;
    this.laneThreats = this.createFallbackLaneThreats();
  }

  update(
    deltaTime: number,
    laneThreats: LaneThreatState[],
    hasLatch: boolean,
    failureSeverity: number,
  ): RideState {
    this.laneThreats = laneThreats.length > 0 ? laneThreats : this.createFallbackLaneThreats();
    this.segmentElapsed += deltaTime;
    this.advanceSegmentIfNeeded();

    this.laneRescanTimer = Math.max(0, this.laneRescanTimer - deltaTime);
    this.promptLockout = Math.max(0, this.promptLockout - deltaTime);
    this.manualBoostTimer = Math.max(0, this.manualBoostTimer - deltaTime);
    this.brakeTimer = Math.max(0, this.brakeTimer - deltaTime);
    this.scrapeTimer = Math.max(0, this.scrapeTimer - deltaTime);
    this.shakeOffTimer = Math.max(0, this.shakeOffTimer - deltaTime);
    this.forceGapTimer = Math.max(0, this.forceGapTimer - deltaTime);
    this.cautiousHoldTimer = Math.max(0, this.cautiousHoldTimer - deltaTime);
    this.cutLeftBiasTimer = Math.max(0, this.cutLeftBiasTimer - deltaTime);
    this.manualBrakeCooldown = Math.max(0, this.manualBrakeCooldown - deltaTime);
    this.manualBoostCooldown = Math.max(0, this.manualBoostCooldown - deltaTime);

    if (!hasLatch) {
      this.shakeOffTimer = 0;
      if (this.prompt?.intent === 'shakeItOff') {
        this.prompt = null;
        this.nextPromptIn = this.rollPromptTimer();
      }
    }

    if (this.prompt) {
      this.prompt.timer = Math.max(0, this.prompt.timer - deltaTime);
      if (this.prompt.timer <= 0) {
        this.resolvePrompt('timeout');
      }
    } else if (hasLatch && this.promptLockout <= 0 && !this.hasBlockingEffect()) {
      this.prompt = this.createPrompt('shakeItOff', "I'll shake it off!");
    } else if (!hasLatch && this.promptLockout <= 0 && !this.hasBlockingEffect()) {
      this.nextPromptIn -= deltaTime;
      if (this.nextPromptIn <= 0) {
        this.tryCreatePrompt(failureSeverity);
      }
    }

    if (!hasLatch && !this.prompt && this.laneRescanTimer <= 0) {
      this.laneRescanTimer = this.config.driver.laneRescanInterval;
      this.updateLaneChoice();
    }

    const laneAlpha =
      this.laneChangeTimer > 0
        ? 1 -
          clamp(
            this.laneChangeTimer / Math.max(this.laneChangeDurationCurrent, 0.0001),
            0,
            1,
          )
        : 1;

    if (this.laneChangeTimer > 0) {
      this.laneChangeTimer = Math.max(0, this.laneChangeTimer - deltaTime);
      if (this.laneChangeTimer <= 0) {
        this.laneIndex = this.laneToIndex;
        this.targetLaneIndex = this.laneToIndex;
        this.laneFromIndex = this.laneIndex;
      }
    }

    const fromCenter = this.resolveLaneCenter(this.laneFromIndex);
    const toCenter = this.resolveLaneCenter(this.laneToIndex);
    const laneCenterX = lerp(fromCenter, toCenter, laneAlpha);
    const speedMultiplier = this.getSpeedMultiplier(failureSeverity, hasLatch);
    const handlingPenalty = clamp(
      failureSeverity * this.config.ride.failureHandlingPenalty +
        (this.brakeTimer > 0 ? 0.05 : 0) +
        (this.scrapeTimer > 0 ? this.config.driver.scrapeHandlingPenalty : 0) +
        (this.shakeOffTimer > 0 ? this.config.driver.shakeOffHandlingPenalty : 0) +
        (this.forceGapTimer > 0 ? this.config.driver.forceGapHandlingPenalty : 0),
      0,
      0.92,
    );
    const aimShake =
      (this.scrapeTimer > 0 ? this.config.driver.scrapeAimShake : 0) +
      (this.shakeOffTimer > 0 ? this.config.driver.shakeOffAimShake : 0) +
      (this.forceGapTimer > 0 ? this.config.driver.forceGapAimShake : 0) +
      failureSeverity * this.config.player.failureAimShake;
    const cameraShake =
      (this.scrapeTimer > 0 ? this.config.driver.scrapeCameraShake : 0) +
      (this.shakeOffTimer > 0 ? this.config.driver.shakeOffCameraShake : 0) +
      (this.forceGapTimer > 0 ? this.config.driver.forceGapCameraShake : 0) +
      failureSeverity * this.config.vehicle.stage1Rig.failureShakeAmplitude;

    return {
      laneIndex: this.laneIndex,
      targetLaneIndex: this.laneToIndex,
      laneChangeAlpha: laneAlpha,
      laneCenterX,
      worldX: laneCenterX,
      forwardSpeed: this.config.player.forwardSpeed * speedMultiplier,
      speedMultiplier,
      handlingPenalty,
      aimShake,
      cameraShake,
      latchActive: hasLatch,
      latchWiggle: 0,
      latchWiggleRatio: 0,
      manualBrakeCooldown: this.manualBrakeCooldown,
      manualBoostCooldown: this.manualBoostCooldown,
      prompt: this.prompt,
      segment: this.segment,
      segmentElapsed: this.segmentElapsed,
      segmentDuration: this.config.pacing.durations[this.segment],
      scrapeMode: this.scrapeTimer > 0,
      shakeOffMode: this.shakeOffTimer > 0,
      forceGapMode: this.forceGapTimer > 0,
      failureSeverity,
      radarStrength: this.config.renderer.atmosphere[this.segment].radarStrength,
      laneThreats: this.laneThreats,
    };
  }

  triggerBrake(): void {
    if (this.prompt || this.manualBrakeCooldown > 0) {
      return;
    }

    this.brakeTimer = this.config.ride.brakeDuration;
    this.manualBoostTimer = 0;
    this.manualBrakeCooldown = this.config.ride.inputCooldown;
  }

  triggerBoost(): void {
    if (this.prompt || this.manualBoostCooldown > 0) {
      return;
    }

    this.manualBoostTimer = this.config.ride.boostDuration;
    this.brakeTimer = 0;
    this.manualBoostCooldown = this.config.ride.inputCooldown;
  }

  resolvePrompt(decision: DriverPromptDecision): void {
    if (!this.prompt) {
      return;
    }

    const { intent, targetLaneIndex } = this.prompt;
    this.prompt = null;
    this.nextPromptIn = this.rollPromptTimer();
    this.promptLockout = this.config.driver.promptEffectLockout;
    this.pendingResolution = {
      intent,
      decision,
      targetLaneIndex,
    };

    if (intent === 'cutLeft') {
      if ((decision === 'approve' || decision === 'timeout') && targetLaneIndex !== null) {
        this.startLaneChange(targetLaneIndex, this.config.driver.laneChangeCommitDuration);
        this.cutLeftBiasTimer = this.config.driver.cutLeftBiasDuration;
        this.cautiousHoldTimer = 0;
      } else {
        this.cautiousHoldTimer = this.config.driver.cautiousHoldDuration;
      }
      return;
    }

    if (intent === 'scrapeWreck') {
      if (decision === 'approve' || decision === 'timeout') {
        this.scrapeTimer = this.config.driver.scrapeDuration;
        this.manualBoostTimer = 0;
        this.brakeTimer = 0;
        this.cautiousHoldTimer = 0;
      } else {
        this.cautiousHoldTimer = this.config.driver.cautiousHoldDuration;
      }
      return;
    }

    if (intent === 'shakeItOff') {
      if (decision === 'approve' || decision === 'timeout') {
        this.shakeOffTimer = this.config.driver.shakeOffDuration;
        this.manualBoostTimer = 0;
        this.brakeTimer = 0;
        this.cautiousHoldTimer = 0;
      } else {
        this.cautiousHoldTimer = this.config.driver.cautiousHoldDuration * 0.6;
      }
      return;
    }

    if (decision === 'approve' || decision === 'timeout') {
      this.forceGapTimer = this.config.driver.forceGapDuration;
      this.cautiousHoldTimer = 0;
      if (targetLaneIndex !== null) {
        this.startLaneChange(targetLaneIndex, this.config.driver.laneChangeCommitDuration);
      }
    } else {
      this.cautiousHoldTimer = this.config.driver.cautiousHoldDuration;
    }
  }

  hasActivePrompt(): boolean {
    return this.prompt !== null;
  }

  getPrompt(): DriverPromptState | null {
    return this.prompt;
  }

  getSegment(): RunSegment {
    return this.segment;
  }

  clearLatchAssist(): void {
    this.shakeOffTimer = 0;
    if (this.prompt?.intent === 'shakeItOff') {
      this.prompt = null;
      this.nextPromptIn = this.rollPromptTimer();
    }
  }

  consumePromptResolution(): DriverPromptResolution | null {
    const resolution = this.pendingResolution;
    this.pendingResolution = null;
    return resolution;
  }

  private tryCreatePrompt(failureSeverity: number): void {
    const cutLeftCandidate = this.getCutLeftCandidate();
    if (cutLeftCandidate) {
      this.prompt = this.createPrompt(
        'cutLeft',
        "Hang on, I'm cutting left!",
        cutLeftCandidate.laneIndex,
      );
      return;
    }

    const scrapeCandidate = this.getScrapeCandidate();
    if (scrapeCandidate) {
      this.prompt = this.createPrompt(
        'scrapeWreck',
        "Duck, I'm scraping the wreck!",
        scrapeCandidate.laneIndex,
      );
      return;
    }

    const forceGapCandidate = this.getForceGapCandidate(failureSeverity);
    if (forceGapCandidate) {
      this.prompt = this.createPrompt(
        'forceGap',
        "There's a gap, I'm forcing through!",
        forceGapCandidate.laneIndex,
      );
      return;
    }

    this.nextPromptIn = this.rollPromptTimer();
  }

  private updateLaneChoice(): void {
    if (this.cautiousHoldTimer > 0 || this.forceGapTimer > 0 || this.shakeOffTimer > 0) {
      return;
    }

    const currentLane = this.getLaneThreat(this.targetLaneIndex);
    const bestLane = this.laneThreats
      .slice()
      .sort(
        (left, right) =>
          left.score - this.getLaneBias(left.laneIndex) -
          (right.score - this.getLaneBias(right.laneIndex)),
      )[0];
    if (!bestLane) {
      return;
    }

    if (bestLane.laneIndex === this.targetLaneIndex) {
      return;
    }

    if (bestLane.blocker && (bestLane.blockerDistance ?? Number.POSITIVE_INFINITY) < 26) {
      return;
    }

    const currentScore = currentLane.score;
    const bestScore = bestLane.score - this.getLaneBias(bestLane.laneIndex);
    const currentHasHardThreat =
      currentLane.blocker || currentLane.bruteCount > 0 || currentLane.smallCount >= 3;
    const shouldChange =
      currentHasHardThreat ||
      bestScore + this.config.driver.scoreMarginToChange < currentScore;
    if (!shouldChange) {
      return;
    }

    this.startLaneChange(bestLane.laneIndex, this.config.driver.laneChangeDuration);
  }

  private getCutLeftCandidate(): LaneThreatState | null {
    if (this.targetLaneIndex <= 0) {
      return null;
    }

    const leftLane = this.getLaneThreat(this.targetLaneIndex - 1);
    const currentLane = this.getLaneThreat(this.targetLaneIndex);
    if (leftLane.blocker && (leftLane.blockerDistance ?? Number.POSITIVE_INFINITY) < 24) {
      return null;
    }

    const leftScore = leftLane.score - this.config.driver.cutLeftLaneBonus;
    if (leftScore + this.config.driver.scoreMarginToChange >= currentLane.score) {
      return null;
    }

    return leftLane;
  }

  private getScrapeCandidate(): LaneThreatState | null {
    const currentLane = this.getLaneThreat(this.targetLaneIndex);
    const blockerDistance = currentLane.blockerDistance ?? Number.POSITIVE_INFINITY;
    if (!currentLane.blocker || blockerDistance > 18) {
      return null;
    }

    if (currentLane.blockerType !== 'car' && currentLane.blockerType !== 'wreck') {
      return null;
    }

    return currentLane;
  }

  private getForceGapCandidate(failureSeverity: number): LaneThreatState | null {
    if (failureSeverity >= 0.72) {
      return null;
    }

    const currentLane = this.getLaneThreat(this.targetLaneIndex);
    const blockerDistance = currentLane.blockerDistance ?? Number.POSITIVE_INFINITY;
    if (!currentLane.blocker || blockerDistance > 28) {
      return null;
    }

    let bestCandidate: LaneThreatState | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const lane of this.laneThreats) {
      if (lane.laneIndex === this.targetLaneIndex) {
        continue;
      }

      if (lane.blocker && (lane.blockerDistance ?? Number.POSITIVE_INFINITY) < 24) {
        continue;
      }

      if (lane.bruteCount > 0) {
        continue;
      }

      const roughness =
        (lane.brokenLane ? 1.15 : 0) +
        (lane.pothole ? 0.75 : 0) +
        lane.smallCount * 0.22;
      if (roughness <= 0.35) {
        continue;
      }

      const gapScore = lane.score + roughness * 0.35;
      if (gapScore < bestScore) {
        bestCandidate = lane;
        bestScore = gapScore;
      }
    }

    if (!bestCandidate) {
      return null;
    }

    const pressureDelta = currentLane.score - bestCandidate.score;
    return pressureDelta >= 0.55 || currentLane.smallCount >= 2 ? bestCandidate : null;
  }

  private getSpeedMultiplier(failureSeverity: number, hasLatch: boolean): number {
    const segmentVisibility = this.config.pacing.visibility[this.segment];
    const segmentSpeedBias =
      this.segment === 'chaos' ? 1.04 : this.segment === 'dark' ? 0.94 : 1;
    const driverMultiplier =
      this.scrapeTimer > 0
        ? this.config.driver.scrapeSpeedMultiplier
        : this.shakeOffTimer > 0
          ? this.config.driver.shakeOffSpeedMultiplier
          : this.forceGapTimer > 0
            ? this.config.driver.forceGapSpeedMultiplier
            : 1;
    const boostMultiplier =
      this.manualBoostTimer > 0 ? this.config.ride.boostSpeedMultiplier : 1;
    const brakeMultiplier =
      this.brakeTimer > 0 ? this.config.ride.brakeSpeedMultiplier : 1;
    const latchMultiplier =
      hasLatch ? this.config.ride.latchSpeedMultiplier : 1;
    const failureMultiplier =
      1 - failureSeverity * this.config.ride.failureSpeedPenalty;

    return clamp(
      segmentSpeedBias *
        driverMultiplier *
        boostMultiplier *
        brakeMultiplier *
        latchMultiplier *
        failureMultiplier *
        (0.96 + segmentVisibility * 0.04),
      0.44,
      1.4,
    );
  }

  private advanceSegmentIfNeeded(): void {
    const duration = this.config.pacing.durations[this.segment];
    if (this.segmentElapsed < duration) {
      return;
    }

    this.segmentIndex = (this.segmentIndex + 1) % this.config.pacing.sequence.length;
    this.segment = this.config.pacing.sequence[this.segmentIndex] ?? 'rest';
    this.segmentElapsed = 0;
  }

  private startLaneChange(nextLaneIndex: number, duration: number): void {
    const clampedLane = clamp(nextLaneIndex, 0, this.config.world.laneCenters.length - 1);
    if (clampedLane === this.targetLaneIndex) {
      return;
    }

    this.laneFromIndex = this.targetLaneIndex;
    this.laneToIndex = clampedLane;
    this.targetLaneIndex = this.laneToIndex;
    this.laneChangeTimer = duration;
    this.laneChangeDurationCurrent = duration;
  }

  private createPrompt(
    intent: DriverIntentType,
    label: string,
    targetLaneIndex: number | null = null,
  ): DriverPromptState {
    return {
      intent,
      label,
      timer: this.config.driver.promptDuration,
      duration: this.config.driver.promptDuration,
      targetLaneIndex,
    };
  }

  private getLaneThreat(laneIndex: number): LaneThreatState {
    return (
      this.laneThreats.find((entry) => entry.laneIndex === laneIndex) ?? {
        laneIndex,
        score: 0,
        blocker: false,
        blockerType: null,
        blockerDistance: null,
        brokenLane: false,
        pothole: false,
        smallCount: 0,
        bruteCount: 0,
      }
    );
  }

  private getLaneBias(laneIndex: number): number {
    if (this.cutLeftBiasTimer <= 0) {
      return 0;
    }

    return laneIndex === Math.max(0, this.laneIndex - 1)
      ? this.config.driver.cutLeftLaneBonus
      : 0;
  }

  private resolveLaneCenter(laneIndex: number): number {
    return this.config.world.laneCenters[laneIndex] ?? 0;
  }

  private hasBlockingEffect(): boolean {
    return (
      this.manualBoostTimer > 0 ||
      this.brakeTimer > 0 ||
      this.scrapeTimer > 0 ||
      this.shakeOffTimer > 0 ||
      this.forceGapTimer > 0 ||
      this.cautiousHoldTimer > 0 ||
      this.laneChangeTimer > 0
    );
  }

  private createFallbackLaneThreats(): LaneThreatState[] {
    return this.config.world.laneCenters.map((_, laneIndex) => ({
      laneIndex,
      score: 0,
      blocker: false,
      blockerType: null,
      blockerDistance: null,
      brokenLane: false,
      pothole: false,
      smallCount: 0,
      bruteCount: 0,
    }));
  }

  private rollPromptTimer(): number {
    return randomRange(
      this.config.driver.promptIntervalMin,
      this.config.driver.promptIntervalMax,
    );
  }
}
