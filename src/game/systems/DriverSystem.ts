import type {
  DriverIntentType,
  DriverPromptCategory,
  DriverPromptDecision,
  DriverPromptResolution,
  DriverPromptState,
  GameConfig,
  LaneThreatState,
  PickupType,
  RideState,
  RunEventType,
  RunSegment,
} from '../../core/types';
import { approach, clamp, lerp, randomRange } from '../../core/utils';

export class DriverSystem {
  private laneIndex = 1;
  private targetLaneIndex = 1;
  private laneFromIndex = 1;
  private laneToIndex = 1;
  private laneChangeTimer = 0;
  private laneChangeDurationCurrent = 0;
  private laneRescanTimer = 0;
  private laneRequestLockout = 0;
  private nextPromptIn = 0;
  private nextOpportunityIn = 0;
  private promptLockout = 0;
  private manualBrakeStrength = 0;
  private manualBoostStrength = 0;
  private focusBeamHeat = 0;
  private focusBeamStrength = 0;
  private focusBeamOverheated = false;
  private scrapeTimer = 0;
  private shakeOffTimer = 0;
  private forceGapTimer = 0;
  private cautiousHoldTimer = 0;
  private cutLeftBiasTimer = 0;
  private segmentIndex = 0;
  private segment: RunSegment = 'rest';
  private segmentElapsed = 0;
  private activeEvent: RunEventType = 'none';
  private eventTimer = 0;
  private eventDuration = 0;
  private nitroActive = false;
  private prompt: DriverPromptState | null = null;
  private supportCue: DriverPromptState | null = null;
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
    this.laneRequestLockout = 0;
    this.nextPromptIn = this.rollPromptTimer();
    this.nextOpportunityIn = this.rollOpportunityTimer();
    this.promptLockout = 0;
    this.manualBrakeStrength = 0;
    this.manualBoostStrength = 0;
    this.focusBeamHeat = 0;
    this.focusBeamStrength = 0;
    this.focusBeamOverheated = false;
    this.scrapeTimer = 0;
    this.shakeOffTimer = 0;
    this.forceGapTimer = 0;
    this.cautiousHoldTimer = 0;
    this.cutLeftBiasTimer = 0;
    this.segmentIndex = 0;
    this.segment = this.config.pacing.sequence[0] ?? 'rest';
    this.segmentElapsed = 0;
    this.prompt = null;
    this.supportCue = null;
    this.pendingResolution = null;
    this.laneThreats = this.createFallbackLaneThreats();
  }

  update(
    deltaTime: number,
    laneThreats: LaneThreatState[],
    hasLatch: boolean,
    failureSeverity: number,
    activeEvent: RunEventType,
    eventTimer = 0,
    eventDuration = 0,
    nitroActive = false,
    focusBeamHeld = false,
  ): RideState {
    this.laneThreats = laneThreats.length > 0 ? laneThreats : this.createFallbackLaneThreats();
    this.activeEvent = activeEvent;
    this.eventTimer = eventTimer;
    this.eventDuration = eventDuration;
    this.nitroActive = nitroActive;
    this.segmentElapsed += deltaTime;
    this.advanceSegmentIfNeeded();

    this.laneRescanTimer = Math.max(0, this.laneRescanTimer - deltaTime);
    this.laneRequestLockout = Math.max(0, this.laneRequestLockout - deltaTime);
    this.promptLockout = Math.max(0, this.promptLockout - deltaTime);
    this.scrapeTimer = Math.max(0, this.scrapeTimer - deltaTime);
    this.shakeOffTimer = Math.max(0, this.shakeOffTimer - deltaTime);
    this.forceGapTimer = Math.max(0, this.forceGapTimer - deltaTime);
    this.cautiousHoldTimer = Math.max(0, this.cautiousHoldTimer - deltaTime);
    this.cutLeftBiasTimer = Math.max(0, this.cutLeftBiasTimer - deltaTime);
    this.nextOpportunityIn = Math.max(0, this.nextOpportunityIn - deltaTime);
    this.updateDriveState(deltaTime, failureSeverity, hasLatch, nitroActive);
    this.updateFocusBeamState(deltaTime, focusBeamHeld);

    if (this.supportCue) {
      this.supportCue.timer = Math.max(0, this.supportCue.timer - deltaTime);
      if (this.supportCue.timer <= 0) {
        this.supportCue = null;
      }
    }

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
    } else if (this.promptLockout <= 0 && !this.hasBlockingEffect()) {
      if (hasLatch) {
        this.prompt = this.createPrompt(
          'shakeItOff',
          "I'll shake it off!",
          'emergency',
          'approve',
          'latch',
          'runner latched on the sidecar',
        );
      } else {
        this.nextPromptIn -= deltaTime;
        if (this.nextOpportunityIn <= 0 && this.tryCreatePickupPrompt(failureSeverity, hasLatch)) {
          // Opportunity prompt created.
        } else if (this.nextPromptIn <= 0) {
          this.tryCreateEmergencyPrompt(failureSeverity, hasLatch);
        }
      }
    }

    if (!this.prompt && this.laneRescanTimer <= 0) {
      this.laneRescanTimer = this.config.driver.laneRescanInterval;
      this.updateLaneChoice(failureSeverity, hasLatch);
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
    const speedMultiplier = this.getSpeedMultiplier(failureSeverity, hasLatch, nitroActive);
    const handlingPenalty = clamp(
      failureSeverity * this.config.ride.failureHandlingPenalty +
        this.manualBrakeStrength * 0.05 +
        (this.scrapeTimer > 0 ? this.config.driver.scrapeHandlingPenalty : 0) +
        (this.shakeOffTimer > 0 ? this.config.driver.shakeOffHandlingPenalty : 0) +
        (this.forceGapTimer > 0 ? this.config.driver.forceGapHandlingPenalty : 0) +
        (this.activeEvent === 'slipperyRoad'
          ? this.config.pacing.events.slipperyHandlingPenalty
          : 0),
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
      manualBrakeEngaged: this.manualBrakeStrength > 0.04,
      manualBrakeMeterRatio: this.manualBrakeStrength,
      manualBoostEngaged: this.manualBoostStrength > 0.04,
      manualBoostMeterRatio: this.manualBoostStrength,
      manualBrakeCooldown: 0,
      manualBoostCooldown: 0,
      driveBrakeStrength: this.manualBrakeStrength,
      driveBoostStrength: this.manualBoostStrength,
      focusBeamActive: this.focusBeamStrength > 0.04,
      focusBeamStrength: this.focusBeamStrength,
      focusBeamHeatRatio: this.focusBeamHeat,
      focusBeamOverheated: this.focusBeamOverheated,
      prompt: this.prompt,
      supportCue: this.supportCue,
      segment: this.segment,
      segmentElapsed: this.segmentElapsed,
      segmentDuration: this.config.pacing.durations[this.segment],
      activeEvent: this.activeEvent,
      eventTimer: this.eventTimer,
      eventDuration: this.eventDuration,
      scrapeMode: this.scrapeTimer > 0,
      shakeOffMode: this.shakeOffTimer > 0,
      forceGapMode: this.forceGapTimer > 0,
      laneCutJolt: this.laneChangeTimer > 0 ? Math.sin(laneAlpha * Math.PI) : 0,
      potholeJolt: 0,
      barrelJolt: 0,
      failureSeverity,
      radarStrength: this.config.renderer.atmosphere[this.segment].radarStrength,
      laneThreats: this.laneThreats,
    };
  }

  requestLaneChange(
    direction: -1 | 1,
    laneThreats: LaneThreatState[],
    failureSeverity: number,
    hasLatch: boolean,
  ): void {
    if (this.prompt || this.laneRequestLockout > 0 || this.hasBlockingEffect()) {
      return;
    }

    this.laneThreats = laneThreats.length > 0 ? laneThreats : this.createFallbackLaneThreats();
    const requestedLaneIndex = clamp(
      this.targetLaneIndex + direction,
      0,
      this.config.world.laneCenters.length - 1,
    );

    if (requestedLaneIndex === this.targetLaneIndex) {
      this.setSupportCue(
        'laneRequestDenied',
        direction < 0 ? "No lane left. We're pinned there." : "No lane right. Hold steady.",
        'requested edge lane',
      );
      this.laneRequestLockout = this.config.driver.laneRequestCooldown;
      return;
    }

    const requestedLane = this.getLaneThreat(requestedLaneIndex);
    const oppositeLaneIndex = clamp(
      this.targetLaneIndex - direction,
      0,
      this.config.world.laneCenters.length - 1,
    );
    const oppositeLane =
      oppositeLaneIndex !== this.targetLaneIndex
        ? this.getLaneThreat(oppositeLaneIndex)
        : null;
    const requestedSafe =
      !requestedLane.brokenLane &&
      !this.isHardVeto(requestedLane, failureSeverity, false, hasLatch);
    const oppositeSafe =
      oppositeLane !== null &&
      !oppositeLane.brokenLane &&
      !this.isHardVeto(oppositeLane, failureSeverity, false, hasLatch);
    const shouldMisread =
      requestedSafe &&
      oppositeSafe &&
      Math.random() < this.config.driver.laneRequestMisreadChance;

    if (shouldMisread && oppositeLane) {
      this.startLaneChange(oppositeLaneIndex, this.config.driver.laneChangeCommitDuration);
      this.setSupportCue(
        'laneRequestWrong',
        direction < 0 ? "Left? Sure. I'm going right." : "Right? Copy that. Cutting left.",
        'driver misread lane request',
      );
      this.laneRequestLockout = this.config.driver.laneRequestCooldown;
      return;
    }

    if (requestedSafe) {
      this.startLaneChange(requestedLaneIndex, this.config.driver.laneChangeCommitDuration);
      this.setSupportCue(
        'laneRequest',
        direction < 0 ? 'Left it is. Moving now.' : 'Right side. On it.',
        'driver accepted lane request',
      );
      this.laneRequestLockout = this.config.driver.laneRequestCooldown;
      return;
    }

    if (oppositeSafe) {
      this.startLaneChange(oppositeLaneIndex, this.config.driver.laneChangeCommitDuration);
      this.setSupportCue(
        'laneRequestWrong',
        direction < 0 ? "Left's filthy. Taking right instead." : "Right's dirty. Taking left.",
        'driver redirected lane request',
      );
      this.laneRequestLockout = this.config.driver.laneRequestCooldown;
      return;
    }

    this.setSupportCue(
      'laneRequestDenied',
      'No clean lane. Keep shooting.',
      'no safe lane change available',
    );
    this.laneRequestLockout = this.config.driver.laneRequestCooldown;
  }

  resolvePrompt(decision: DriverPromptDecision): void {
    if (!this.prompt) {
      return;
    }

    const currentPrompt = this.prompt;
    const effectiveDecision =
      decision === 'timeout'
        ? currentPrompt.fallbackDecision
        : decision === 'approve'
          ? 'approve'
          : 'cancel';
    this.prompt = null;
    this.pendingResolution = {
      intent: currentPrompt.intent,
      decision,
      effectiveDecision,
      targetLaneIndex: currentPrompt.targetLaneIndex,
      category: currentPrompt.category,
      source: currentPrompt.source,
      reason: currentPrompt.reason,
    };
    this.nextPromptIn = this.rollPromptTimer();
    this.nextOpportunityIn = this.rollOpportunityTimer();
    this.promptLockout =
      currentPrompt.category === 'opportunity' ? 1.2 : this.config.driver.promptEffectLockout;

    if (currentPrompt.intent === 'cutLeft') {
      if (effectiveDecision === 'approve' && currentPrompt.targetLaneIndex !== null) {
        this.startLaneChange(
          currentPrompt.targetLaneIndex,
          this.config.driver.laneChangeCommitDuration,
        );
        this.cutLeftBiasTimer = this.config.driver.cutLeftBiasDuration;
        this.cautiousHoldTimer = 0;
      } else {
        this.cautiousHoldTimer = this.config.driver.cautiousHoldDuration;
      }
      return;
    }

    if (currentPrompt.intent === 'scrapeWreck') {
      if (effectiveDecision === 'approve') {
        this.scrapeTimer = this.config.driver.scrapeDuration;
        this.manualBoostStrength = 0;
        this.manualBrakeStrength = 0;
        this.cautiousHoldTimer = 0;
      } else {
        this.cautiousHoldTimer = this.config.driver.cautiousHoldDuration;
      }
      return;
    }

    if (currentPrompt.intent === 'shakeItOff') {
      if (effectiveDecision === 'approve') {
        this.shakeOffTimer = this.config.driver.shakeOffDuration;
        this.manualBoostStrength = 0;
        this.manualBrakeStrength = 0;
        this.cautiousHoldTimer = 0;
      } else {
        this.cautiousHoldTimer = this.config.driver.cautiousHoldDuration * 0.6;
      }
      return;
    }

    if (currentPrompt.intent === 'forceGap') {
      if (effectiveDecision === 'approve') {
        this.forceGapTimer = this.config.driver.forceGapDuration;
        this.cautiousHoldTimer = 0;
        if (currentPrompt.targetLaneIndex !== null) {
          this.startLaneChange(
            currentPrompt.targetLaneIndex,
            this.config.driver.laneChangeCommitDuration,
          );
        }
      } else {
        this.cautiousHoldTimer = this.config.driver.cautiousHoldDuration;
      }
      return;
    }

    if (effectiveDecision === 'approve' && currentPrompt.targetLaneIndex !== null) {
      this.startLaneChange(currentPrompt.targetLaneIndex, this.config.driver.laneChangeDuration);
      this.cautiousHoldTimer = 0.35;
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

  private tryCreateEmergencyPrompt(failureSeverity: number, hasLatch: boolean): void {
    const cutLeftCandidate = this.getCutLeftCandidate(failureSeverity, hasLatch);
    if (cutLeftCandidate) {
      this.prompt = this.createPrompt(
        'cutLeft',
        "Hang on, I'm cutting left!",
        'emergency',
        'approve',
        'hazard',
        'left lane looks cleaner',
        cutLeftCandidate.laneIndex,
      );
      return;
    }

    const scrapeCandidate = this.getScrapeCandidate();
    if (scrapeCandidate) {
      this.prompt = this.createPrompt(
        'scrapeWreck',
        "Duck, I'm scraping the wreck!",
        'emergency',
        'approve',
        'hazard',
        'wreck is pinching the lane',
        scrapeCandidate.laneIndex,
      );
      return;
    }

    const forceGapCandidate = this.getForceGapCandidate(failureSeverity);
    if (forceGapCandidate) {
      this.prompt = this.createPrompt(
        'forceGap',
        "There's a gap, I'm forcing through!",
        'emergency',
        'approve',
        'hazard',
        'pressure is stacking up ahead',
        forceGapCandidate.laneIndex,
      );
      return;
    }

    this.nextPromptIn = this.rollPromptTimer();
  }

  private tryCreatePickupPrompt(failureSeverity: number, hasLatch: boolean): boolean {
    const currentLane = this.getLaneThreat(this.targetLaneIndex);
    let bestCandidate: LaneThreatState | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const lane of this.laneThreats) {
      if (
        lane.laneIndex === this.targetLaneIndex ||
        !lane.pickupKind ||
        lane.pickupValue < this.config.driver.pickupPromptValueThreshold ||
        lane.pickupDistance === null
      ) {
        continue;
      }

      if (this.canAutoPickupLane(lane, currentLane, failureSeverity, hasLatch)) {
        continue;
      }

      if (this.isHardVeto(lane, failureSeverity, true, hasLatch)) {
        continue;
      }

      const pickupCost =
        Math.max(0, lane.score - currentLane.score) +
        lane.pickupRisk +
        (lane.brokenLane ? 0.7 : 0) +
        (this.activeEvent === 'slipperyRoad' ? 0.3 : 0);
      if (pickupCost > this.config.driver.pickupPromptMaxCost) {
        continue;
      }

      const valueScore = lane.pickupValue - pickupCost * 0.55;
      if (valueScore > bestScore) {
        bestCandidate = lane;
        bestScore = valueScore;
      }
    }

    if (!bestCandidate) {
      this.nextOpportunityIn = this.rollOpportunityTimer();
      return false;
    }

    this.prompt = this.createPrompt(
      'pickupOpportunity',
      this.getPickupPromptLabel(bestCandidate.pickupKind),
      'opportunity',
      'cancel',
      'pickup',
      `opportunity for ${bestCandidate.pickupKind}`,
      bestCandidate.laneIndex,
    );
    return true;
  }

  private updateLaneChoice(failureSeverity: number, hasLatch: boolean): void {
    if (this.cautiousHoldTimer > 0 || this.forceGapTimer > 0 || this.shakeOffTimer > 0) {
      return;
    }

    const currentLane = this.getLaneThreat(this.targetLaneIndex);
    let bestLane = currentLane;
    let bestScore = this.getLaneDriveScore(currentLane, currentLane, failureSeverity, hasLatch);

    for (const lane of this.laneThreats) {
      const driveScore = this.getLaneDriveScore(lane, currentLane, failureSeverity, hasLatch);
      if (driveScore < bestScore) {
        bestLane = lane;
        bestScore = driveScore;
      }
    }

    if (!bestLane || bestLane.laneIndex === this.targetLaneIndex) {
      return;
    }

    if (this.isHardVeto(bestLane, failureSeverity, false, hasLatch)) {
      return;
    }

    const currentScore = this.getLaneDriveScore(currentLane, currentLane, failureSeverity, hasLatch);
    const currentHasHardThreat =
      currentLane.blocker ||
      currentLane.bruteCount > 0 ||
      currentLane.smallCount >= 3 ||
      currentLane.brokenLane;
    const shouldChange =
      currentHasHardThreat ||
      bestScore + this.config.driver.scoreMarginToChange < currentScore ||
      this.canAutoPickupLane(bestLane, currentLane, failureSeverity, hasLatch);

    if (!shouldChange) {
      return;
    }

    this.startLaneChange(bestLane.laneIndex, this.config.driver.laneChangeDuration);
  }

  private getCutLeftCandidate(
    failureSeverity: number,
    hasLatch: boolean,
  ): LaneThreatState | null {
    if (this.targetLaneIndex <= 0) {
      return null;
    }

    const leftLane = this.getLaneThreat(this.targetLaneIndex - 1);
    const currentLane = this.getLaneThreat(this.targetLaneIndex);
    if (this.isHardVeto(leftLane, failureSeverity, false, hasLatch)) {
      return null;
    }

    const leftScore =
      this.getLaneDriveScore(leftLane, currentLane, failureSeverity, hasLatch) -
      this.config.driver.cutLeftLaneBonus;
    const currentScore = this.getLaneDriveScore(currentLane, currentLane, failureSeverity, hasLatch);
    if (leftScore + this.config.driver.scoreMarginToChange >= currentScore) {
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
      if (lane.laneIndex === this.targetLaneIndex || this.isHardVeto(lane, failureSeverity, false, false)) {
        continue;
      }

      const roughness =
        (lane.brokenLane ? 1.15 : 0) +
        (this.activeEvent === 'slipperyRoad' ? 0.5 : 0) +
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

  private getLaneDriveScore(
    lane: LaneThreatState,
    currentLane: LaneThreatState,
    failureSeverity: number,
    hasLatch: boolean,
  ): number {
    if (this.isHardVeto(lane, failureSeverity, false, hasLatch)) {
      return Number.POSITIVE_INFINITY;
    }

    const hazardCost =
      (lane.brokenLane ? 0.85 : 0) +
      (this.activeEvent === 'slipperyRoad' ? 0.28 : 0) +
      lane.smallCount * 0.08 +
      lane.bruteCount * 1.2;
    const pickupBonus = this.canAutoPickupLane(lane, currentLane, failureSeverity, hasLatch)
      ? lane.pickupValue * 0.85
      : 0;
    return lane.score + hazardCost - pickupBonus - this.getLaneBias(lane.laneIndex);
  }

  private canAutoPickupLane(
    lane: LaneThreatState,
    currentLane: LaneThreatState,
    failureSeverity: number,
    hasLatch: boolean,
  ): boolean {
    if (
      !lane.pickupKind ||
      lane.pickupDistance === null ||
      lane.pickupValue < this.config.driver.pickupAutoValueThreshold
    ) {
      return false;
    }

    if (this.isHardVeto(lane, failureSeverity, true, hasLatch)) {
      return false;
    }

    const pickupCost =
      Math.max(0, lane.score - currentLane.score) +
      lane.pickupRisk +
      (lane.brokenLane ? 0.55 : 0) +
      (this.activeEvent === 'slipperyRoad' ? 0.2 : 0);
    return pickupCost <= this.config.driver.pickupAutoMaxCost;
  }

  private isHardVeto(
    lane: LaneThreatState,
    failureSeverity: number,
    chasingPickup: boolean,
    hasLatch: boolean,
  ): boolean {
    const blockerDistance = lane.blockerDistance ?? Number.POSITIVE_INFINITY;
    if (lane.blocker && blockerDistance < this.config.driver.blockerVetoDistance) {
      return true;
    }

    if (lane.bruteCount > 0) {
      return true;
    }

    if (!chasingPickup) {
      return false;
    }

    if (hasLatch || failureSeverity >= this.config.driver.criticalFailureVetoSeverity) {
      return true;
    }

    return lane.brokenLane;
  }

  private getPickupPromptLabel(kind: PickupType | null): string {
    if (kind === 'shotgun') {
      return 'Shotgun on the left, quick grab?';
    }

    if (kind === 'bazooka') {
      return "Rocket tube there, I'm diving for it!";
    }

    if (kind === 'medkit') {
      return 'Medkit there, want me to cut for it?';
    }

    if (kind === 'adrenaline') {
      return 'Adrenaline shot ahead, take the edge off?';
    }

    if (kind === 'nitroCan') {
      return "Nitro can up there. I'm making for it!";
    }

    return 'Ammo crate there, want it?';
  }

  private getSpeedMultiplier(
    failureSeverity: number,
    hasLatch: boolean,
    nitroActive: boolean,
  ): number {
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
    const pulseEffectiveness =
      this.activeEvent === 'slipperyRoad'
        ? this.config.pacing.events.slipperyPulseEffectiveness
        : 1;
    const boostMultiplier = lerp(
      1,
      this.config.ride.boostSpeedMultiplier *
        (nitroActive ? this.config.ride.nitroBoostMultiplier : 1),
      this.manualBoostStrength * pulseEffectiveness,
    );
    const brakeMultiplier = lerp(
      1,
      this.config.ride.brakeSpeedMultiplier,
      this.manualBrakeStrength * pulseEffectiveness,
    );
    const latchMultiplier =
      hasLatch ? this.config.ride.latchSpeedMultiplier : 1;
    const eventMultiplier = this.activeEvent === 'slipperyRoad' ? 0.96 : 1;
    const nitroBonus = nitroActive ? 1 + this.config.ride.nitroSpeedBonus : 1;
    const failureMultiplier =
      1 - failureSeverity * this.config.ride.failureSpeedPenalty;

    return clamp(
      segmentSpeedBias *
        driverMultiplier *
        lerp(1, boostMultiplier, pulseEffectiveness) *
        lerp(1, brakeMultiplier, pulseEffectiveness) *
        latchMultiplier *
        eventMultiplier *
        nitroBonus *
        failureMultiplier *
        (0.96 + segmentVisibility * 0.04),
      0.44,
      nitroActive ? 1.5 : 1.4,
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
    const slipperyMultiplier =
      this.activeEvent === 'slipperyRoad'
        ? this.config.pacing.events.slipperyLaneChangeMultiplier
        : 1;
    const nitroMultiplier = this.nitroActive ? this.config.ride.nitroLaneChangeMultiplier : 1;
    this.laneChangeTimer = duration * slipperyMultiplier * nitroMultiplier;
    this.laneChangeDurationCurrent = this.laneChangeTimer;
  }

  private createPrompt(
    intent: DriverIntentType,
    label: string,
    category: DriverPromptCategory,
    fallbackDecision: Extract<DriverPromptDecision, 'approve' | 'cancel'>,
    source: 'hazard' | 'pickup' | 'latch' | 'support',
    reason: string,
    targetLaneIndex: number | null = null,
  ): DriverPromptState {
    const duration =
      category === 'support'
        ? this.config.driver.supportCueDuration
        : this.config.driver.promptDuration;
    return {
      intent,
      category,
      label,
      timer: duration,
      duration,
      targetLaneIndex,
      fallbackDecision,
      source,
      reason,
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
        pickupKind: null,
        pickupDistance: null,
        pickupValue: 0,
        pickupRisk: 0,
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
      this.scrapeTimer > 0 ||
      this.shakeOffTimer > 0 ||
      this.forceGapTimer > 0 ||
      this.cautiousHoldTimer > 0 ||
      this.laneChangeTimer > 0
    );
  }

  private updateDriveState(
    deltaTime: number,
    failureSeverity: number,
    hasLatch: boolean,
    nitroActive: boolean,
  ): void {
    const currentLane = this.getLaneThreat(this.targetLaneIndex);
    const blockerDistance = currentLane.blockerDistance ?? Number.POSITIVE_INFINITY;
    const shouldBrake =
      this.scrapeTimer > 0 ||
      this.shakeOffTimer > 0 ||
      (currentLane.blocker && blockerDistance < 16) ||
      (failureSeverity >= 0.72 && currentLane.smallCount >= 2);
    const shouldBoost =
      !shouldBrake &&
      !hasLatch &&
      (
        this.forceGapTimer > 0 ||
        (nitroActive && !currentLane.blocker) ||
        (this.laneChangeTimer > 0 && blockerDistance > 18) ||
        (this.cutLeftBiasTimer > 0 && currentLane.smallCount === 0 && !currentLane.blocker)
      );
    const response = this.config.ride.inputHoldResponse;

    this.manualBrakeStrength = approach(
      this.manualBrakeStrength,
      shouldBrake ? 1 : 0,
      deltaTime * response * (shouldBrake ? 1 : 1.2),
    );
    this.manualBoostStrength = approach(
      this.manualBoostStrength,
      shouldBoost ? 1 : 0,
      deltaTime * response * (shouldBoost ? 1 : 1.2),
    );
  }

  private setSupportCue(
    intent: DriverIntentType,
    label: string,
    reason: string,
  ): void {
    this.supportCue = this.createPrompt(
      intent,
      label,
      'support',
      'cancel',
      'support',
      reason,
    );
  }

  private updateFocusBeamState(deltaTime: number, focusBeamHeld: boolean): void {
    if (focusBeamHeld && !this.focusBeamOverheated) {
      this.focusBeamHeat = Math.min(
        1,
        this.focusBeamHeat + deltaTime * this.config.ride.focusBeamHeatRate,
      );
      this.focusBeamStrength = approach(
        this.focusBeamStrength,
        1,
        deltaTime * this.config.ride.inputHoldResponse,
      );

      if (this.focusBeamHeat >= 0.999) {
        this.focusBeamHeat = 1;
        this.focusBeamStrength = 0;
        this.focusBeamOverheated = true;
      }
      return;
    }

    if (focusBeamHeld && this.focusBeamOverheated) {
      this.focusBeamStrength = 0;
      return;
    }

    this.focusBeamStrength = approach(
      this.focusBeamStrength,
      0,
      deltaTime * this.config.ride.inputHoldResponse * 1.25,
    );
    this.focusBeamHeat = Math.max(
      0,
      this.focusBeamHeat - deltaTime * this.config.ride.focusBeamCoolRate,
    );

    if (
      this.focusBeamOverheated &&
      this.focusBeamHeat <= this.config.ride.focusBeamRecoveryThreshold
    ) {
      this.focusBeamOverheated = false;
    }
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
      pickupKind: null,
      pickupDistance: null,
      pickupValue: 0,
      pickupRisk: 0,
    }));
  }

  private rollPromptTimer(): number {
    return randomRange(
      this.config.driver.promptIntervalMin,
      this.config.driver.promptIntervalMax,
    );
  }

  private rollOpportunityTimer(): number {
    return randomRange(
      this.config.driver.opportunityPromptCooldown,
      this.config.driver.opportunityPromptCooldown + 4,
    );
  }
}
