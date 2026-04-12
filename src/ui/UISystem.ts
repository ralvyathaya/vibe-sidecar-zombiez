import type { GameStateType, PlayerState, WeaponStatus } from '../core/types';
import { formatDistance } from '../core/utils';

type HUDSnapshot = {
  gameState: GameStateType;
  player: PlayerState;
  weapon: WeaponStatus;
  elapsedSeconds: number;
};

export class UISystem {
  onPrimaryAction?: () => void;

  private readonly root = document.createElement('div');
  private readonly overlay = document.createElement('div');
  private readonly overlayTitle = document.createElement('h1');
  private readonly overlayText = document.createElement('p');
  private readonly overlayButton = document.createElement('button');
  private readonly healthFill = document.createElement('div');
  private readonly healthValue = document.createElement('span');
  private readonly ammoValue = document.createElement('span');
  private readonly ammoHint = document.createElement('span');
  private readonly scoreValue = document.createElement('span');
  private readonly distanceValue = document.createElement('span');
  private readonly timerValue = document.createElement('span');
  private readonly crosshair = document.createElement('div');
  private readonly vignette = document.createElement('div');

  constructor(host: HTMLElement) {
    this.root.className = 'ui-root';

    const hud = document.createElement('div');
    hud.className = 'hud';

    const leftPanel = document.createElement('div');
    leftPanel.className = 'hud-panel';

    const healthLabel = document.createElement('span');
    healthLabel.className = 'panel-label';
    healthLabel.textContent = 'Health';
    leftPanel.append(healthLabel);

    const healthBar = document.createElement('div');
    healthBar.className = 'health-bar';
    this.healthFill.className = 'health-fill';
    healthBar.append(this.healthFill);

    this.healthValue.className = 'panel-value';
    leftPanel.append(healthBar, this.healthValue);

    const rightPanel = document.createElement('div');
    rightPanel.className = 'hud-panel hud-panel--tight';

    const ammoLabel = document.createElement('span');
    ammoLabel.className = 'panel-label';
    ammoLabel.textContent = 'Ammo';
    this.ammoValue.className = 'ammo-value';
    this.ammoHint.className = 'ammo-hint';
    rightPanel.append(ammoLabel, this.ammoValue, this.ammoHint);

    const statsPanel = document.createElement('div');
    statsPanel.className = 'stats-panel';
    this.scoreValue.className = 'stat-chip';
    this.distanceValue.className = 'stat-chip';
    this.timerValue.className = 'stat-chip';
    statsPanel.append(this.scoreValue, this.distanceValue, this.timerValue);

    hud.append(leftPanel, rightPanel, statsPanel);

    this.crosshair.className = 'crosshair';
    this.vignette.className = 'damage-vignette';

    this.overlay.className = 'overlay';
    this.overlayTitle.className = 'overlay-title';
    this.overlayText.className = 'overlay-text';
    this.overlayButton.className = 'overlay-button';
    this.overlayButton.addEventListener('click', () => {
      this.onPrimaryAction?.();
    });

    this.overlay.append(this.overlayTitle, this.overlayText, this.overlayButton);
    this.root.append(hud, this.crosshair, this.vignette, this.overlay);
    host.append(this.root);
  }

  setState(gameState: GameStateType): void {
    this.root.dataset.state = gameState;

    switch (gameState) {
      case 'menu':
        this.overlay.hidden = false;
        this.overlayTitle.textContent = 'Dead Rush Highway';
        this.overlayText.textContent =
          'Survive the collapsing highway. Mouse aim, click to fire, A/D to dodge, R to reload.';
        this.overlayButton.textContent = 'Click To Start';
        break;
      case 'paused':
        this.overlay.hidden = false;
        this.overlayTitle.textContent = 'Paused';
        this.overlayText.textContent =
          'Pointer lock was released. Click back in to resume the run.';
        this.overlayButton.textContent = 'Resume';
        break;
      case 'dead':
        this.overlay.hidden = false;
        this.overlayTitle.textContent = 'Run Over';
        this.overlayText.textContent =
          'You got dragged down on the highway. Restart immediately and push farther.';
        this.overlayButton.textContent = 'Restart';
        break;
      case 'running':
      default:
        this.overlay.hidden = true;
        break;
    }
  }

  update(snapshot: HUDSnapshot): void {
    const healthRatio = Math.max(0, snapshot.player.health / snapshot.player.maxHealth);
    this.healthFill.style.transform = `scaleX(${healthRatio})`;
    this.healthValue.textContent = `${Math.ceil(snapshot.player.health)} / ${snapshot.player.maxHealth}`;

    this.ammoValue.textContent = `${snapshot.weapon.ammoInMagazine} / ${snapshot.weapon.reserveAmmoText}`;
    this.ammoValue.dataset.state = snapshot.weapon.reloading
      ? 'reloading'
      : snapshot.weapon.ammoInMagazine === 0
        ? 'empty'
        : 'ready';
    this.ammoHint.textContent = snapshot.weapon.reloading
      ? `Reloading ${Math.ceil(snapshot.weapon.reloadProgress * 100)}%`
      : snapshot.weapon.canReload
        ? 'Press R to reload'
        : 'Keep the lane clear';

    this.scoreValue.textContent = `Score ${snapshot.player.score}`;
    this.distanceValue.textContent = `Distance ${formatDistance(snapshot.player.distance)}`;
    this.timerValue.textContent = `Time ${snapshot.elapsedSeconds.toFixed(1)}s`;

    this.crosshair.dataset.hit = snapshot.weapon.hitConfirm > 0 ? 'true' : 'false';
    this.vignette.style.opacity = `${(snapshot.player.hitFlash * 0.55).toFixed(2)}`;
    this.root.dataset.state = snapshot.gameState;
  }
}
