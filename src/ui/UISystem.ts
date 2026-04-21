import type {
  GameStateType,
  PlayerState,
  RadarContact,
  RewardState,
  RideState,
  WeaponStatus,
} from '../core/types';
import { formatDistance } from '../core/utils';

type DriverPortraitMood = 'calm' | 'observing' | 'panic';

const DRIVER_PORTRAITS: Record<DriverPortraitMood, string> = {
  calm: '/ui/driver/calm.png',
  observing: '/ui/driver/observing.png',
  panic: '/ui/driver/panic.png',
};

const WEAPON_ART: Record<WeaponStatus['weaponType'], string> = {
  pistol: '/ui/weapons/pistol.png',
  shotgun: '/ui/weapons/shotgun.png',
  bazooka: '/ui/weapons/bazooka.png',
};

type HUDSnapshot = {
  gameState: GameStateType;
  player: PlayerState;
  weapon: WeaponStatus;
  reward: RewardState;
  ride: RideState | null;
  elapsedSeconds: number;
  radarContacts: RadarContact[];
};

type DriverPresentation = {
  key: string;
  mood: DriverPortraitMood;
  label: string;
  speaker: string;
  intent: string;
  showTimer: boolean;
  timerRatio: number;
  showControls: boolean;
  controlsLabel: string;
  persistSeconds: number;
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
  private readonly weaponIcon = document.createElement('img');
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
  private readonly segmentChip = document.createElement('div');
  private readonly eventChip = document.createElement('div');
  private readonly buffPanel = document.createElement('div');
  private readonly adrenalineBuff = document.createElement('div');
  private readonly nitroBuff = document.createElement('div');
  private readonly laneRequestHud = document.createElement('div');
  private readonly laneRequestLeft = document.createElement('div');
  private readonly laneRequestLeftRing = document.createElement('div');
  private readonly laneRequestLeftCore = document.createElement('div');
  private readonly laneRequestLeftKey = document.createElement('span');
  private readonly laneRequestRight = document.createElement('div');
  private readonly laneRequestRightRing = document.createElement('div');
  private readonly laneRequestRightCore = document.createElement('div');
  private readonly laneRequestRightKey = document.createElement('span');
  private readonly driverPanel = document.createElement('div');
  private readonly driverPortraitFrame = document.createElement('div');
  private readonly driverPortrait = document.createElement('img');
  private readonly driverPrompt = document.createElement('div');
  private readonly driverPromptSpeaker = document.createElement('div');
  private readonly driverPromptLabel = document.createElement('div');
  private readonly driverPromptTimer = document.createElement('div');
  private readonly driverPromptTimerFill = document.createElement('div');
  private readonly driverPromptControls = document.createElement('div');
  private readonly latchWarning = document.createElement('div');
  private readonly latchLabel = document.createElement('div');
  private readonly latchFill = document.createElement('div');
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
  private driverPanelHold = 0;
  private lastElapsedSeconds = 0;
  private lastDriverPresentation: DriverPresentation | null = null;
  private lastWeaponType: WeaponStatus['weaponType'] | null = null;
  private lastNitroTimer = 0;
  private tankWarningCooldown = 0;

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
    statsPanel.append(this.scoreValue, this.distanceValue, this.timerValue);
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
    this.weaponIcon.alt = 'Current weapon';
    this.weaponIcon.decoding = 'async';
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

    this.segmentChip.className = 'segment-chip';
    this.eventChip.className = 'event-chip';
    this.buffPanel.className = 'buff-panel';
    this.adrenalineBuff.className = 'buff-chip';
    this.nitroBuff.className = 'buff-chip';
    this.laneRequestHud.className = 'lane-request-hud';
    this.laneRequestLeft.className = 'lane-request lane-request--left';
    this.laneRequestLeftRing.className = 'lane-request-ring';
    this.laneRequestLeftCore.className = 'lane-request-core';
    this.laneRequestLeftKey.className = 'lane-request-key';
    this.laneRequestLeftKey.textContent = 'A';
    this.laneRequestLeftCore.append(this.laneRequestLeftKey);
    this.laneRequestLeftRing.append(this.laneRequestLeftCore);
    this.laneRequestLeft.append(this.laneRequestLeftRing);
    this.laneRequestRight.className = 'lane-request lane-request--right';
    this.laneRequestRightRing.className = 'lane-request-ring';
    this.laneRequestRightCore.className = 'lane-request-core';
    this.laneRequestRightKey.className = 'lane-request-key';
    this.laneRequestRightKey.textContent = 'D';
    this.laneRequestRightCore.append(this.laneRequestRightKey);
    this.laneRequestRightRing.append(this.laneRequestRightCore);
    this.laneRequestRight.append(this.laneRequestRightRing);
    this.laneRequestHud.append(this.laneRequestLeft, this.laneRequestRight);
    this.driverPanel.className = 'driver-panel';
    this.driverPortraitFrame.className = 'driver-portrait-frame';
    this.driverPortrait.className = 'driver-portrait';
    this.driverPortrait.alt = 'Driver portrait';
    this.driverPortrait.decoding = 'async';
    this.driverPrompt.className = 'driver-prompt';
    this.driverPromptSpeaker.className = 'driver-prompt-speaker';
    this.driverPromptSpeaker.textContent = 'Driver  Left Seat';
    this.driverPromptLabel.className = 'driver-prompt-label';
    this.driverPromptTimer.className = 'driver-prompt-timer';
    this.driverPromptTimerFill.className = 'driver-prompt-timer-fill';
    this.driverPromptControls.className = 'driver-prompt-controls';
    this.driverPromptTimer.append(this.driverPromptTimerFill);
    this.driverPrompt.append(
      this.driverPromptSpeaker,
      this.driverPromptLabel,
      this.driverPromptTimer,
      this.driverPromptControls,
    );
    this.driverPortraitFrame.append(this.driverPortrait);
    this.driverPanel.append(this.driverPortraitFrame, this.driverPrompt);

    this.latchWarning.className = 'latch-warning';
    this.latchLabel.className = 'latch-label';
    const latchBar = document.createElement('div');
    latchBar.className = 'latch-bar';
    this.latchFill.className = 'latch-fill';
    latchBar.append(this.latchFill);
    this.latchWarning.append(this.latchLabel, latchBar);

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
    this.buffPanel.append(this.adrenalineBuff, this.nitroBuff);
    this.segmentChip.hidden = true;
    hudMiddle.append(this.eventChip, this.buffPanel, statsPanel);
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
      this.laneRequestHud,
      this.driverPanel,
      this.latchWarning,
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
    if (gameState !== 'running') {
      this.driverPanelHold = 0;
      this.lastDriverPresentation = null;
      this.lastElapsedSeconds = 0;
    }

    switch (gameState) {
      case 'menu':
        this.overlay.hidden = false;
        this.overlayTitle.textContent = 'Dead Rush Sidecar';
        this.overlayText.textContent =
          'Ride shotgun in the apocalypse. Mouse aim, click to fire, hold A or D to ask for a lane shift, tap A/D to wiggle free from a latch, and react when your driver suddenly does something reckless.';
        this.overlayButton.textContent = 'Click To Start';
        break;
      case 'paused':
        this.overlay.hidden = false;
        this.overlayTitle.textContent = 'Paused';
        this.overlayText.textContent =
          'Pointer lock was released. Click back in to get behind the gun again.';
        this.overlayButton.textContent = 'Resume';
        break;
      case 'dead':
        this.overlay.hidden = false;
        this.overlayTitle.textContent = 'Wrecked';
        this.overlayText.textContent =
          'The sidecar came apart before you did. Restart and survive the driver longer.';
        this.overlayButton.textContent = 'Restart';
        break;
      case 'running':
      default:
        this.overlay.hidden = true;
        break;
    }
  }

  update(snapshot: HUDSnapshot): void {
    const deltaTime =
      snapshot.gameState === 'running' && snapshot.elapsedSeconds >= this.lastElapsedSeconds
        ? snapshot.elapsedSeconds - this.lastElapsedSeconds
        : 0;
    this.lastElapsedSeconds = snapshot.elapsedSeconds;
    this.tankWarningCooldown = Math.max(0, this.tankWarningCooldown - deltaTime);
    const healthRatio = Math.max(0, snapshot.player.health / snapshot.player.maxHealth);
    this.healthFill.style.transform = `scaleX(${healthRatio})`;
    this.healthValue.textContent = `${Math.ceil(snapshot.player.health)} / ${snapshot.player.maxHealth}`;
    const healthHue = Math.max(4, Math.round(healthRatio * 118));
    const healthColor = `hsl(${healthHue} 82% 50%)`;
    const healthAccent = `hsl(${Math.min(healthHue + 16, 128)} 78% 62%)`;
    this.healthFill.style.background = `linear-gradient(90deg, ${healthColor} 0%, ${healthAccent} 100%)`;
    this.healthFill.style.boxShadow = `0 0 22px hsla(${healthHue} 90% 56% / 0.42)`;
    this.healthState.textContent =
      snapshot.ride?.failureSeverity && snapshot.ride.failureSeverity >= 0.9
        ? 'Driver Panicking'
        : snapshot.ride?.failureSeverity && snapshot.ride.failureSeverity >= 0.45
          ? 'Driver Rattled'
          : healthRatio > 0.65
            ? 'Stable'
            : healthRatio > 0.3
              ? 'Shaken'
              : 'Near Death';
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
    this.weaponIcon.src = WEAPON_ART[snapshot.weapon.weaponType];
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

    this.eventChip.hidden = !snapshot.ride || snapshot.ride.activeEvent === 'none';
    this.eventChip.textContent = this.getEventLabel(snapshot.ride?.activeEvent ?? 'none');
    this.eventChip.dataset.event = snapshot.ride?.activeEvent ?? 'none';
    this.buffPanel.hidden = snapshot.player.nitroTimer <= 0;
    this.adrenalineBuff.hidden = true;
    this.nitroBuff.hidden = snapshot.player.nitroTimer <= 0;
    this.adrenalineBuff.textContent = '';
    this.nitroBuff.textContent =
      snapshot.player.nitroTimer > 0
        ? `Auto Accel ${(snapshot.player.nitroTimer).toFixed(1)}s`
        : '';
    const laneRequestActive =
      snapshot.gameState === 'running' && Boolean(snapshot.ride?.laneRequestActive);
    const laneRequestProgress = snapshot.ride?.laneRequestHoldRatio ?? 0;
    const laneRequestDirection = snapshot.ride?.laneRequestDirection ?? 0;
    this.laneRequestHud.hidden = !laneRequestActive;
    this.laneRequestLeft.hidden = !laneRequestActive || laneRequestDirection !== -1;
    this.laneRequestRight.hidden = !laneRequestActive || laneRequestDirection !== 1;
    this.laneRequestLeft.style.setProperty(
      '--lane-request-progress',
      laneRequestProgress.toFixed(3),
    );
    this.laneRequestRight.style.setProperty(
      '--lane-request-progress',
      laneRequestProgress.toFixed(3),
    );
    this.laneRequestLeft.dataset.complete =
      laneRequestProgress >= 0.999 && laneRequestDirection === -1 ? 'true' : 'false';
    this.laneRequestRight.dataset.complete =
      laneRequestProgress >= 0.999 && laneRequestDirection === 1 ? 'true' : 'false';

    const driverPresentation = this.resolveDriverPresentation(snapshot);
    if (snapshot.gameState !== 'running') {
      this.driverPanelHold = 0;
      this.lastDriverPresentation = null;
    } else if (driverPresentation) {
      this.lastDriverPresentation = driverPresentation;
      this.driverPanelHold = driverPresentation.persistSeconds;
    } else {
      this.driverPanelHold = Math.max(0, this.driverPanelHold - deltaTime);
      if (this.driverPanelHold <= 0) {
        this.lastDriverPresentation = null;
      }
    }

    const visibleDriverPresentation =
      driverPresentation ?? (this.driverPanelHold > 0 ? this.lastDriverPresentation : null);
    this.driverPanel.hidden = snapshot.gameState !== 'running';
    this.driverPanel.dataset.visible = visibleDriverPresentation ? 'true' : 'false';
    this.driverPanel.dataset.mood = visibleDriverPresentation?.mood ?? 'calm';
    this.driverPanel.dataset.prompt =
      visibleDriverPresentation?.showControls ? 'true' : 'false';
    this.driverPortrait.src = DRIVER_PORTRAITS[visibleDriverPresentation?.mood ?? 'calm'];
    this.driverPortrait.alt = `Driver ${visibleDriverPresentation?.mood ?? 'calm'}`;
    this.driverPrompt.hidden = false;
    this.driverPrompt.dataset.intent = visibleDriverPresentation?.intent ?? 'idle';
    this.driverPromptLabel.textContent = visibleDriverPresentation?.label ?? '';
    this.driverPromptSpeaker.textContent = visibleDriverPresentation?.speaker ?? '';
    this.driverPromptTimerFill.style.transform = `scaleX(${(
      visibleDriverPresentation?.timerRatio ?? 0
    ).toFixed(3)})`;
    this.driverPromptTimer.hidden = !visibleDriverPresentation?.showTimer;
    this.driverPromptControls.hidden = !visibleDriverPresentation?.showControls;
    this.driverPromptControls.textContent =
      visibleDriverPresentation?.controlsLabel ?? '';

    this.latchWarning.hidden = !snapshot.ride?.latchActive;
    if (snapshot.ride?.latchActive) {
      this.latchLabel.textContent = 'Runner latched - shoot or wiggle A/D';
      this.latchFill.style.transform = `scaleX(${snapshot.ride.latchWiggleRatio.toFixed(3)})`;
    }

    this.radarPanel.style.opacity = `${snapshot.ride?.radarStrength ?? 1}`;
    for (let index = 0; index < this.radarDots.length; index += 1) {
      const dot = this.radarDots[index];
      const contact = snapshot.radarContacts[index];
      if (!contact) {
        dot.hidden = true;
        continue;
      }

      dot.hidden = false;
      dot.style.left = `${50 + contact.offset * 46}%`;
      dot.style.opacity = `${(0.3 + contact.proximity * 0.7).toFixed(2)}`;
      dot.style.transform = `translate(-50%, -50%) scale(${(
        0.82 + contact.proximity * 0.55
      ).toFixed(3)})`;
      dot.dataset.type = contact.type;
    }

    this.crosshair.dataset.hit = snapshot.weapon.hitConfirm > 0 ? 'true' : 'false';
    this.crosshair.dataset.style = snapshot.weapon.crosshairStyle;
    this.crosshair.dataset.latched = snapshot.ride?.latchActive ? 'true' : 'false';
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
    const shakeScale = snapshot.ride
      ? 1 + snapshot.ride.aimShake * 0.45 + snapshot.ride.failureSeverity * 0.08
      : 1;
    this.crosshair.style.transform = `translate(-50%, -50%) scale(${(
      (1 + snapshot.weapon.crosshairKick * (snapshot.weapon.crosshairStyle === 'shotgun' ? 0.04 : 0.022)) *
      shakeScale
    ).toFixed(3)})`;
    const vignetteStrength =
      snapshot.player.hitFlash * 0.55 +
      (snapshot.ride?.failureSeverity ?? 0) * 0.28 +
      (snapshot.ride?.latchActive ? 0.12 : 0);
    this.vignette.style.opacity = `${Math.min(1, vignetteStrength).toFixed(2)}`;
    this.root.dataset.state = snapshot.gameState;
    this.root.dataset.segment = snapshot.ride?.segment ?? 'rest';
    this.root.dataset.failure =
      snapshot.ride && snapshot.ride.failureSeverity >= 0.9
        ? 'critical'
        : snapshot.ride && snapshot.ride.failureSeverity >= 0.45
          ? 'warning'
          : 'stable';
    this.lastWeaponType = snapshot.weapon.weaponType;
    this.lastNitroTimer = snapshot.player.nitroTimer;
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

  private resolveDriverMood(snapshot: HUDSnapshot): DriverPortraitMood {
    if (
      snapshot.ride?.latchActive ||
      (snapshot.ride?.failureSeverity ?? 0) >= 0.45 ||
      snapshot.ride?.activeEvent === 'berserkWave' ||
      snapshot.ride?.prompt?.intent === 'engineTrouble'
    ) {
      return 'panic';
    }

    if (
      snapshot.ride?.segment === 'dark' ||
      snapshot.ride?.activeEvent === 'blackoutStretch' ||
      snapshot.ride?.prompt?.intent === 'floorIt' ||
      snapshot.ride?.prompt?.intent === 'brake' ||
      snapshot.radarContacts.length >= 4
    ) {
      return 'observing';
    }

    return 'calm';
  }

  private resolveDriverPresentation(snapshot: HUDSnapshot): DriverPresentation | null {
    const prompt = snapshot.ride?.prompt;
    if (prompt) {
      const mood =
        prompt.intent === 'floorIt' || prompt.intent === 'brake'
          ? 'observing'
          : prompt.intent === 'engineTrouble'
            ? 'panic'
            : this.resolveDriverMood(snapshot);
      const speaker =
        prompt.intent === 'floorIt'
          ? 'Driver  Grinning'
          : prompt.intent === 'brake'
            ? 'Driver  Measuring'
            : prompt.intent === 'engineTrouble'
              ? 'Driver  Wincing'
              : mood === 'panic'
                ? 'Driver  Losing It'
                : 'Driver  Calling It';
      return {
        key: `prompt:${prompt.intent}:${prompt.label}`,
        mood,
        label: prompt.label,
        speaker,
        intent: prompt.intent,
        showTimer: true,
        timerRatio: prompt.duration > 0 ? prompt.timer / prompt.duration : 0,
        showControls: true,
        controlsLabel: '',
        persistSeconds: 0.12,
      };
    }

    const supportCue = snapshot.ride?.supportCue;
    if (supportCue) {
      const mood =
        supportCue.intent === 'laneRequestWrong'
          ? 'panic'
          : supportCue.intent === 'laneRequestDenied'
            ? 'observing'
            : 'calm';
      const speaker =
        supportCue.intent === 'laneRequestWrong'
          ? 'Driver  Misreading Destiny'
          : supportCue.intent === 'laneRequestDenied'
            ? 'Driver  Dryly Refusing'
            : 'Driver  On Codec';
      return {
        key: `support:${supportCue.intent}:${supportCue.label}`,
        mood,
        label: supportCue.label,
        speaker,
        intent: supportCue.intent,
        showTimer: false,
        timerRatio: supportCue.duration > 0 ? supportCue.timer / supportCue.duration : 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.12,
      };
    }

    if (snapshot.ride?.floorItMode) {
      return {
        key: 'event:floor-it',
        mood: 'observing',
        label: 'Speed is now our legal defense. Shoot anything that objects.',
        speaker: 'Driver  Recklessly Calm',
        intent: 'floorIt',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.8,
      };
    }

    if (snapshot.ride?.brakeMode) {
      return {
        key: 'event:brake',
        mood: 'observing',
        label: "I'm not stopping. I'm editing our speed downward.",
        speaker: 'Driver  Technical Monologue',
        intent: 'brake',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.8,
      };
    }

    if (snapshot.ride?.engineTroubleMode) {
      return {
        key: 'event:engine-trouble',
        mood: 'panic',
        label: 'The engine is making a statement. I reject its politics.',
        speaker: 'Driver  Existentially Busy',
        intent: 'engineTrouble',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.85,
      };
    }

    if (snapshot.ride?.latchActive) {
      return {
        key: 'event:latch',
        mood: 'panic',
        label: 'Lower. Sidecar level. Return that idiot to the asphalt.',
        speaker: 'Driver  Alarmingly Specific',
        intent: 'latch',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.45,
      };
    }

    if (snapshot.ride?.activeEvent === 'berserkWave') {
      return {
        key: 'event:berserk',
        mood: 'panic',
        label: "They've entered their dramatic phase. Thin the cast.",
        speaker: 'Driver  Bad Feeling',
        intent: 'event',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.75,
      };
    }

    if (snapshot.ride?.activeEvent === 'slipperyRoad') {
      return {
        key: 'event:slippery',
        mood: 'observing',
        label: 'The road has betrayed us. Expect elegance to drop sharply.',
        speaker: 'Driver  Unimpressed',
        intent: 'event',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.75,
      };
    }

    if (snapshot.ride?.activeEvent === 'blackoutStretch') {
      return {
        key: 'event:blackout',
        mood: 'observing',
        label: 'Night has become ambitious. Watch the edges.',
        speaker: 'Driver  Squinting At Fate',
        intent: 'event',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.75,
      };
    }

    const failureSeverity = snapshot.ride?.failureSeverity ?? 0;
    if (failureSeverity >= 0.82) {
      return {
        key: 'event:critical-failure',
        mood: 'panic',
        label: 'The bike is writing its will. Clear me a lane.',
        speaker: 'Driver  Speaking To Machinery',
        intent: 'critical',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 1.05,
      };
    }

    if (failureSeverity >= 0.48) {
      return {
        key: 'event:warning-failure',
        mood: 'panic',
        label: 'We are one bad decision away from slapstick.',
        speaker: 'Driver  Pretending Calm',
        intent: 'warning',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 0.85,
      };
    }

    if (this.lastNitroTimer <= 0.1 && snapshot.player.nitroTimer > 0.1) {
      return {
        key: 'pickup:nitro',
        mood: 'observing',
        label: 'Auto accelerator. It shoves us forward while I pretend this was planned.',
        speaker: 'Driver  Explaining Badly',
        intent: 'pickup',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 1.35,
      };
    }

    if (
      this.lastWeaponType &&
      this.lastWeaponType !== snapshot.weapon.weaponType &&
      snapshot.weapon.weaponType === 'shotgun'
    ) {
      return {
        key: 'pickup:shotgun',
        mood: 'calm',
        label: 'Shotgun. For intimate negotiations and sidecar emergencies.',
        speaker: 'Driver  Quartermaster Theater',
        intent: 'pickup',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 1.45,
      };
    }

    if (
      this.lastWeaponType &&
      this.lastWeaponType !== snapshot.weapon.weaponType &&
      snapshot.weapon.weaponType === 'bazooka'
    ) {
      return {
        key: 'pickup:bazooka',
        mood: 'observing',
        label: 'Bazooka. For when subtlety has failed the republic.',
        speaker: 'Driver  Quartermaster Theater',
        intent: 'pickup',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 1.5,
      };
    }

    if (
      snapshot.elapsedSeconds >= 54 &&
      snapshot.radarContacts.some((contact) => contact.type === 'tank') &&
      this.tankWarningCooldown <= 0
    ) {
      this.tankWarningCooldown = 6.5;
      return {
        key: `warning:tank:${Math.floor(snapshot.elapsedSeconds)}`,
        mood: 'panic',
        label: 'Tank zombie ahead. That one does not respect optimism.',
        speaker: 'Driver  Grim Forecast',
        intent: 'warning',
        showTimer: false,
        timerRatio: 0,
        showControls: false,
        controlsLabel: '',
        persistSeconds: 1.25,
      };
    }

    return null;
  }

  private getEventLabel(eventType: RideState['activeEvent']): string {
    if (eventType === 'berserkWave') {
      return 'BERSERK WAVE';
    }
    if (eventType === 'slipperyRoad') {
      return 'SLIPPERY ROAD';
    }
    if (eventType === 'blackoutStretch') {
      return 'BLACKOUT';
    }
    return '';
  }

}
