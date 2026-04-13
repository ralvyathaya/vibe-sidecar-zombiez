import type { Camera } from 'three';
import type { GameConfig, WeaponStatus } from '../../core/types';
import { PistolWeapon } from '../weapons/PistolWeapon';
import type { EnemySystem } from './EnemySystem';
import type { InputSystem } from './InputSystem';
import type { PlayerSystem } from './PlayerSystem';
import type { WorldSystem } from './WorldSystem';

type ActiveWeapon = {
  reset(player: PlayerSystem): void;
  updateRunning(
    deltaTime: number,
    input: InputSystem,
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
  ): void;
  updateIdle(deltaTime: number): void;
  getStatus(player: PlayerSystem): WeaponStatus;
  destroy(): void;
};

export class WeaponSystem {
  private readonly activeWeapon: ActiveWeapon;

  constructor(camera: Camera, config: GameConfig) {
    this.activeWeapon = new PistolWeapon(camera, config);
  }

  reset(player: PlayerSystem): void {
    this.activeWeapon.reset(player);
  }

  updateRunning(
    deltaTime: number,
    input: InputSystem,
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
  ): void {
    this.activeWeapon.updateRunning(deltaTime, input, player, enemies, world);
  }

  updateIdle(deltaTime: number): void {
    this.activeWeapon.updateIdle(deltaTime);
  }

  getStatus(player: PlayerSystem): WeaponStatus {
    return this.activeWeapon.getStatus(player);
  }

  destroy(): void {
    this.activeWeapon.destroy();
  }
}
