import type {
  GameStateType,
  PlayerState,
  RadarContact,
  RewardState,
  WeaponStatus,
} from '../core/types';
import { formatDistance } from '../core/utils';

type HUDSnapshot = {
  gameState: GameStateType;
  player: PlayerState;
  weapon: WeaponStatus;
  reward: RewardState;
  elapsedSeconds: number;
  radarContacts: RadarContact[];
};

export class UISystem {
  onPrimaryAction?: () => void;

  private readonly root = document.createElement('div');
  private readonly overlay = document.createElement('div');
  private readonly overlayTitle = document.createElement('h1');
  private readonly overlayText = document.createElement('p');
  private readonly overlayMeta = document.createElement('div');
  private readonly overlayBreakdown = document.createElement('div');
  private readonly overlayButton = document.createElement('button');
  private readonly rewardHud = document.createElement('div');
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
  private readonly multiplierValue = document.createElement('span');
  private readonly chainPanel = document.createElement('div');
  private readonly chainFill = document.createElement('div');
  private readonly chainLabel = document.createElement('span');
  private readonly distanceValue = document.createElement('span');
  private readonly timerValue = document.createElement('span');
  private readonly rewardCallout = document.createElement('div');
  private readonly radarPanel = document.createElement('div');
  private readonly radarTrack = document.createElement('div');
  private readonly radarContactLayer = document.createElement('div');
  private readonly radarCaret = document.createElement('div');
  private readonly crosshair = document.createElement('div');
  private readonly crosshairLeft = document.createElement('span');
  private readonly crosshairRight = document.createElement('span');
  private readonly crosshairTop = document.createElement('span');
  private readonly crosshairBottom = document.createElement('span');
  private readonly crosshairDot = document.createElement('span');
  private readonly crosshairBracketLeft = document.createElement('span');
  private readonly crosshairBracketRight = document.createElement('span');
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

    this.rewardHud.className = 'reward-hud';
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
    this.multiplierValue.className = 'stat-chip stat-chip--reward';
    this.distanceValue.className = 'stat-chip';
    this.timerValue.className = 'stat-chip';
    statsPanel.append(
      this.scoreValue,
      this.distanceValue,
      this.timerValue,
    );
    this.chainPanel.className = 'chain-panel';
    this.chainFill.className = 'chain-fill';
    this.chainLabel.className = 'chain-label';
    this.chainPanel.append(this.chainFill, this.chainLabel);
    this.rewardHud.append(this.multiplierValue, this.chainPanel);

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
    this.rewardCallout.className = 'reward-callout';

    hudTop.append(this.rewardHud, this.radarPanel);
    hudMiddle.append(statsPanel);
    hudBottom.append(leftPanel, this.ammoPanel);
    hud.append(hudTop, hudMiddle, hudBottom);

    this.crosshair.className = 'crosshair';
    this.crosshairLeft.className = 'crosshair-line crosshair-line--left';
    this.crosshairRight.className = 'crosshair-line crosshair-line--right';
    this.crosshairTop.className = 'crosshair-line crosshair-line--top';
    this.crosshairBottom.className = 'crosshair-line crosshair-line--bottom';
    this.crosshairDot.className = 'crosshair-dot';
    this.crosshairBracketLeft.className = 'crosshair-bracket crosshair-bracket--left';
    this.crosshairBracketRight.className = 'crosshair-bracket crosshair-bracket--right';
    this.crosshair.append(
      this.crosshairLeft,
      this.crosshairRight,
      this.crosshairTop,
      this.crosshairBottom,
      this.crosshairDot,
      this.crosshairBracketLeft,
      this.crosshairBracketRight,
    );
    this.vignette.className = 'damage-vignette';

    this.overlay.className = 'overlay';
    this.overlayTitle.className = 'overlay-title';
    this.overlayText.className = 'overlay-text';
    this.overlayMeta.className = 'overlay-meta';
    this.overlayBreakdown.className = 'overlay-breakdown';
    this.overlayButton.className = 'overlay-button';
    this.overlayButton.addEventListener('click', () => {
      this.onPrimaryAction?.();
    });

    this.overlay.append(
      this.overlayTitle,
      this.overlayText,
      this.overlayMeta,
      this.overlayBreakdown,
      this.overlayButton,
    );
    this.root.append(
      hud,
      this.rewardCallout,
      this.reloadHint,
      this.crosshair,
      this.vignette,
      this.overlay,
    );
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
    this.ammoPanel.style.setProperty(
      '--ammo-columns',
      `${Math.min(6, Math.max(1, snapshot.weapon.magazineSize))}`,
    );

    for (let index = 0; index < this.ammoRounds.length; index += 1) {
      const round = this.ammoRounds[index];
      round.hidden = index >= snapshot.weapon.magazineSize;
      round.dataset.loaded = index < snapshot.weapon.ammoInMagazine ? 'true' : 'false';
      round.dataset.state = ammoState;
      round.dataset.shape = snapshot.weapon.roundStyle;
    }

    this.reloadHint.hidden = !snapshot.weapon.showReloadHint;

    this.scoreValue.textContent = `Score ${snapshot.player.score}`;
    this.multiplierValue.textContent = `Chain x${snapshot.reward.multiplier.toFixed(2)}`;
    this.multiplierValue.dataset.active = snapshot.reward.chainCount > 1 ? 'true' : 'false';
    this.chainPanel.dataset.active = snapshot.reward.chainCount > 0 ? 'true' : 'false';
    this.chainFill.style.transform = `scaleX(${snapshot.reward.chainTimerRatio.toFixed(3)})`;
    this.chainLabel.textContent =
      snapshot.reward.chainCount > 0
        ? `${snapshot.reward.chainCount} HIT CHAIN`
        : 'Chain Ready';
    this.distanceValue.textContent = `Distance ${formatDistance(snapshot.player.distance)}`;
    this.timerValue.textContent = `Time ${snapshot.elapsedSeconds.toFixed(1)}s`;
    this.rewardCallout.textContent = snapshot.reward.recentCallout;
    this.rewardCallout.dataset.visible =
      snapshot.reward.recentCalloutTimer > 0 && snapshot.reward.recentCallout !== ''
        ? 'true'
        : 'false';

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
    this.crosshair.dataset.style = snapshot.weapon.crosshairStyle;
    this.crosshair.style.setProperty(
      '--crosshair-gap',
      `${snapshot.weapon.crosshairGap.toFixed(2)}px`,
    );
    this.crosshair.style.setProperty(
      '--crosshair-arm-length',
      `${(
        snapshot.weapon.crosshairStyle === 'shotgun'
          ? 0
          : snapshot.weapon.crosshairStyle === 'bazooka'
            ? 11 + snapshot.weapon.crosshairKick * 1.8
            : 7.5 + snapshot.weapon.crosshairKick * 1.3
      ).toFixed(2)}px`,
    );
    this.crosshair.style.setProperty(
      '--crosshair-bracket-width',
      `${(8 + snapshot.weapon.crosshairGap * 0.16).toFixed(2)}px`,
    );
    this.crosshair.style.setProperty(
      '--crosshair-bracket-height',
      `${(18 + snapshot.weapon.crosshairGap * 0.7).toFixed(2)}px`,
    );
    this.crosshair.style.transform = `translate(-50%, -50%) scale(${(
      1 + snapshot.weapon.crosshairKick * (snapshot.weapon.crosshairStyle === 'shotgun' ? 0.04 : 0.022)
    ).toFixed(3)})`;
    this.vignette.style.opacity = `${(snapshot.player.hitFlash * 0.55).toFixed(2)}`;
    this.root.dataset.state = snapshot.gameState;
    this.updateOverlay(snapshot);
  }

  private updateOverlay(snapshot: HUDSnapshot): void {
    if (snapshot.gameState === 'dead') {
      this.overlayMeta.textContent =
        `Score ${snapshot.player.score}\n` +
        `Run Best Chain ${snapshot.reward.bestChain}\n` +
        `Best Score ${snapshot.reward.bestScore}\n` +
        `Best Chain ${snapshot.reward.bestChainRecord}`;
      this.overlayBreakdown.textContent =
        `Combo Bonus +${snapshot.reward.comboBonusTotal}\n` +
        `Milestone Bonus +${snapshot.reward.milestoneBonusTotal}\n` +
        `Explosive Bonus +${snapshot.reward.explosiveBonusTotal}`;
      this.overlayBreakdown.hidden = false;
      return;
    }

    if (snapshot.gameState === 'menu') {
      this.overlayMeta.textContent =
        `Best Score ${snapshot.reward.bestScore}\n` +
        `Best Chain ${snapshot.reward.bestChainRecord}\n` +
        `Last Run ${snapshot.reward.lastRunScore}`;
      this.overlayBreakdown.hidden = true;
      this.overlayBreakdown.textContent = '';
      return;
    }

    this.overlayMeta.textContent = '';
    this.overlayBreakdown.hidden = true;
    this.overlayBreakdown.textContent = '';
  }
}
