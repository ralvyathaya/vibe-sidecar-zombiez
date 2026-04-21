import type {
  DriverIntentType,
  DriverPromptCategory,
  DriverPromptDecision,
  DriverPromptResolution,
  DriverPromptState,
  GameConfig,
  LaneThreatState,
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
  private floorItTimer = 0;
  private brakeTimer = 0;
  private engineTroubleTimer = 0;
  private engineTroubleRoughness = 0;
  private cautiousHoldTimer = 0;
  private segmentIndex = 0;
  private segment: RunSegment = 'rest';
  private segmentElapsed = 0;
  private activeEvent: RunEventType = 'none';
  private eventTimer = 0;
  private eventDuration = 0;
  private nitroActive = false;
  private supportCue: DriverPromptState | null = null;
  private laneThreats: LaneThreatState[] = [];
  private time = 0;

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
    this.nextPromptIn = 10;
    this.nextOpportunityIn = this.rollOpportunityTimer();
    this.promptLockout = 0;
    this.manualBrakeStrength = 0;
    this.manualBoostStrength = 0;
    this.focusBeamHeat = 0;
    this.focusBeamStrength = 0;
    this.focusBeamOverheated = false;
    this.floorItTimer = 0;
    this.brakeTimer = 0;
    this.engineTroubleTimer = 0;
    this.engineTroubleRoughness = 0;
    this.cautiousHoldTimer = 0;
    this.segmentIndex = 0;
    this.segment = this.config.pacing.sequence[0] ?? 'rest';
    this.segmentElapsed = 0;
    this.activeEvent = 'none';
    this.eventTimer = 0;
    this.eventDuration = 0;
    this.nitroActive = false;
    this.supportCue = null;
    this.laneThreats = this.createFallbackLaneThreats();
    this.time = 0;
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
    this.time += deltaTime;
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
    this.floorItTimer = Math.max(0, this.floorItTimer - deltaTime);
    this.brakeTimer = Math.max(0, this.brakeTimer - deltaTime);
    this.engineTroubleTimer = Math.max(0, this.engineTroubleTimer - deltaTime);
    this.cautiousHoldTimer = Math.max(0, this.cautiousHoldTimer - deltaTime);
    this.nextOpportunityIn = Math.max(0, this.nextOpportunityIn - deltaTime);

    if (this.engineTroubleTimer <= 0) {
      this.engineTroubleRoughness = 0;
    }

    this.updateDriveState(deltaTime);
    this.updateFocusBeamState(deltaTime, focusBeamHeld);

    if (this.supportCue) {
      this.supportCue.timer = Math.max(0, this.supportCue.timer - deltaTime);
      if (this.supportCue.timer <= 0) {
        this.supportCue = null;
      }
    }

    if (this.promptLockout <= 0 && !this.hasBlockingEffect() && !hasLatch) {
      this.nextPromptIn -= deltaTime;
      if (this.nextPromptIn <= 0) {
        this.tryCreateDriverPrompt(failureSeverity, hasLatch);
      }
    }

    if (this.laneRescanTimer <= 0) {
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
    const slipperyTurnJitter =
      this.activeEvent === 'slipperyRoad' && this.laneChangeTimer > 0 ? 0.012 : 0;
    const baseHandlingPenalty =
      failureSeverity * this.config.ride.failureHandlingPenalty +
      (this.floorItTimer > 0 ? 0.045 : 0) +
      (this.engineTroubleTimer > 0 ? 0.18 + this.engineTroubleRoughness * 0.06 : 0) +
      (this.activeEvent === 'slipperyRoad'
        ? this.config.pacing.events.slipperyHandlingPenalty
        : 0) -
      (this.brakeTimer > 0 ? this.config.driver.brakeStabilityBonus : 0);
    const handlingPenalty = clamp(Math.max(0, baseHandlingPenalty), 0, 0.92);
    const floorItAlpha = this.floorItTimer > 0 ? clamp(this.manualBoostStrength, 0, 1) : 0;
    const brakeAlpha = this.brakeTimer > 0 ? clamp(this.manualBrakeStrength, 0, 1) : 0;
    const engineTroubleAlpha =
      this.engineTroubleTimer > 0 ? this.getEngineTroublePulse() : 0;
    const aimShake =
      this.config.driver.floorItAimShake * floorItAlpha +
      this.config.driver.brakeAimShake * brakeAlpha +
      this.config.driver.engineTroubleAimShake *
        (this.engineTroubleTimer > 0 ? 0.7 + engineTroubleAlpha * 0.65 : 0) +
      slipperyTurnJitter +
      failureSeverity * this.config.player.failureAimShake;
    const cameraShake =
      this.config.driver.floorItCameraShake * floorItAlpha +
      this.config.driver.brakeCameraShake * brakeAlpha +
      this.config.driver.engineTroubleCameraShake *
        (this.engineTroubleTimer > 0 ? 0.72 + engineTroubleAlpha * 0.6 : 0) +
      slipperyTurnJitter * 1.4 +
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
      prompt: null,
      supportCue: this.supportCue,
      segment: this.segment,
      segmentElapsed: this.segmentElapsed,
      segmentDuration: this.config.pacing.durations[this.segment],
      activeEvent: this.activeEvent,
      eventTimer: this.eventTimer,
      eventDuration: this.eventDuration,
      floorItMode: this.floorItTimer > 0,
      brakeMode: this.brakeTimer > 0,
      engineTroubleMode: this.engineTroubleTimer > 0,
      engineTroubleWobble:
        this.engineTroubleTimer > 0
          ? (0.45 + engineTroubleAlpha * 0.55) * (1 + this.engineTroubleRoughness * 0.2)
          : 0,
      laneCutJolt: 0,
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
    if (this.laneRequestLockout > 0 || this.hasBlockingEffect()) {
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
        direction < 0
          ? 'No miracle lane on the left. We live here.'
          : 'No miracle lane on the right. We live here.',
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
        direction < 0
          ? 'You asked left. Fate heard right.'
          : 'You asked right. Fate heard left.',
        'driver misread lane request',
      );
      this.laneRequestLockout = this.config.driver.laneRequestCooldown;
      return;
    }

    if (requestedSafe) {
      this.startLaneChange(requestedLaneIndex, this.config.driver.laneChangeCommitDuration);
      this.setSupportCue(
        'laneRequest',
        direction < 0 ? 'Left lane. Clean enough. We commit.' : 'Right lane. Clean enough. We commit.',
        'driver accepted lane request',
      );
      this.laneRequestLockout = this.config.driver.laneRequestCooldown;
      return;
    }

    if (oppositeSafe) {
      this.startLaneChange(oppositeLaneIndex, this.config.driver.laneChangeCommitDuration);
      this.setSupportCue(
        'laneRequestWrong',
        direction < 0
          ? "Left lane's cursed. I'm stealing the right."
          : "Right lane's cursed. I'm stealing the left.",
        'driver redirected lane request',
      );
      this.laneRequestLockout = this.config.driver.laneRequestCooldown;
      return;
    }

    this.setSupportCue(
      'laneRequestDenied',
      'No clean lane. Violence will have to solve this.',
      'no safe lane change available',
    );
    this.laneRequestLockout = this.config.driver.laneRequestCooldown;
  }

  resolvePrompt(decision: DriverPromptDecision): void {
    void decision;
  }

  hasActivePrompt(): boolean {
    return false;
  }

  getPrompt(): DriverPromptState | null {
    return null;
  }

  getSegment(): RunSegment {
    return this.segment;
  }

  clearLatchAssist(): void {
    this.promptLockout = Math.max(0, this.promptLockout);
  }

  consumePromptResolution(): DriverPromptResolution | null {
    return null;
  }

  private tryCreateDriverPrompt(failureSeverity: number, hasLatch: boolean): void {
    const brakeCandidate = this.getBrakeCandidate(failureSeverity, hasLatch);
    if (brakeCandidate) {
      this.brakeTimer = this.config.driver.brakeDuration;
      this.floorItTimer = 0;
      this.engineTroubleTimer = 0;
      this.engineTroubleRoughness = 0;
      this.setSupportCue(
        'brake',
        "Hold that thought. I'm shaving speed, not dying.",
        'hazard pressure is tightening up',
      );
      this.promptLockout = this.config.driver.promptEffectLockout;
      this.nextPromptIn = this.rollPromptTimer();
      return;
    }

    const floorItCandidate = this.getFloorItCandidate(failureSeverity, hasLatch);
    if (floorItCandidate) {
      this.floorItTimer = this.config.driver.floorItDuration;
      this.brakeTimer = 0;
      this.engineTroubleTimer = 0;
      this.engineTroubleRoughness = 0;
      this.setSupportCue(
        'floorIt',
        'Terrible idea. Full throttle.',
        'there is a clean sprint window ahead',
      );
      this.promptLockout = this.config.driver.promptEffectLockout;
      this.nextPromptIn = this.rollPromptTimer();
      return;
    }

    const engineTroubleCandidate = this.getEngineTroubleCandidate(failureSeverity, hasLatch);
    if (engineTroubleCandidate) {
      this.floorItTimer = 0;
      this.brakeTimer = 0;
      this.engineTroubleRoughness = 0;
      this.engineTroubleTimer = this.config.driver.engineTroubleDuration;
      this.setSupportCue(
        'engineTrouble',
        'The engine has developed a personality.',
        'the bike is stumbling under stress',
      );
      this.promptLockout = this.config.driver.promptEffectLockout;
      this.nextPromptIn = this.rollPromptTimer();
      return;
    }

    this.nextPromptIn = 2.5;
  }

  private updateLaneChoice(failureSeverity: number, hasLatch: boolean): void {
    if (
      this.cautiousHoldTimer > 0 ||
      this.floorItTimer > 0 ||
      this.brakeTimer > 0 ||
      this.engineTroubleTimer > 0
    ) {
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

    if (bestLane.laneIndex === this.targetLaneIndex) {
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

  private getBrakeCandidate(
    failureSeverity: number,
    hasLatch: boolean,
  ): LaneThreatState | null {
    if (hasLatch || failureSeverity >= 0.92) {
      return null;
    }

    const currentLane = this.getLaneThreat(this.targetLaneIndex);
    const blockerDistance = currentLane.blockerDistance ?? Number.POSITIVE_INFINITY;
    const shouldBrake =
      (currentLane.blocker && blockerDistance <= this.config.driver.brakeHazardDistance) ||
      currentLane.brokenLane ||
      currentLane.smallCount >= 2 ||
      (failureSeverity >= 0.5 && currentLane.score > 1.05) ||
      (this.activeEvent === 'slipperyRoad' && currentLane.smallCount > 0);
    return shouldBrake ? currentLane : null;
  }

  private getFloorItCandidate(
    failureSeverity: number,
    hasLatch: boolean,
  ): LaneThreatState | null {
    if (hasLatch || failureSeverity >= 0.68) {
      return null;
    }

    const currentLane = this.getLaneThreat(this.targetLaneIndex);
    const blockerDistance = currentLane.blockerDistance ?? Number.POSITIVE_INFINITY;
    const safeLane =
      !currentLane.blocker &&
      blockerDistance > 30 &&
      !currentLane.brokenLane &&
      currentLane.bruteCount === 0 &&
      currentLane.smallCount <= 1;
    if (!safeLane) {
      return null;
    }

    const pickupSprint =
      Boolean(currentLane.pickupKind) &&
      currentLane.pickupDistance !== null &&
      currentLane.pickupDistance <= this.config.driver.floorItPickupDistance;
    const laneRelief = this.laneThreats.some(
      (lane) => lane.laneIndex !== currentLane.laneIndex && lane.score > currentLane.score + 1.05,
    );
    const chaosWindow =
      this.segment === 'chaos' && currentLane.score < 0.95 && this.activeEvent !== 'slipperyRoad';
    const cleanStraight = currentLane.score < 0.72;

    return pickupSprint || laneRelief || chaosWindow || cleanStraight ? currentLane : null;
  }

  private getEngineTroubleCandidate(
    failureSeverity: number,
    hasLatch: boolean,
  ): LaneThreatState | null {
    if (hasLatch) {
      return null;
    }

    const currentLane = this.getLaneThreat(this.targetLaneIndex);
    const blockerDistance = currentLane.blockerDistance ?? Number.POSITIVE_INFINITY;
    const stressedEnough =
      failureSeverity >= this.config.driver.engineTroubleFailureThreshold ||
      (this.activeEvent === 'berserkWave' && failureSeverity >= 0.22) ||
      (this.segment === 'chaos' && failureSeverity >= 0.28 && currentLane.score >= 1.1);
    const fairWindow =
      !currentLane.blocker &&
      blockerDistance > 18 &&
      !currentLane.brokenLane &&
      currentLane.bruteCount === 0;

    return stressedEnough && fairWindow ? currentLane : null;
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
      (this.activeEvent === 'slipperyRoad' ? 0.08 : 0) +
      lane.smallCount * 0.08 +
      lane.bruteCount * 1.2;
    const pickupBonus = this.canAutoPickupLane(lane, currentLane, failureSeverity, hasLatch)
      ? lane.pickupValue * 0.85
      : 0;
    return lane.score + hazardCost - pickupBonus;
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
      (this.activeEvent === 'slipperyRoad' ? 0.08 : 0);
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

  private getSpeedMultiplier(
    failureSeverity: number,
    hasLatch: boolean,
    nitroActive: boolean,
  ): number {
    const segmentVisibility = this.config.pacing.visibility[this.segment];
    const segmentSpeedBias =
      this.segment === 'chaos' ? 1.04 : this.segment === 'dark' ? 0.94 : 1;
    const engineTroublePulse = this.engineTroubleTimer > 0 ? this.getEngineTroublePulse() : 0;
    const troubleLow =
      this.config.driver.engineTroubleSpeedMultiplier - this.engineTroubleRoughness * 0.08;
    const troubleHigh = 0.96 - this.engineTroubleRoughness * 0.04;
    const driverMultiplier =
      this.floorItTimer > 0
        ? this.config.driver.floorItSpeedMultiplier
        : this.brakeTimer > 0
          ? this.config.driver.brakeSpeedMultiplier
          : this.engineTroubleTimer > 0
            ? lerp(troubleLow, troubleHigh, engineTroublePulse)
            : 1;
    const latchMultiplier = hasLatch ? this.config.ride.latchSpeedMultiplier : 1;
    const eventMultiplier = this.activeEvent === 'slipperyRoad' ? 0.985 : 1;
    const nitroBonus = nitroActive ? 1 + this.config.ride.nitroSpeedBonus : 1;
    const failureMultiplier = 1 - failureSeverity * this.config.ride.failureSpeedPenalty;

    return clamp(
      segmentSpeedBias *
        driverMultiplier *
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
    const nitroMultiplier = this.nitroActive ? this.config.ride.nitroLaneChangeMultiplier : 1;
    this.laneChangeTimer = duration * nitroMultiplier;
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

  private resolveLaneCenter(laneIndex: number): number {
    return this.config.world.laneCenters[laneIndex] ?? 0;
  }

  private hasBlockingEffect(): boolean {
    return (
      this.floorItTimer > 0 ||
      this.brakeTimer > 0 ||
      this.engineTroubleTimer > 0 ||
      this.cautiousHoldTimer > 0 ||
      this.laneChangeTimer > 0
    );
  }

  private updateDriveState(deltaTime: number): void {
    const response = this.config.ride.inputHoldResponse;

    if (this.engineTroubleTimer > 0) {
      const pulse = this.getEngineTroublePulse();
      const accelPulse = pulse * (0.88 + this.engineTroubleRoughness * 0.12);
      const brakePulse = (1 - pulse) * (0.64 + this.engineTroubleRoughness * 0.18);
      this.manualBoostStrength = approach(
        this.manualBoostStrength,
        accelPulse,
        deltaTime * response,
      );
      this.manualBrakeStrength = approach(
        this.manualBrakeStrength,
        brakePulse,
        deltaTime * response,
      );
      return;
    }

    const targetBrake = this.brakeTimer > 0 ? 0.82 : 0;
    const targetBoost = this.floorItTimer > 0 ? 1 : 0;
    this.manualBrakeStrength = approach(
      this.manualBrakeStrength,
      targetBrake,
      deltaTime * response * (targetBrake > this.manualBrakeStrength ? 1 : 1.2),
    );
    this.manualBoostStrength = approach(
      this.manualBoostStrength,
      targetBoost,
      deltaTime * response * (targetBoost > this.manualBoostStrength ? 1 : 1.2),
    );
  }

  private getEngineTroublePulse(): number {
    const wobble = Math.sin(this.time * this.config.driver.engineTroubleWobbleFrequency);
    return (wobble + 1) * 0.5;
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
