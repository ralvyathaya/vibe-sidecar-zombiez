import type { Camera } from 'three';
import type { GameConfig, PickupEvent, WeaponKind, WeaponStatus } from '../../core/types';
import { PistolWeapon } from '../weapons/PistolWeapon';
import { ShotgunWeapon } from '../weapons/ShotgunWeapon';
import type { EnemySystem } from './EnemySystem';
import type { InputSystem } from './InputSystem';
import type { PlayerSystem } from './PlayerSystem';
import type { WorldSystem } from './WorldSystem';

export class WeaponSystem {
  private readonly pistolWeapon: PistolWeapon;
  private readonly shotgunWeapon: ShotgunWeapon;
  private activeWeapon: WeaponKind = 'pistol';
  private shotgunUnlocked = false;

  constructor(camera: Camera, private readonly config: GameConfig) {
    this.pistolWeapon = new PistolWeapon(camera, config);
    this.shotgunWeapon = new ShotgunWeapon(camera, config);
    this.pistolWeapon.setEquipped(true);
    this.shotgunWeapon.setEquipped(false);
  }

  reset(player: PlayerSystem): void {
    this.activeWeapon = 'pistol';
    this.shotgunUnlocked = false;
    this.pistolWeapon.reset(player);
    this.pistolWeapon.setEquipped(true);
    this.shotgunWeapon.reset();
    this.shotgunWeapon.setEquipped(false);
  }

  updateRunning(
    deltaTime: number,
    input: InputSystem,
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
  ): void {
    if (this.activeWeapon === 'shotgun') {
      this.shotgunWeapon.updateRunning(deltaTime, input, player, enemies, world);
      if (this.shotgunWeapon.getAmmo() <= 0) {
        this.equipPistol(player);
      }
      return;
    }

    this.pistolWeapon.updateRunning(deltaTime, input, player, enemies, world);
  }

  updateIdle(deltaTime: number): void {
    this.pistolWeapon.updateIdle(deltaTime);
    this.shotgunWeapon.updateIdle(deltaTime);
  }

  getStatus(player: PlayerSystem): WeaponStatus {
    if (this.activeWeapon === 'shotgun') {
      return this.shotgunWeapon.getStatus();
    }

    return this.pistolWeapon.getStatus(player);
  }

  applyPickup(pickup: PickupEvent, player: PlayerSystem): void {
    this.shotgunUnlocked = true;

    if (pickup.type === 'shotgun') {
      this.shotgunWeapon.setAmmo(this.config.pickups.shotgunPickupAmmo);
      this.equipShotgun(player);
      return;
    }

    this.shotgunWeapon.addAmmo(pickup.ammo);
    if (this.shotgunWeapon.getAmmo() > 0) {
      this.equipShotgun(player);
    }
  }

  hasUnlockedShotgun(): boolean {
    return this.shotgunUnlocked;
  }

  destroy(): void {
    this.pistolWeapon.destroy();
    this.shotgunWeapon.destroy();
  }

  private equipPistol(player: PlayerSystem): void {
    this.activeWeapon = 'pistol';
    this.shotgunWeapon.setEquipped(false);
    this.pistolWeapon.setEquipped(true);
    player.state.reloading = false;
  }

  private equipShotgun(player: PlayerSystem): void {
    this.activeWeapon = 'shotgun';
    this.pistolWeapon.cancelReload(player);
    this.pistolWeapon.setEquipped(false);
    this.shotgunWeapon.setEquipped(true);
  }
}
