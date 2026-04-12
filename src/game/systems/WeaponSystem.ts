import {
  BoxGeometry,
  Camera,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector2,
} from 'three';
import type { GameConfig, WeaponStatus } from '../../core/types';
import { approach, clamp } from '../../core/utils';
import type { EnemySystem } from './EnemySystem';
import type { InputSystem } from './InputSystem';
import type { PlayerSystem } from './PlayerSystem';

export class WeaponSystem {
  private readonly weaponGroup = new Group();
  private readonly muzzleFlash: Mesh;
  private readonly crosshair = new Vector2(0, 0);
  private cooldown = 0;
  private reloadTimer = 0;
  private reloadElapsed = 0;
  private muzzleFlashTimer = 0;
  private hitConfirmTimer = 0;
  private dryFireTimer = 0;

  constructor(
    private readonly camera: Camera,
    private readonly config: GameConfig,
  ) {
    const receiverMaterial = new MeshStandardMaterial({
      color: 0x26221f,
      flatShading: true,
      roughness: 0.8,
    });
    const accentMaterial = new MeshStandardMaterial({
      color: 0xb1733c,
      flatShading: true,
      roughness: 0.6,
    });

    const body = new Mesh(new BoxGeometry(0.18, 0.16, 0.7), receiverMaterial);
    body.position.set(0, -0.08, -0.32);
    this.weaponGroup.add(body);

    const barrel = new Mesh(new BoxGeometry(0.08, 0.08, 0.42), accentMaterial);
    barrel.position.set(0.04, -0.02, -0.74);
    this.weaponGroup.add(barrel);

    const grip = new Mesh(new BoxGeometry(0.11, 0.22, 0.14), receiverMaterial);
    grip.position.set(-0.02, -0.22, -0.08);
    grip.rotation.z = -0.24;
    this.weaponGroup.add(grip);

    this.muzzleFlash = new Mesh(
      new SphereGeometry(0.06, 8, 8),
      new MeshBasicMaterial({
        color: 0xffc66b,
        transparent: true,
        opacity: 0.95,
      }),
    );
    this.muzzleFlash.position.set(0.04, -0.02, -0.98);
    this.muzzleFlash.visible = false;
    this.weaponGroup.add(this.muzzleFlash);

    this.weaponGroup.position.set(0.33, -0.3, -0.28);
    this.weaponGroup.rotation.set(0.04, -0.08, -0.02);
    this.weaponGroup.renderOrder = 10;
    this.camera.add(this.weaponGroup);
  }

  reset(player: PlayerSystem): void {
    this.cooldown = 0;
    this.reloadTimer = 0;
    this.reloadElapsed = 0;
    this.muzzleFlashTimer = 0;
    this.hitConfirmTimer = 0;
    this.dryFireTimer = 0;
    this.muzzleFlash.visible = false;
    player.state.ammoInMagazine = this.config.weapon.magazineSize;
    player.state.reloading = false;
  }

  updateRunning(
    deltaTime: number,
    input: InputSystem,
    player: PlayerSystem,
    enemies: EnemySystem,
  ): void {
    this.cooldown = Math.max(0, this.cooldown - deltaTime);
    this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - deltaTime);
    this.dryFireTimer = Math.max(0, this.dryFireTimer - deltaTime);

    this.updateReload(deltaTime, player);

    if (input.consumeReloadPressed()) {
      this.startReload(player);
    }

    if (!player.state.reloading && input.isFireHeld() && this.cooldown <= 0) {
      if (player.state.ammoInMagazine > 0) {
        this.fire(player, enemies);
      } else {
        this.dryFireTimer = 0.2;
        this.cooldown = 0.12;
      }
    }

    this.updatePresentation(deltaTime, player);
  }

  updateIdle(deltaTime: number): void {
    this.hitConfirmTimer = Math.max(0, this.hitConfirmTimer - deltaTime);
    this.dryFireTimer = Math.max(0, this.dryFireTimer - deltaTime);
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - deltaTime);
    this.muzzleFlash.visible = this.muzzleFlashTimer > 0;
    this.weaponGroup.position.y = approach(this.weaponGroup.position.y, -0.3, deltaTime * 2.2);
  }

  getStatus(player: PlayerSystem): WeaponStatus {
    return {
      ammoInMagazine: player.state.ammoInMagazine,
      magazineSize: this.config.weapon.magazineSize,
      reloading: player.state.reloading,
      reloadProgress: player.state.reloading
        ? this.reloadElapsed / this.config.weapon.reloadDuration
        : 0,
      reserveAmmoText: Number.isFinite(player.state.ammoReserve)
        ? `${player.state.ammoReserve}`
        : '∞',
      hitConfirm: this.hitConfirmTimer,
      canReload:
        !player.state.reloading &&
        player.state.ammoInMagazine < this.config.weapon.magazineSize,
    };
  }

  private fire(player: PlayerSystem, enemies: EnemySystem): void {
    this.cooldown = 1 / this.config.weapon.fireRate;
    this.muzzleFlashTimer = 0.06;
    this.muzzleFlash.visible = true;
    player.state.ammoInMagazine -= 1;
    player.applyRecoil(this.config.weapon.recoilKick);

    const hitZombie = enemies.raycast(this.camera, this.crosshair, this.config.weapon.range);
    if (hitZombie) {
      const scoreValue = enemies.damage(hitZombie, this.config.weapon.damagePerShot);
      this.hitConfirmTimer = 0.1;
      if (scoreValue > 0) {
        player.state.score += scoreValue;
      }
    }

    this.weaponGroup.position.y = -0.34;
  }

  private startReload(player: PlayerSystem): void {
    if (
      player.state.reloading ||
      player.state.ammoInMagazine === this.config.weapon.magazineSize
    ) {
      return;
    }

    player.state.reloading = true;
    this.reloadTimer = this.config.weapon.reloadDuration;
    this.reloadElapsed = 0;
  }

  private updateReload(deltaTime: number, player: PlayerSystem): void {
    if (!player.state.reloading) {
      return;
    }

    this.reloadTimer = Math.max(0, this.reloadTimer - deltaTime);
    this.reloadElapsed = clamp(
      this.reloadElapsed + deltaTime,
      0,
      this.config.weapon.reloadDuration,
    );

    if (this.reloadTimer <= 0) {
      player.state.reloading = false;
      player.state.ammoInMagazine = this.config.weapon.magazineSize;
      this.reloadElapsed = 0;
    }
  }

  private updatePresentation(deltaTime: number, player: PlayerSystem): void {
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - deltaTime);
    this.muzzleFlash.visible = this.muzzleFlashTimer > 0;

    const reloadDip = player.state.reloading ? 0.07 : 0;
    this.weaponGroup.position.y = approach(
      this.weaponGroup.position.y,
      -0.3 - reloadDip,
      deltaTime * 9,
    );
    this.weaponGroup.rotation.z = approach(
      this.weaponGroup.rotation.z,
      player.state.reloading ? -0.2 : -0.02,
      deltaTime * 8,
    );
  }
}
