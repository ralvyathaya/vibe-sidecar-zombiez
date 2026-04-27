import type { Camera } from 'three';
import type {
  DebugTransformSnapshot,
  DebugTransformTarget,
  GameConfig,
  LoadoutState,
  NetworkWeaponKind,
  PickupEvent,
  RemotePresentationState,
  WeaponPolicy,
  WeaponKind,
  WeaponStatus,
} from '../../core/types';
import { BazookaWeapon } from '../weapons/BazookaWeapon';
import { PistolWeapon } from '../weapons/PistolWeapon';
import { ShotgunWeapon } from '../weapons/ShotgunWeapon';
import type { EnemySystem } from './EnemySystem';
import type { InputSystem } from './InputSystem';
import type { PlayerSystem } from './PlayerSystem';
import type { RewardSystem } from './RewardSystem';
import type { WorldSystem } from './WorldSystem';

export class WeaponSystem {
  private readonly bazookaWeapon: BazookaWeapon;
  private readonly pistolWeapon: PistolWeapon;
  private readonly shotgunWeapon: ShotgunWeapon;
  private activeWeapon: WeaponKind = 'pistol';
  private shotgunUnlocked = false;
  private bazookaRestoreWeapon: Extract<WeaponKind, 'pistol' | 'shotgun'> = 'pistol';
  private weaponPolicy: WeaponPolicy = 'full';
  private driverPistolStanceTimer = 0;
  private readonly driverPistolStanceHoldSeconds = 1.45;

  constructor(camera: Camera, private readonly config: GameConfig) {
    this.bazookaWeapon = new BazookaWeapon(camera, config);
    this.pistolWeapon = new PistolWeapon(camera, config);
    this.shotgunWeapon = new ShotgunWeapon(camera, config);
    this.bazookaWeapon.setEquipped(false);
    this.pistolWeapon.setEquipped(true);
    this.shotgunWeapon.setEquipped(false);
  }

  reset(player: PlayerSystem): void {
    this.activeWeapon = 'pistol';
    this.shotgunUnlocked = false;
    this.bazookaRestoreWeapon = 'pistol';
    this.driverPistolStanceTimer = 0;
    this.applyPistolViewmodelPolicy();
    this.bazookaWeapon.reset();
    this.bazookaWeapon.setEquipped(false);
    this.pistolWeapon.reset(player);
    this.pistolWeapon.setEquipped(true);
    this.pistolWeapon.setPresentationVisible(this.weaponPolicy !== 'pistolOnly');
    this.shotgunWeapon.reset();
    this.shotgunWeapon.setEquipped(false);

    if (this.weaponPolicy === 'pistolOnly') {
      return;
    }

    if (this.config.debug.developmentWeapons) {
      this.shotgunUnlocked = true;
      this.shotgunWeapon.setAmmo(this.config.shotgun.maxAmmo);
      this.bazookaWeapon.setAmmo(this.config.bazooka.maxAmmo);
      this.bazookaRestoreWeapon = 'shotgun';
      this.equipBazooka(player);
    }
  }

  updateRunning(
    deltaTime: number,
    input: InputSystem,
    player: PlayerSystem,
    enemies: EnemySystem,
    world: WorldSystem,
    rewards: RewardSystem,
  ): void {
    if (this.weaponPolicy === 'pistolOnly') {
      if (this.activeWeapon !== 'pistol') {
        this.equipPistol(player);
      }
      this.bazookaWeapon.updateBackground(deltaTime, player, enemies, world, rewards);
      this.pistolWeapon.updateRunning(deltaTime, input, player, enemies, world, rewards);
      return;
    }

    if (this.activeWeapon === 'bazooka') {
      this.bazookaWeapon.updateRunning(deltaTime, input, player, enemies, world, rewards);
      if (this.bazookaWeapon.consumePendingAutoReturn()) {
        this.restoreAfterBazooka(player);
      }
      return;
    }

    this.bazookaWeapon.updateBackground(deltaTime, player, enemies, world, rewards);

    if (this.activeWeapon === 'shotgun') {
      this.shotgunWeapon.updateRunning(deltaTime, input, player, enemies, world, rewards);
      if (this.shotgunWeapon.getAmmo() <= 0 && !this.shotgunWeapon.isCycling()) {
        this.equipPistol(player);
      }
      return;
    }

    this.pistolWeapon.updateRunning(deltaTime, input, player, enemies, world, rewards);
  }

  updateIdle(deltaTime: number): void {
    this.updateDriverPistolStance(deltaTime, false);
    this.bazookaWeapon.updateIdle(deltaTime);
    this.pistolWeapon.updateIdle(deltaTime);
    this.shotgunWeapon.updateIdle(deltaTime);
  }

  getStatus(player: PlayerSystem): WeaponStatus {
    if (this.weaponPolicy === 'pistolOnly') {
      return this.pistolWeapon.getStatus(player);
    }

    if (this.activeWeapon === 'bazooka') {
      return this.bazookaWeapon.getStatus();
    }

    if (this.activeWeapon === 'shotgun') {
      return this.shotgunWeapon.getStatus();
    }

    return this.pistolWeapon.getStatus(player);
  }

  applyPickup(pickup: PickupEvent, player: PlayerSystem): void {
    if (this.weaponPolicy === 'pistolOnly') {
      return;
    }

    if (pickup.type === 'bazooka') {
      this.applyBazookaPickup(player);
      return;
    }

    this.shotgunUnlocked = true;

    if (pickup.type === 'shotgun') {
      this.shotgunWeapon.setAmmo(this.config.pickups.shotgunPickupAmmo);
      if (this.activeWeapon === 'bazooka') {
        this.bazookaRestoreWeapon = 'shotgun';
      } else {
        this.equipShotgun(player);
      }
      return;
    }

    this.shotgunWeapon.addAmmo(pickup.ammo);
    if (this.activeWeapon === 'bazooka') {
      if (this.shotgunWeapon.getAmmo() > 0) {
        this.bazookaRestoreWeapon = 'shotgun';
      }
      return;
    }

    if (this.shotgunWeapon.getAmmo() > 0) {
      this.equipShotgun(player);
    }
  }

  hasUnlockedShotgun(): boolean {
    if (this.weaponPolicy === 'pistolOnly') {
      return false;
    }

    return this.shotgunUnlocked;
  }

  getLoadoutState(): LoadoutState {
    if (this.weaponPolicy === 'pistolOnly') {
      return {
        activeWeapon: 'pistol',
        shotgunUnlocked: false,
        shotgunAmmo: 0,
        bazookaAmmo: 0,
      };
    }

    return {
      activeWeapon: this.activeWeapon,
      shotgunUnlocked: this.shotgunUnlocked,
      shotgunAmmo: this.shotgunWeapon.getAmmo(),
      bazookaAmmo: this.bazookaWeapon.getAmmo(),
    };
  }

  destroy(): void {
    this.bazookaWeapon.destroy();
    this.pistolWeapon.destroy();
    this.shotgunWeapon.destroy();
  }

  setWeaponPolicy(policy: WeaponPolicy, player?: PlayerSystem): void {
    if (this.weaponPolicy === policy) {
      this.applyPistolViewmodelPolicy();
      if (policy === 'full') {
        this.driverPistolStanceTimer = 0;
        this.pistolWeapon.setPresentationVisible(true);
      }
      return;
    }

    this.weaponPolicy = policy;
    this.driverPistolStanceTimer = 0;
    this.applyPistolViewmodelPolicy();
    this.pistolWeapon.setPresentationVisible(policy !== 'pistolOnly');
    if (policy === 'pistolOnly' && player) {
      this.shotgunUnlocked = false;
      this.shotgunWeapon.setAmmo(0);
      this.bazookaWeapon.setAmmo(0);
      this.bazookaRestoreWeapon = 'pistol';
      this.equipPistol(player);
    }
  }

  updateDriverPistolStance(deltaTime: number, fireIntent: boolean): void {
    if (this.weaponPolicy !== 'pistolOnly') {
      this.driverPistolStanceTimer = 0;
      this.pistolWeapon.setPresentationVisible(true);
      return;
    }

    if (fireIntent) {
      this.driverPistolStanceTimer = this.driverPistolStanceHoldSeconds;
    } else {
      this.driverPistolStanceTimer = Math.max(0, this.driverPistolStanceTimer - deltaTime);
    }

    this.pistolWeapon.setPresentationVisible(this.driverPistolStanceTimer > 0);
  }

  isDriverPistolStanceActive(): boolean {
    return this.weaponPolicy === 'pistolOnly' && this.driverPistolStanceTimer > 0;
  }

  getPresentationState(role: RemotePresentationState['role']): RemotePresentationState {
    const activeWeapon = this.weaponPolicy === 'pistolOnly' ? 'pistol' : this.activeWeapon;
    return {
      role,
      currentWeapon: this.toNetworkWeaponKind(activeWeapon),
      isFiring: this.isActiveWeaponRecentlyFiring(activeWeapon),
      firePulse: this.getActiveWeaponFirePulse(activeWeapon),
    };
  }

  getDebugViewmodelTransform(target: DebugTransformTarget): DebugTransformSnapshot | null {
    if (
      target === 'pistolViewmodel' ||
      target === 'driverPistolViewmodel' ||
      target === 'gunnerHandgunViewmodel'
    ) {
      return this.pistolWeapon.getDebugViewmodelTransform();
    }
    if (target === 'shotgunViewmodel' || target === 'gunnerShotgunViewmodel') {
      return this.shotgunWeapon.getDebugViewmodelTransform();
    }
    if (target === 'bazookaViewmodel' || target === 'gunnerBazookaViewmodel') {
      return this.bazookaWeapon.getDebugViewmodelTransform();
    }
    return null;
  }

  setDebugViewmodelTransform(
    target: DebugTransformTarget,
    snapshot: DebugTransformSnapshot,
  ): void {
    if (
      target === 'pistolViewmodel' ||
      target === 'driverPistolViewmodel' ||
      target === 'gunnerHandgunViewmodel'
    ) {
      this.pistolWeapon.setDebugViewmodelTransform(snapshot);
      return;
    }
    if (target === 'shotgunViewmodel' || target === 'gunnerShotgunViewmodel') {
      this.shotgunWeapon.setDebugViewmodelTransform(snapshot);
      return;
    }
    if (target === 'bazookaViewmodel' || target === 'gunnerBazookaViewmodel') {
      this.bazookaWeapon.setDebugViewmodelTransform(snapshot);
    }
  }

  resetDebugViewmodelTransform(target: DebugTransformTarget): DebugTransformSnapshot | null {
    if (
      target === 'pistolViewmodel' ||
      target === 'driverPistolViewmodel' ||
      target === 'gunnerHandgunViewmodel'
    ) {
      return this.pistolWeapon.resetDebugViewmodelTransform();
    }
    if (target === 'shotgunViewmodel' || target === 'gunnerShotgunViewmodel') {
      return this.shotgunWeapon.resetDebugViewmodelTransform();
    }
    if (target === 'bazookaViewmodel' || target === 'gunnerBazookaViewmodel') {
      return this.bazookaWeapon.resetDebugViewmodelTransform();
    }
    return null;
  }

  private equipPistol(player: PlayerSystem): void {
    this.activeWeapon = 'pistol';
    this.bazookaWeapon.setEquipped(false);
    this.shotgunWeapon.setEquipped(false);
    this.pistolWeapon.setEquipped(true);
    player.state.reloading = false;
  }

  private applyPistolViewmodelPolicy(): void {
    this.pistolWeapon.setFpsViewmodelKey(
      this.weaponPolicy === 'pistolOnly' ? 'driver_pistol' : 'gunner_handgun',
    );
  }

  private equipShotgun(player: PlayerSystem): void {
    const wasShotgun = this.activeWeapon === 'shotgun';
    this.activeWeapon = 'shotgun';
    this.bazookaWeapon.setEquipped(false);
    this.pistolWeapon.cancelReload(player);
    this.pistolWeapon.setEquipped(false);
    this.shotgunWeapon.setEquipped(true);
    if (!wasShotgun) {
      this.shotgunWeapon.playEquipIntro();
    }
  }

  private applyBazookaPickup(player: PlayerSystem): void {
    this.bazookaWeapon.setAmmo(this.config.bazooka.maxAmmo);
    if (this.activeWeapon !== 'bazooka') {
      this.bazookaRestoreWeapon = this.getWeaponToRestore();
    }
    this.equipBazooka(player);
  }

  private equipBazooka(player: PlayerSystem): void {
    this.activeWeapon = 'bazooka';
    this.pistolWeapon.cancelReload(player);
    this.pistolWeapon.setEquipped(false);
    this.shotgunWeapon.setEquipped(false);
    this.bazookaWeapon.setEquipped(true);
    player.state.reloading = false;
  }

  private restoreAfterBazooka(player: PlayerSystem): void {
    const shouldRestoreShotgun =
      this.bazookaRestoreWeapon === 'shotgun' && this.shotgunWeapon.getAmmo() > 0;

    if (shouldRestoreShotgun) {
      this.equipShotgun(player);
    } else {
      this.equipPistol(player);
    }

    this.bazookaRestoreWeapon = 'pistol';
  }

  private getWeaponToRestore(): Extract<WeaponKind, 'pistol' | 'shotgun'> {
    if (this.activeWeapon === 'shotgun' && this.shotgunWeapon.getAmmo() > 0) {
      return 'shotgun';
    }

    if (this.activeWeapon === 'bazooka') {
      return this.bazookaRestoreWeapon;
    }

    return 'pistol';
  }

  private toNetworkWeaponKind(weapon: WeaponKind): NetworkWeaponKind {
    return weapon === 'pistol' ? 'handgun' : weapon;
  }

  private getActiveWeaponFirePulse(weapon: WeaponKind): number {
    if (weapon === 'bazooka') {
      return this.bazookaWeapon.getFirePulse();
    }
    if (weapon === 'shotgun') {
      return this.shotgunWeapon.getFirePulse();
    }
    return this.pistolWeapon.getFirePulse();
  }

  private isActiveWeaponRecentlyFiring(weapon: WeaponKind): boolean {
    if (weapon === 'bazooka') {
      return this.bazookaWeapon.isRecentlyFiring();
    }
    if (weapon === 'shotgun') {
      return this.shotgunWeapon.isRecentlyFiring();
    }
    return this.pistolWeapon.isRecentlyFiring();
  }
}
