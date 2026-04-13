import { PerspectiveCamera, Vector2, Vector3 } from 'three';
import type { GameConfig, PlayerState } from '../../core/types';
import { approach, clamp } from '../../core/utils';
import type { InputSystem } from './InputSystem';

export class PlayerSystem {
  readonly state: PlayerState;

  private readonly lookDelta = new Vector2();
  private readonly worldPosition = new Vector3();
  private yaw = 0;
  private pitch = 0;
  private recoilPitch = 0;
  private hurtRoll = 0;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly config: GameConfig,
  ) {
    this.state = this.createInitialState();
    this.applyCameraTransform(0);
  }

  reset(): void {
    Object.assign(this.state, this.createInitialState());
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.hurtRoll = 0;
    this.applyCameraTransform(0);
  }

  updateRunning(deltaTime: number, input: InputSystem): void {
    const moveAxis = input.getStrafeAxis();
    this.lookDelta.copy(input.consumeLookDelta(this.lookDelta));

    this.yaw = clamp(
      this.yaw - this.lookDelta.x * this.config.player.mouseSensitivity,
      -this.config.player.maxYaw,
      this.config.player.maxYaw,
    );
    this.pitch = clamp(
      this.pitch - this.lookDelta.y * this.config.player.mouseSensitivity,
      this.config.player.minPitch,
      this.config.player.maxPitch,
    );

    this.state.strafeX = clamp(
      this.state.strafeX + moveAxis * this.config.player.strafeSpeed * deltaTime,
      -this.config.player.roadHalfWidth,
      this.config.player.roadHalfWidth,
    );
    this.state.distance += this.config.player.forwardSpeed * deltaTime;
    this.state.hitFlash = approach(this.state.hitFlash, 0, deltaTime * 2.8);
    this.recoilPitch = approach(
      this.recoilPitch,
      0,
      this.config.weapon.recoilRecovery * deltaTime,
    );
    this.hurtRoll = approach(this.hurtRoll, 0, deltaTime * 4.2);
    this.applyCameraTransform(moveAxis);
  }

  updateIdle(deltaTime: number): void {
    this.state.hitFlash = approach(this.state.hitFlash, 0, deltaTime * 2.8);
    this.recoilPitch = approach(
      this.recoilPitch,
      0,
      this.config.weapon.recoilRecovery * deltaTime,
    );
    this.hurtRoll = approach(this.hurtRoll, 0, deltaTime * 3.5);
    this.applyCameraTransform(0);
  }

  applyRecoil(amount: number): void {
    this.recoilPitch = clamp(this.recoilPitch - amount, -0.32, 0);
  }

  applyDamage(amount: number, sourceX = this.state.strafeX): void {
    if (!this.state.alive) {
      return;
    }

    this.state.health = Math.max(0, this.state.health - amount);
    this.state.hitFlash = 1;
    this.hurtRoll = clamp(
      (sourceX - this.state.strafeX) / (this.config.player.roadHalfWidth * 0.6),
      -0.5,
      0.5,
    );

    if (this.state.health <= 0) {
      this.state.alive = false;
    }
  }

  getPosition(target = new Vector3()): Vector3 {
    return target.copy(this.worldPosition);
  }

  getFacingDirection(target = new Vector3()): Vector3 {
    this.camera.getWorldDirection(target);
    target.y = 0;
    if (target.lengthSq() < 0.0001) {
      target.set(0, 0, -1);
    }
    return target.normalize();
  }

  private applyCameraTransform(moveAxis: number): void {
    const bob = Math.sin(this.state.distance * this.config.player.bobFrequency) *
      this.config.player.bobAmplitude;
    const sway = moveAxis * 0.01;

    this.camera.position.set(
      this.state.strafeX,
      this.config.player.eyeHeight + bob - this.state.hitFlash * 0.05,
      0,
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch + this.recoilPitch;
    this.camera.rotation.z = this.hurtRoll * 0.18 + sway;
    this.worldPosition.copy(this.camera.position);
  }

  private createInitialState(): PlayerState {
    return {
      health: this.config.player.maxHealth,
      maxHealth: this.config.player.maxHealth,
      strafeX: 0,
      distance: 0,
      score: 0,
      ammoInMagazine: this.config.weapon.magazineSize,
      ammoReserve: Number.POSITIVE_INFINITY,
      reloading: false,
      alive: true,
      hitFlash: 0,
    };
  }
}
