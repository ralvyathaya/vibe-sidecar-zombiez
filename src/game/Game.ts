import { Vector3 } from 'three';
import { GAME_CONFIG } from '../core/config';
import { GameLoop } from '../core/GameLoop';
import { RendererSystem } from '../core/Renderer';
import type {
  ActiveZombie,
  DriverPromptResolution,
  GameStateType,
  LaneThreatState,
  RideState,
  WorldImpactResult,
} from '../core/types';
import { approach, clamp } from '../core/utils';
import { UISystem } from '../ui/UISystem';
import { LoopingSound } from './audio/LoopingSound';
import { SoundEffectPool } from './audio/SoundEffectPool';
import { DriverSystem } from './systems/DriverSystem';
import { EnemySystem } from './systems/EnemySystem';
import { InputSystem } from './systems/InputSystem';
import { PlayerSystem } from './systems/PlayerSystem';
import { PickupSystem } from './systems/PickupSystem';
import { RewardSystem } from './systems/RewardSystem';
import { SpawnSystem } from './systems/SpawnSystem';
import { VehicleRigSystem } from './systems/VehicleRigSystem';
import { WeaponSystem } from './systems/WeaponSystem';
import { WorldSystem } from './systems/WorldSystem';

const AUDIO_PREFERENCES_KEY = 'sidecar-of-the-dead.audio-preferences';

type DeathCauseKey =
  | 'overrun'
  | 'tank'
  | 'wreck'
  | 'barrel'
  | 'road'
  | 'unknown';

export class Game {
  private readonly shell = document.createElement('div');
  private readonly rendererSystem: RendererSystem;
  private readonly inputSystem: InputSystem;
  private readonly playerSystem: PlayerSystem;
  private readonly weaponSystem: WeaponSystem;
  private readonly enemySystem: EnemySystem;
  private readonly spawnSystem: SpawnSystem;
  private readonly worldSystem: WorldSystem;
  private readonly pickupSystem: PickupSystem;
  private readonly rewardSystem: RewardSystem;
  private readonly vehicleRigSystem: VehicleRigSystem;
  private readonly driverSystem: DriverSystem;
  private readonly uiSystem: UISystem;
  private readonly gameLoop: GameLoop;
  private readonly engineLoop: LoopingSound;
  private readonly stallLoop: LoopingSound;
  private readonly playerPosition = new Vector3();
  private readonly playerForward = new Vector3();
  private readonly handleOverlayKeyDown = (event: KeyboardEvent) => {
    if (this.state === 'running') {
      return;
    }

    if (event.code !== 'Enter' && event.code !== 'NumpadEnter') {
      return;
    }

    if (event.repeat) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    this.triggerPrimaryAction();
  };

  private state: GameStateType = 'menu';
  private audioPreferences = this.loadAudioPreferences();
  private suppressUnlockPause = false;
  private lastDeathCause: DeathCauseKey = 'unknown';
  private roadHandlingPenalty = 0;
  private roadAimShake = 0;
  private roadCameraShake = 0;
  private roadFreezeTimer = 0;
  private latchEscapeProgress = 0;
  private laneCutJolt = 0;
  private roughRoadJolt = 0;
  private barrelJolt = 0;
  private latchWasActive = false;
  private frameRideState: RideState | null = null;
  private lastRideState: RideState | null = null;
  private stallLoopActive = false;
  private overlayActionLockUntil = 0;

  constructor(root: HTMLElement) {
    this.shell.className = 'game-shell';
    root.append(this.shell);

    this.rendererSystem = new RendererSystem(this.shell, GAME_CONFIG);
    this.inputSystem = new InputSystem(this.rendererSystem.renderer.domElement);
    this.playerSystem = new PlayerSystem(this.rendererSystem.camera, GAME_CONFIG);
    this.rendererSystem.scene.add(this.rendererSystem.camera);

    this.worldSystem = new WorldSystem(this.rendererSystem.scene, GAME_CONFIG);
    this.pickupSystem = new PickupSystem(this.rendererSystem.scene, GAME_CONFIG);
    this.enemySystem = new EnemySystem(this.rendererSystem.scene, GAME_CONFIG);
    this.weaponSystem = new WeaponSystem(this.rendererSystem.camera, GAME_CONFIG);
    this.vehicleRigSystem = new VehicleRigSystem(this.rendererSystem.camera, GAME_CONFIG);
    this.enemySystem.setLatchAnchor(this.vehicleRigSystem.getSidecarLatchAnchor());
    this.playerSystem.setLookRig(
      this.vehicleRigSystem.getCameraYawPivot(),
      this.vehicleRigSystem.getCameraPitchPivot(),
    );
    this.spawnSystem = new SpawnSystem(GAME_CONFIG);
    this.rewardSystem = new RewardSystem(GAME_CONFIG);
    this.driverSystem = new DriverSystem(GAME_CONFIG);
    this.uiSystem = new UISystem(root);
    this.engineLoop = new LoopingSound(GAME_CONFIG.vehicle.engineAudioPath, {
      volume: GAME_CONFIG.vehicle.engineVolume,
      playbackRate: GAME_CONFIG.vehicle.enginePlaybackRate,
      highpassHz: GAME_CONFIG.vehicle.engineHighpassHz,
      lowpassHz: GAME_CONFIG.vehicle.engineLowpassHz,
      turnVolume: GAME_CONFIG.vehicle.turnVolume,
      turnPlaybackRate: GAME_CONFIG.vehicle.turnPlaybackRate,
      turnLowpassHz: GAME_CONFIG.vehicle.turnLowpassHz,
      turnEnterSmoothing: GAME_CONFIG.vehicle.turnEnterSmoothing,
      turnReleaseSmoothing: GAME_CONFIG.vehicle.turnReleaseSmoothing,
      driveAccelVolume: GAME_CONFIG.vehicle.engineVolume * 1.2,
      driveAccelPlaybackRate: GAME_CONFIG.vehicle.enginePlaybackRate * 1.08,
      driveAccelLowpassHz: GAME_CONFIG.vehicle.engineLowpassHz * 1.12,
      driveBrakeVolume: GAME_CONFIG.vehicle.engineVolume * 0.88,
      driveBrakePlaybackRate: GAME_CONFIG.vehicle.enginePlaybackRate * 0.9,
      driveBrakeLowpassHz: GAME_CONFIG.vehicle.engineLowpassHz * 0.72,
      driveEnterSmoothing: 0.08,
      driveReleaseSmoothing: 0.18,
    });
    this.stallLoop = new LoopingSound(GAME_CONFIG.vehicle.stallAudioPath, {
      volume: GAME_CONFIG.vehicle.stallAudioVolume,
      playbackRate: GAME_CONFIG.vehicle.stallAudioPlaybackRate,
      highpassHz: Math.max(48, GAME_CONFIG.vehicle.engineHighpassHz * 0.6),
      lowpassHz: Math.max(900, GAME_CONFIG.vehicle.engineLowpassHz * 0.78),
    });
    this.gameLoop = new GameLoop(
      (deltaTime) => this.update(deltaTime),
      () => this.rendererSystem.render(),
    );

    this.inputSystem.onPointerLockChange = (locked) => {
      if (
        !locked &&
        this.state === 'running' &&
        !this.suppressUnlockPause &&
        this.inputSystem.shouldUsePointerLock()
      ) {
        this.setState('paused');
      }

      if (this.suppressUnlockPause) {
        this.suppressUnlockPause = false;
      }
    };

    this.uiSystem.onPrimaryAction = () => {
      this.triggerPrimaryAction();
    };
    this.uiSystem.onRestartAction = () => {
      this.triggerRestartAction();
    };
    this.uiSystem.onSfxPreferenceChange = (enabled) => {
      this.audioPreferences.sfxEnabled = enabled;
      this.saveAudioPreferences();
      SoundEffectPool.unlockAudio();
      this.applyAudioPreferences();
    };
    this.uiSystem.onMusicPreferenceChange = (enabled) => {
      this.audioPreferences.musicEnabled = enabled;
      this.saveAudioPreferences();
    };
    this.uiSystem.onMobileLaneHoldChange = (direction, active) => {
      this.inputSystem.setVirtualLaneHeld(direction, active);
    };
    this.uiSystem.onMobileReload = () => {
      this.inputSystem.queueVirtualReload();
    };
    this.uiSystem.onMobileFireHeldChange = (active) => {
      this.inputSystem.setVirtualFireHeld(active);
    };
    this.uiSystem.setAudioPreferences(this.audioPreferences);
    this.uiSystem.setTouchControlsEnabled(this.inputSystem.usesTouchControls());
    this.applyAudioPreferences();
    window.addEventListener('keydown', this.handleOverlayKeyDown);

    this.resetGame();
    this.setState('menu');
  }

  start(): void {
    this.gameLoop.start();
  }

  destroy(): void {
    this.gameLoop.stop();
    window.removeEventListener('keydown', this.handleOverlayKeyDown);
    this.uiSystem.destroy();
    this.inputSystem.destroy();
    this.weaponSystem.destroy();
    this.vehicleRigSystem.destroy();
    this.enemySystem.destroy();
    this.worldSystem.destroy();
    this.pickupSystem.destroy();
    this.rewardSystem.destroy();
    this.engineLoop.destroy();
    this.stallLoop.destroy();
    this.rendererSystem.destroy();
  }

  private update(deltaTime: number): void {
    if (this.state === 'running') {
      const simulationDelta = this.consumeSimulationDelta(deltaTime);
      this.handleContextActions();
      this.decayRoadFeedback(deltaTime);
      this.enemySystem.prewarmUpcomingAssets(this.spawnSystem.elapsedSeconds);
      this.worldSystem.prewarmDeferredAssets(this.spawnSystem.elapsedSeconds);
      this.pickupSystem.prewarmUpcomingAssets(this.spawnSystem.elapsedSeconds);

      let loadout = this.weaponSystem.getLoadoutState();
      const pickupHints = this.pickupSystem.getLaneHints(
        loadout,
        this.playerSystem.state,
        this.spawnSystem.elapsedSeconds,
      );
      let combinedLaneThreats = this.combineLaneThreats(
        this.worldSystem.getLaneThreats(),
        this.enemySystem.getLaneThreats(),
        pickupHints,
      );
      const latchActive = this.enemySystem.hasLatchedRunner();
      const laneRequestBlocked = latchActive || this.driverSystem.hasActivePrompt();
      const laneRequestDirection = this.inputSystem.consumeLaneRequest(
        GAME_CONFIG.driver.laneRequestHoldDuration,
        laneRequestBlocked,
      );
      if (laneRequestDirection !== 0) {
        this.driverSystem.requestLaneChange(
          laneRequestDirection,
          combinedLaneThreats,
          this.playerSystem.state.failureSeverity,
          latchActive,
        );
      }
      const laneRequestState = this.inputSystem.getLaneRequestState(
        GAME_CONFIG.driver.laneRequestHoldDuration,
        laneRequestBlocked,
      );
      const baseRide = this.driverSystem.update(
        simulationDelta,
        combinedLaneThreats,
        latchActive,
        this.playerSystem.state.failureSeverity,
        this.spawnSystem.activeEvent,
        this.spawnSystem.getEventTimer(),
        this.spawnSystem.getEventDuration(),
        this.playerSystem.hasNitro(),
      );
      const promptResolution = this.driverSystem.consumePromptResolution();
      if (promptResolution) {
        this.applyDriverResolution(promptResolution);
      }
      const preWorldRide = this.composeRideState(
        baseRide,
        combinedLaneThreats,
        laneRequestState,
      );
      this.frameRideState = preWorldRide;

      this.playerSystem.updateRunning(simulationDelta, this.inputSystem, preWorldRide);
      this.spawnSystem.update(
        simulationDelta,
        this.enemySystem,
        preWorldRide.segment,
        this.worldSystem,
      );
      this.playerSystem.state.score += this.rewardSystem.update(
        simulationDelta,
        this.spawnSystem.elapsedSeconds,
      );
      const playerPosition = this.playerSystem.getPosition(this.playerPosition);

      this.enemySystem.update(
        simulationDelta,
        playerPosition,
        preWorldRide.forwardSpeed,
        this.spawnSystem.activeEvent,
        (zombie) => this.handleEnemyContact(zombie),
      );
      this.updateLatchState(simulationDelta);

      this.weaponSystem.updateRunning(
        simulationDelta,
        this.inputSystem,
        this.playerSystem,
        this.enemySystem,
        this.worldSystem,
        this.rewardSystem,
      );

      if (this.latchWasActive && !this.enemySystem.hasLatchedRunner()) {
        this.spawnSystem.notifyLatchResolved();
        this.roadAimShake = Math.min(this.roadAimShake, 0.01);
        this.roadCameraShake = Math.min(this.roadCameraShake, 0.01);
        this.roughRoadJolt = 0;
      }
      if (!this.enemySystem.hasLatchedRunner()) {
        this.driverSystem.clearLatchAssist();
      }
      this.latchWasActive = this.enemySystem.hasLatchedRunner();

      const worldImpact = this.worldSystem.update(
        simulationDelta,
        this.playerSystem.state.strafeX,
        preWorldRide.forwardSpeed,
        preWorldRide.segment,
      );
      this.applyWorldImpact(worldImpact);
      if (worldImpact.damage > 0) {
        this.driverSystem.notifyObstacleCollision(worldImpact.obstacleType);
        this.rewardSystem.breakChainFromDamage();
        this.lastDeathCause = this.resolveWorldDeathCause(worldImpact);
        this.playerSystem.applyDamage(worldImpact.damage);
      }

      loadout = this.weaponSystem.getLoadoutState();
      const pickupEvents = this.pickupSystem.update(
        simulationDelta,
        this.playerSystem.state.strafeX,
        preWorldRide.forwardSpeed,
        this.spawnSystem.elapsedSeconds,
        loadout,
        this.playerSystem.state,
      );
      for (const pickupEvent of pickupEvents) {
        if (
          pickupEvent.type === 'shotgun' ||
          pickupEvent.type === 'shotgunAmmo' ||
          pickupEvent.type === 'bazooka'
        ) {
          this.weaponSystem.applyPickup(pickupEvent, this.playerSystem);
          continue;
        }

        if (pickupEvent.type === 'medkit') {
          this.playerSystem.heal(GAME_CONFIG.pickups.medkitHeal);
          continue;
        }

        if (pickupEvent.type === 'nitroCan') {
          this.playerSystem.grantNitro(GAME_CONFIG.pickups.nitroDuration);
        }
      }

      const finalLoadout = this.weaponSystem.getLoadoutState();
      const finalPickupHints = this.pickupSystem.getLaneHints(
        finalLoadout,
        this.playerSystem.state,
        this.spawnSystem.elapsedSeconds,
      );
      const finalLaneThreats = this.combineLaneThreats(
        worldImpact.laneThreats,
        this.enemySystem.getLaneThreats(),
        finalPickupHints,
      );
      const finalRide = this.composeRideState(
        baseRide,
        finalLaneThreats,
        laneRequestState,
      );
      this.frameRideState = finalRide;
      this.syncStallLoop(finalRide.engineTroubleMode);
      this.lastRideState = finalRide;
      this.rendererSystem.updateAtmosphere(
        simulationDelta,
        'dark',
        finalRide.activeEvent,
      );
      this.rendererSystem.updateSpeedEffect(simulationDelta, finalRide);
      this.vehicleRigSystem.update(
        simulationDelta,
        playerPosition,
        this.playerSystem.getEngineTurnAmount(),
        this.playerSystem.state.hitFlash,
        this.state,
        finalRide,
      );
      this.engineLoop.setDriveState(finalRide.driveBoostStrength, finalRide.driveBrakeStrength);
      this.engineLoop.setTurnAmount(this.playerSystem.getEngineTurnAmount());

      if (!this.playerSystem.state.alive) {
        this.handleDeath();
      }
    } else {
      const idleRide = this.lastRideState ?? this.composeRideState(
        this.driverSystem.update(
          0,
          this.combineLaneThreats(this.worldSystem.getLaneThreats(), this.enemySystem.getLaneThreats()),
          this.enemySystem.hasLatchedRunner(),
          this.playerSystem.state.failureSeverity,
          this.spawnSystem.activeEvent,
          this.spawnSystem.getEventTimer(),
          this.spawnSystem.getEventDuration(),
          this.playerSystem.hasNitro(),
        ),
      );
      this.rendererSystem.updateAtmosphere(deltaTime, 'dark', idleRide.activeEvent);
      this.rendererSystem.updateSpeedEffect(deltaTime, null);
      this.playerSystem.updateIdle(deltaTime);
      this.vehicleRigSystem.update(
        deltaTime,
        this.playerSystem.getPosition(this.playerPosition),
        0,
        this.playerSystem.state.hitFlash,
        this.state,
        idleRide,
      );
      this.engineLoop.setDriveState(0, 0);
      this.engineLoop.setTurnAmount(0);
      this.syncStallLoop(false);
      this.weaponSystem.updateIdle(deltaTime);
      this.frameRideState = idleRide;
      this.lastRideState = idleRide;
    }

    const ride = this.frameRideState ?? this.lastRideState;
    this.uiSystem.update({
      gameState: this.state,
      player: this.playerSystem.state,
      weapon: this.weaponSystem.getStatus(this.playerSystem),
      reward: this.rewardSystem.getState(),
      ride,
      elapsedSeconds: this.spawnSystem.elapsedSeconds,
      radarContacts: ride
        ? this.limitRadarContacts(
            this.enemySystem.getRadarContacts(
              this.playerSystem.getPosition(this.playerPosition),
              this.playerSystem.getFacingDirection(this.playerForward),
            ),
            ride.radarStrength,
          )
        : [],
    });
  }

  private handleContextActions(): void {
    const pressedQ = this.inputSystem.consumeActionQ();
    const pressedE = this.inputSystem.consumeActionE();
    if (this.driverSystem.hasActivePrompt()) {
      if (pressedQ) {
        this.driverSystem.resolvePrompt('cancel');
      }
      if (pressedE) {
        this.driverSystem.resolvePrompt('approve');
      }
      return;
    }
  }

  private handleEnemyContact(zombie: ActiveZombie): void {
    if (zombie.type === 'runner' && this.enemySystem.tryLatchRunner(zombie)) {
      this.latchEscapeProgress = 0;
      return;
    }

    this.rewardSystem.breakChainFromDamage();
    this.lastDeathCause = zombie.type === 'tank' ? 'tank' : 'overrun';
    this.playerSystem.applyDamage(zombie.config.contactDamage, zombie.group.position.x);
    this.enemySystem.despawn(zombie);
  }

  private updateLatchState(deltaTime: number): void {
    if (!this.enemySystem.hasLatchedRunner()) {
      this.latchEscapeProgress = approach(this.latchEscapeProgress, 0, deltaTime * 2.2);
      return;
    }

    const wiggleMultiplier = this.playerSystem.hasAdrenaline()
      ? GAME_CONFIG.ride.adrenalineWiggleMultiplier
      : 1;
    const wiggleGain = this.inputSystem.consumeWigglePulse() * wiggleMultiplier;
    this.latchEscapeProgress = clamp(
      this.latchEscapeProgress + wiggleGain,
      0,
      GAME_CONFIG.ride.latchWiggleRequired,
    );

    if (this.latchEscapeProgress >= GAME_CONFIG.ride.latchWiggleRequired) {
      const kill = this.enemySystem.clearLatchedRunnerByWiggle();
      this.latchEscapeProgress = 0;
      if (kill) {
        this.playerSystem.state.score += kill.baseScore;
      }
      return;
    }

    this.latchEscapeProgress = Math.max(
      0,
      this.latchEscapeProgress - deltaTime * GAME_CONFIG.player.wiggleDecay,
    );
  }

  private decayRoadFeedback(deltaTime: number): void {
    this.roadHandlingPenalty = approach(this.roadHandlingPenalty, 0, deltaTime * 0.9);
    this.roadAimShake = approach(this.roadAimShake, 0, deltaTime * 0.12);
    this.roadCameraShake = approach(this.roadCameraShake, 0, deltaTime * 0.16);
    this.laneCutJolt = approach(this.laneCutJolt, 0, deltaTime * 5.2);
    this.roughRoadJolt = approach(this.roughRoadJolt, 0, deltaTime * 4.1);
    this.barrelJolt = approach(this.barrelJolt, 0, deltaTime * 5.8);
  }

  private applyWorldImpact(impact: WorldImpactResult): void {
    this.roadHandlingPenalty = Math.max(this.roadHandlingPenalty, impact.handlingPenalty);
    this.roadAimShake = Math.max(this.roadAimShake, impact.aimShake);
    this.roadCameraShake = Math.max(this.roadCameraShake, impact.cameraShake);
    this.roadFreezeTimer = Math.max(this.roadFreezeTimer, impact.freezeDuration);

    if (impact.reaction === 'brokenLane') {
      this.roughRoadJolt = Math.max(this.roughRoadJolt, 1);
    }

    if (impact.reaction === 'barrel') {
      this.barrelJolt = Math.max(this.barrelJolt, 1);
    }
  }

  private applyDriverResolution(resolution: DriverPromptResolution): void {
    if (
      resolution.intent === 'floorIt' &&
      resolution.effectiveDecision === 'approve'
    ) {
      this.laneCutJolt = Math.max(this.laneCutJolt, 0.45);
      return;
    }

    if (
      resolution.intent === 'engineTrouble' &&
      resolution.effectiveDecision === 'cancel'
    ) {
      this.roadAimShake = Math.max(this.roadAimShake, 0.018);
      this.roadCameraShake = Math.max(this.roadCameraShake, 0.024);
      return;
    }

    if (
      resolution.intent === 'pickupOpportunity' &&
      resolution.effectiveDecision === 'approve'
    ) {
      this.laneCutJolt = Math.max(this.laneCutJolt, 1);
    }
  }

  private composeRideState(
    baseRide: RideState,
    laneThreats: LaneThreatState[] = baseRide.laneThreats,
    laneRequestState = {
      active: false,
      direction: 0 as -1 | 0 | 1,
      holdRatio: 0,
    },
  ): RideState {
    const latchActive = this.enemySystem.hasLatchedRunner();
    return {
      ...baseRide,
      supportCue: this.driverSystem.getSupportCue() ?? baseRide.supportCue,
      worldX: this.playerSystem.state.strafeX || baseRide.worldX,
      laneRequestActive: laneRequestState.active,
      laneRequestDirection: laneRequestState.direction,
      laneRequestHoldRatio: laneRequestState.holdRatio,
      handlingPenalty: clamp(
        baseRide.handlingPenalty + this.roadHandlingPenalty,
        0,
        0.92,
      ),
      aimShake:
        baseRide.aimShake *
          (this.playerSystem.hasAdrenaline()
            ? GAME_CONFIG.ride.adrenalineAimShakeMultiplier
            : 1) +
        this.roadAimShake +
        (latchActive ? GAME_CONFIG.ride.latchAimShake : 0),
      cameraShake:
        baseRide.cameraShake +
        this.roadCameraShake +
        (latchActive ? GAME_CONFIG.ride.latchCameraShake : 0),
      latchActive,
      latchWiggle: this.latchEscapeProgress,
      latchWiggleRatio: clamp(
        this.latchEscapeProgress / GAME_CONFIG.ride.latchWiggleRequired,
        0,
        1,
      ),
      laneCutJolt: Math.max(baseRide.laneCutJolt, this.laneCutJolt),
      potholeJolt: this.roughRoadJolt,
      barrelJolt: this.barrelJolt,
      radarStrength:
        baseRide.radarStrength *
        (baseRide.activeEvent === 'blackoutStretch'
          ? GAME_CONFIG.pacing.events.blackoutRadarMultiplier
          : 1),
      laneThreats,
    };
  }

  private combineLaneThreats(
    worldThreats: LaneThreatState[],
    enemyThreats: LaneThreatState[],
    pickupThreats: LaneThreatState[] = [],
  ): LaneThreatState[] {
    const laneCount = GAME_CONFIG.world.laneCenters.length;
    const combined: LaneThreatState[] = [];

    for (let laneIndex = 0; laneIndex < laneCount; laneIndex += 1) {
      const worldThreat = worldThreats[laneIndex];
      const enemyThreat = enemyThreats[laneIndex];
      const pickupThreat = pickupThreats[laneIndex];
      combined.push({
        laneIndex,
        score: (worldThreat?.score ?? 0) + (enemyThreat?.score ?? 0),
        blocker: Boolean(worldThreat?.blocker),
        blockerType: worldThreat?.blockerType ?? null,
        blockerDistance: worldThreat?.blockerDistance ?? null,
        brokenLane: Boolean(worldThreat?.brokenLane),
        pothole: false,
        smallCount: (worldThreat?.smallCount ?? 0) + (enemyThreat?.smallCount ?? 0),
        bruteCount: (worldThreat?.bruteCount ?? 0) + (enemyThreat?.bruteCount ?? 0),
        pickupKind: pickupThreat?.pickupKind ?? null,
        pickupDistance: pickupThreat?.pickupDistance ?? null,
        pickupValue: pickupThreat?.pickupValue ?? 0,
        pickupRisk: pickupThreat?.pickupRisk ?? 0,
      });
    }

    return combined;
  }

  private limitRadarContacts<T>(contacts: T[], radarStrength: number): T[] {
    const count = Math.max(4, Math.round(contacts.length * Math.max(0.35, radarStrength)));
    return contacts.slice(0, count);
  }

  private consumeSimulationDelta(deltaTime: number): number {
    if (this.roadFreezeTimer <= 0) {
      return deltaTime;
    }

    this.roadFreezeTimer = Math.max(0, this.roadFreezeTimer - deltaTime);
    return 0;
  }

  private handleDeath(): void {
    if (this.state === 'dead') {
      return;
    }

    this.rewardSystem.finalizeRun(this.playerSystem.state.score);
    this.uiSystem.setDeathCause(this.describeDeathCause(this.lastDeathCause));
    this.setState('dead');
    if (this.inputSystem.isPointerLocked()) {
      this.suppressUnlockPause = true;
      void document.exitPointerLock();
    }
  }

  private triggerPrimaryAction(): void {
    if (!this.beginOverlayAction()) {
      return;
    }

    if (this.state === 'menu' || this.state === 'dead') {
      this.resetGame();
    }

    this.blurOverlayFocus();
    SoundEffectPool.unlockAudio();
    this.inputSystem.clearTransientInput();
    this.setState('running');
    if (this.inputSystem.shouldUsePointerLock()) {
      this.inputSystem.requestPointerLock();
    }
  }

  private triggerRestartAction(): void {
    if (!this.beginOverlayAction()) {
      return;
    }

    this.resetGame();
    this.blurOverlayFocus();
    SoundEffectPool.unlockAudio();
    this.inputSystem.clearTransientInput();
    this.setState('running');
    if (this.inputSystem.shouldUsePointerLock()) {
      this.inputSystem.requestPointerLock();
    }
  }

  private beginOverlayAction(): boolean {
    const now = performance.now();
    if (now < this.overlayActionLockUntil) {
      return false;
    }

    this.overlayActionLockUntil = now + 260;
    return true;
  }

  private blurOverlayFocus(): void {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      activeElement.blur();
    }
  }

  private resetGame(): void {
    this.playerSystem.reset();
    this.driverSystem.reset();
    this.vehicleRigSystem.reset();
    this.rewardSystem.resetRun();
    this.weaponSystem.reset(this.playerSystem);
    this.enemySystem.reset();
    this.spawnSystem.reset();
    this.worldSystem.reset();
    this.pickupSystem.reset();
    this.roadHandlingPenalty = 0;
    this.roadAimShake = 0;
    this.roadCameraShake = 0;
    this.roadFreezeTimer = 0;
    this.latchEscapeProgress = 0;
    this.laneCutJolt = 0;
    this.roughRoadJolt = 0;
    this.barrelJolt = 0;
    this.latchWasActive = false;
    this.frameRideState = null;
    this.lastRideState = null;
    this.lastDeathCause = 'unknown';
    this.syncStallLoop(false);
  }

  private setState(nextState: GameStateType): void {
    this.state = nextState;
    this.uiSystem.setState(nextState);
    if (nextState === 'running') {
      this.engineLoop.play(
        GAME_CONFIG.vehicle.engineVolume,
        GAME_CONFIG.vehicle.enginePlaybackRate,
      );
    } else {
      this.inputSystem.releaseVirtualControls();
      this.engineLoop.setDriveState(0, 0);
      this.engineLoop.setTurnAmount(0);
      this.engineLoop.pause();
      this.syncStallLoop(false);
    }
  }

  private applyAudioPreferences(): void {
    SoundEffectPool.setEffectsEnabled(this.audioPreferences.sfxEnabled);
    this.engineLoop.setEnabled(this.audioPreferences.sfxEnabled);
    this.stallLoop.setEnabled(this.audioPreferences.sfxEnabled);
    this.uiSystem.setAudioPreferences(this.audioPreferences);
  }

  private loadAudioPreferences(): { sfxEnabled: boolean; musicEnabled: boolean } {
    try {
      const stored = window.localStorage.getItem(AUDIO_PREFERENCES_KEY);
      if (!stored) {
        return {
          sfxEnabled: true,
          musicEnabled: true,
        };
      }

      const parsed = JSON.parse(stored) as Partial<{
        sfxEnabled: boolean;
        musicEnabled: boolean;
      }>;
      return {
        sfxEnabled: parsed.sfxEnabled ?? true,
        musicEnabled: parsed.musicEnabled ?? true,
      };
    } catch {
      return {
        sfxEnabled: true,
        musicEnabled: true,
      };
    }
  }

  private saveAudioPreferences(): void {
    try {
      window.localStorage.setItem(
        AUDIO_PREFERENCES_KEY,
        JSON.stringify(this.audioPreferences),
      );
    } catch {
      // Ignore storage failures and keep runtime defaults.
    }
  }

  private resolveWorldDeathCause(impact: WorldImpactResult): DeathCauseKey {
    if (impact.obstacleType === 'barrel' || impact.reaction === 'barrel') {
      return 'barrel';
    }
    if (impact.obstacleType === 'brokenLane' || impact.reaction === 'brokenLane') {
      return 'road';
    }
    if (
      impact.obstacleType === 'car' ||
      impact.obstacleType === 'wreck' ||
      impact.obstacleType === 'barricade' ||
      impact.obstacleType === 'concreteBlock'
    ) {
      return 'wreck';
    }
    return 'unknown';
  }

  private describeDeathCause(cause: DeathCauseKey): { title: string; body: string } {
    switch (cause) {
      case 'tank':
        return {
          title: 'TANK COLLISION',
          body: 'The brute reached the bike first. Heavy meat won that argument.',
        };
      case 'barrel':
        return {
          title: 'BAD BARREL CALL',
          body: 'Something explosive joined the conversation and ended it badly.',
        };
      case 'road':
        return {
          title: 'ROAD EATEN',
          body: 'The asphalt opened up and your sidecar lost the vote.',
        };
      case 'wreck':
        return {
          title: 'WRECKED OUT',
          body: 'Hard steel beat reckless optimism. The bike did not recover.',
        };
      case 'overrun':
        return {
          title: 'OVERRUN',
          body: 'Too many dead reached the rig at once. They climbed faster than you cleared.',
        };
      case 'unknown':
      default:
        return {
          title: 'TOTAL SYSTEM FAILURE',
          body: 'The run fell apart all at once. The road keeps the exact paperwork.',
        };
    }
  }

  private syncStallLoop(active: boolean): void {
    if (this.stallLoopActive === active) {
      return;
    }

    this.stallLoopActive = active;
    if (active) {
      this.stallLoop.play(
        GAME_CONFIG.vehicle.stallAudioVolume,
        GAME_CONFIG.vehicle.stallAudioPlaybackRate,
      );
      return;
    }

    this.stallLoop.pause();
  }
}
