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
  private readonly playerPosition = new Vector3();
  private readonly playerForward = new Vector3();

  private state: GameStateType = 'menu';
  private suppressUnlockPause = false;
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
    });
    this.gameLoop = new GameLoop(
      (deltaTime) => this.update(deltaTime),
      () => this.rendererSystem.render(),
    );

    this.inputSystem.onPointerLockChange = (locked) => {
      if (!locked && this.state === 'running' && !this.suppressUnlockPause) {
        this.setState('paused');
      }

      if (this.suppressUnlockPause) {
        this.suppressUnlockPause = false;
      }
    };

    this.uiSystem.onPrimaryAction = () => {
      if (this.state === 'menu' || this.state === 'dead') {
        this.resetGame();
      }

      SoundEffectPool.unlockAudio();
      this.inputSystem.clearTransientInput();
      this.setState('running');
      this.inputSystem.requestPointerLock();
    };

    this.resetGame();
    this.setState('menu');
  }

  start(): void {
    this.gameLoop.start();
  }

  destroy(): void {
    this.gameLoop.stop();
    this.inputSystem.destroy();
    this.weaponSystem.destroy();
    this.vehicleRigSystem.destroy();
    this.enemySystem.destroy();
    this.worldSystem.destroy();
    this.pickupSystem.destroy();
    this.engineLoop.destroy();
    this.rendererSystem.destroy();
  }

  private update(deltaTime: number): void {
    if (this.state === 'running') {
      const simulationDelta = this.consumeSimulationDelta(deltaTime);
      this.handleContextActions();
      this.decayRoadFeedback(deltaTime);

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
      const baseRide = this.driverSystem.update(
        simulationDelta,
        combinedLaneThreats,
        this.enemySystem.hasLatchedRunner(),
        this.playerSystem.state.failureSeverity,
        this.spawnSystem.activeEvent,
        this.spawnSystem.getEventTimer(),
        this.spawnSystem.getEventDuration(),
        this.playerSystem.hasNitro(),
      );
      const promptResolution = this.driverSystem.consumePromptResolution();
      if (promptResolution) {
        this.applyDriverResolution(promptResolution);
        const refreshedPickupHints = this.pickupSystem.getLaneHints(
          loadout,
          this.playerSystem.state,
          this.spawnSystem.elapsedSeconds,
        );
        combinedLaneThreats = this.combineLaneThreats(
          this.worldSystem.getLaneThreats(),
          this.enemySystem.getLaneThreats(),
          refreshedPickupHints,
        );
      }
      const preWorldRide = this.composeRideState(baseRide, combinedLaneThreats);
      this.frameRideState = preWorldRide;

      this.playerSystem.updateRunning(simulationDelta, this.inputSystem, preWorldRide);
      this.spawnSystem.update(simulationDelta, this.enemySystem, preWorldRide.segment);
      this.playerSystem.state.score += this.rewardSystem.update(
        simulationDelta,
        this.spawnSystem.elapsedSeconds,
      );

      this.enemySystem.update(
        simulationDelta,
        this.playerSystem.getPosition(this.playerPosition),
        preWorldRide.forwardSpeed,
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
        this.rewardSystem.breakChainFromDamage();
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

        if (pickupEvent.type === 'adrenaline') {
          this.playerSystem.grantAdrenaline(GAME_CONFIG.pickups.adrenalineDuration);
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
        this.worldSystem.getLaneThreats(),
        this.enemySystem.getLaneThreats(),
        finalPickupHints,
      );
      const finalRide = this.composeRideState(baseRide, finalLaneThreats);
      this.frameRideState = finalRide;
      this.lastRideState = finalRide;
      this.rendererSystem.updateAtmosphere(
        simulationDelta,
        finalRide.segment,
        finalRide.activeEvent,
      );
      this.vehicleRigSystem.update(
        simulationDelta,
        this.playerSystem.getPosition(this.playerPosition),
        this.playerSystem.getEngineTurnAmount(),
        this.playerSystem.state.hitFlash,
        this.state,
        finalRide,
      );
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
      this.rendererSystem.updateAtmosphere(deltaTime, idleRide.segment, idleRide.activeEvent);
      this.playerSystem.updateIdle(deltaTime);
      this.vehicleRigSystem.update(
        deltaTime,
        this.playerSystem.getPosition(this.playerPosition),
        0,
        this.playerSystem.state.hitFlash,
        this.state,
        idleRide,
      );
      this.engineLoop.setTurnAmount(0);
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
    const pressedW = this.inputSystem.consumeActionW();
    const pressedS = this.inputSystem.consumeActionS();
    const pressedQ = this.inputSystem.consumeActionQ();
    const pressedE = this.inputSystem.consumeActionE();
    if (pressedS) {
      this.driverSystem.triggerBrake();
    }
    if (pressedW) {
      this.driverSystem.triggerBoost();
    }

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
    if (this.frameRideState?.scrapeMode && zombie.config.canBeRammed) {
      const kill = this.enemySystem.damage(zombie, zombie.health, zombie.group.position.clone());
      if (kill) {
        this.playerSystem.state.score += kill.baseScore;
      }
      return;
    }

    if (zombie.type === 'runner' && this.enemySystem.tryLatchRunner(zombie)) {
      this.latchEscapeProgress = 0;
      return;
    }

    this.rewardSystem.breakChainFromDamage();
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
    const wiggleGain =
      this.inputSystem.consumeWigglePulse() * wiggleMultiplier +
      (this.frameRideState?.shakeOffMode ? deltaTime * GAME_CONFIG.driver.shakeOffAssistRate : 0);
    this.latchEscapeProgress = clamp(
      this.latchEscapeProgress + wiggleGain,
      0,
      GAME_CONFIG.ride.latchWiggleRequired,
    );
    this.latchEscapeProgress = Math.max(
      0,
      this.latchEscapeProgress - deltaTime * GAME_CONFIG.player.wiggleDecay,
    );

    if (this.latchEscapeProgress >= GAME_CONFIG.ride.latchWiggleRequired) {
      const kill = this.enemySystem.clearLatchedRunnerByWiggle();
      this.latchEscapeProgress = 0;
      if (kill) {
        this.playerSystem.state.score += kill.baseScore;
      }
    }
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
      resolution.intent === 'scrapeWreck' &&
      resolution.effectiveDecision === 'approve'
    ) {
      const impact = this.worldSystem.scrapeNearestObstacle(
        resolution.targetLaneIndex ?? this.playerSystem.state.laneIndex,
      );
      if (impact) {
        this.applyWorldImpact(impact);
      }
      return;
    }

    if (
      resolution.intent === 'shakeItOff' &&
      resolution.effectiveDecision === 'approve'
    ) {
      this.latchEscapeProgress = Math.max(
        this.latchEscapeProgress,
        GAME_CONFIG.ride.latchWiggleRequired * 0.32,
      );
      this.roughRoadJolt = Math.max(this.roughRoadJolt, 0.7);
      return;
    }

    if (
      (resolution.intent === 'cutLeft' || resolution.intent === 'pickupOpportunity') &&
      resolution.effectiveDecision === 'approve'
    ) {
      this.laneCutJolt = Math.max(this.laneCutJolt, 1);
    }
  }

  private composeRideState(
    baseRide: RideState,
    laneThreats: LaneThreatState[] = baseRide.laneThreats,
  ): RideState {
    const latchActive = this.enemySystem.hasLatchedRunner();
    return {
      ...baseRide,
      worldX: this.playerSystem.state.strafeX || baseRide.worldX,
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
    this.setState('dead');
    if (this.inputSystem.isPointerLocked()) {
      this.suppressUnlockPause = true;
      void document.exitPointerLock();
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
      this.engineLoop.setTurnAmount(0);
      this.engineLoop.pause();
    }
  }
}
