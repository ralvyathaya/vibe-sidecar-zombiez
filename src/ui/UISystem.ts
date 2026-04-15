import type {
  GameStateType,
  PlayerState,
  RadarContact,
  WeaponStatus,
} from '../core/types';
import { formatDistance } from '../core/utils';

type HUDSnapshot = {
  gameState: GameStateType;
  player: PlayerState;
  weapon: WeaponStatus;
  elapsedSeconds: number;
  radarContacts: RadarContact[];
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
  private readonly healthState = document.createElement('span');
  private readonly ammoPanel = document.createElement('div');
  private readonly weaponHeader = document.createElement('div');
  private readonly weaponIcon = document.createElement('div');
  private readonly weaponName = document.createElement('span');
  private readonly ammoValue = document.createElement('span');
  private readonly ammoReserve = document.createElement('span');
  private readonly reloadHint = document.createElement('div');
  private readonly reloadHintTextBefore = document.createElement('span');
  private readonly reloadKey = document.createElement('span');
  private readonly reloadLabel = document.createElement('span');
  private readonly scoreValue = document.createElement('span');
  private readonly distanceValue = document.createElement('span');
  private readonly timerValue = document.createElement('span');
  private readonly radarPanel = document.createElement('div');
  private readonly radarTrack = document.createElement('div');
  private readonly radarContactLayer = document.createElement('div');
  private readonly radarCaret = document.createElement('div');
  private readonly crosshair = document.createElement('div');
  private readonly vignette = document.createElement('div');
  private readonly ammoRounds: HTMLSpanElement[] = [];
  private readonly radarDots: HTMLSpanElement[] = [];

  constructor(host: HTMLElement) {
    this.root.className = 'ui-root';

    const hud = document.createElement('div');
    hud.className = 'hud';

    const hudTop = document.createElement('div');
    hudTop.className = 'hud-top';

    const hudMiddle = document.createElement('div');
    hudMiddle.className = 'hud-middle';

    const hudBottom = document.createElement('div');
    hudBottom.className = 'hud-bottom';

    this.radarPanel.className = 'radar-panel';
    this.radarTrack.className = 'radar-track';
    this.radarContactLayer.className = 'radar-contacts';
    this.radarCaret.className = 'radar-caret';
    this.radarTrack.append(this.radarContactLayer, this.radarCaret);
    this.radarPanel.append(this.radarTrack);

    for (let index = 0; index < 14; index += 1) {
      const dot = document.createElement('span');
      dot.className = 'radar-dot';
      dot.hidden = true;
      this.radarContactLayer.append(dot);
      this.radarDots.push(dot);
    }

    const statsPanel = document.createElement('div');
    statsPanel.className = 'stats-panel stats-panel--side';
    this.scoreValue.className = 'stat-chip';
    this.distanceValue.className = 'stat-chip';
    this.timerValue.className = 'stat-chip';
    statsPanel.append(this.scoreValue, this.distanceValue, this.timerValue);

    const leftPanel = document.createElement('div');
    leftPanel.className = 'hud-panel hud-panel--health';

    const healthLabel = document.createElement('span');
    healthLabel.className = 'panel-label';
    healthLabel.textContent = 'Health';

    const healthHeader = document.createElement('div');
    healthHeader.className = 'health-header';
    this.healthValue.className = 'panel-value';
    this.healthState.className = 'health-state';
    healthHeader.append(this.healthValue, this.healthState);

    const healthBar = document.createElement('div');
    healthBar.className = 'health-bar';
    this.healthFill.className = 'health-fill';
    healthBar.append(this.healthFill);
    leftPanel.append(healthLabel, healthHeader, healthBar);

    this.ammoPanel.className = 'hud-panel hud-panel--ammo';
    const ammoLabel = document.createElement('span');
    ammoLabel.className = 'panel-label';
    ammoLabel.textContent = 'Ammo';

    this.weaponHeader.className = 'weapon-header';
    this.weaponIcon.className = 'weapon-icon';
    this.weaponName.className = 'weapon-name';
    this.weaponHeader.append(this.weaponIcon, this.weaponName);

    const ammoHeader = document.createElement('div');
    ammoHeader.className = 'ammo-header';
    this.ammoValue.className = 'ammo-value';
    this.ammoReserve.className = 'ammo-reserve';
    ammoHeader.append(this.ammoValue, this.ammoReserve);

    const ammoRack = document.createElement('div');
    ammoRack.className = 'ammo-rack';
    for (let index = 0; index < 12; index += 1) {
      const round = document.createElement('span');
      round.className = 'ammo-round';
      ammoRack.append(round);
      this.ammoRounds.push(round);
    }

    this.ammoPanel.append(ammoLabel, this.weaponHeader, ammoRack, ammoHeader);

    this.reloadHint.className = 'reload-hint';
    this.reloadHintTextBefore.className = 'reload-hint-text';
    this.reloadHintTextBefore.textContent = 'Press';
    this.reloadKey.className = 'reload-key';
    this.reloadKey.textContent = 'R';
    this.reloadLabel.className = 'reload-label';
    this.reloadLabel.textContent = 'to reload';
    this.reloadHint.append(this.reloadHintTextBefore, this.reloadKey, this.reloadLabel);

    hudTop.append(this.radarPanel);
    hudMiddle.append(statsPanel);
    hudBottom.append(leftPanel, this.ammoPanel);
    hud.append(hudTop, hudMiddle, hudBottom);

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
    this.root.append(hud, this.reloadHint, this.crosshair, this.vignette, this.overlay);
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
    const healthHue = Math.max(4, Math.round(healthRatio * 118));
    const healthColor = `hsl(${healthHue} 82% 50%)`;
    const healthAccent = `hsl(${Math.min(healthHue + 16, 128)} 78% 62%)`;
    this.healthFill.style.background = `linear-gradient(90deg, ${healthColor} 0%, ${healthAccent} 100%)`;
    this.healthFill.style.boxShadow = `0 0 22px hsla(${healthHue} 90% 56% / 0.42)`;
    this.healthState.textContent =
      healthRatio > 0.65 ? 'Stable' : healthRatio > 0.3 ? 'Critical' : 'Near Death';
    this.healthState.style.color =
      healthRatio > 0.65 ? '#8fe08d' : healthRatio > 0.3 ? '#ffb15f' : '#ff6652';

    const ammoState = snapshot.weapon.reloading
      ? 'reloading'
      : snapshot.weapon.ammoInMagazine === 0
        ? 'empty'
        : 'ready';
    this.ammoPanel.dataset.state = ammoState;
    this.ammoPanel.dataset.weapon = snapshot.weapon.weaponType;
    this.ammoValue.dataset.state = ammoState;
    this.ammoReserve.dataset.state = ammoState;
    this.weaponIcon.dataset.weapon = snapshot.weapon.weaponType;
    this.weaponName.textContent = snapshot.weapon.weaponLabel;
    this.ammoValue.textContent = `${snapshot.weapon.ammoInMagazine}`;
    this.ammoReserve.textContent = snapshot.weapon.reserveAmmoText;
    this.ammoReserve.hidden = !snapshot.weapon.showReserve;

    for (let index = 0; index < this.ammoRounds.length; index += 1) {
      const round = this.ammoRounds[index];
      round.hidden = index >= snapshot.weapon.magazineSize;
      round.dataset.loaded = index < snapshot.weapon.ammoInMagazine ? 'true' : 'false';
      round.dataset.state = ammoState;
      round.dataset.shape = snapshot.weapon.roundStyle;
    }

    this.reloadHint.hidden = !snapshot.weapon.showReloadHint;

    this.scoreValue.textContent = `Score ${snapshot.player.score}`;
    this.distanceValue.textContent = `Distance ${formatDistance(snapshot.player.distance)}`;
    this.timerValue.textContent = `Time ${snapshot.elapsedSeconds.toFixed(1)}s`;

    for (let index = 0; index < this.radarDots.length; index += 1) {
      const dot = this.radarDots[index];
      const contact = snapshot.radarContacts[index];
      if (!contact) {
        dot.hidden = true;
        continue;
      }

      dot.hidden = false;
      dot.style.left = `${50 + contact.offset * 46}%`;
      dot.style.opacity = `${(0.38 + contact.proximity * 0.62).toFixed(2)}`;
      dot.style.transform = `translate(-50%, -50%) scale(${(
        0.82 + contact.proximity * 0.55
      ).toFixed(3)})`;
      dot.dataset.type = contact.type;
    }

    this.crosshair.dataset.hit = snapshot.weapon.hitConfirm > 0 ? 'true' : 'false';
    this.crosshair.style.setProperty(
      '--crosshair-spread',
      `${(snapshot.weapon.crosshairKick * 6).toFixed(2)}px`,
    );
    this.crosshair.style.transform = `translate(-50%, -50%) scale(${(
      1 + snapshot.weapon.crosshairKick * 0.035
    ).toFixed(3)})`;
    this.vignette.style.opacity = `${(snapshot.player.hitFlash * 0.55).toFixed(2)}`;
    this.root.dataset.state = snapshot.gameState;
  }
}
