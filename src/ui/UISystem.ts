import type {
  GameStateType,
  PlayerState,
  RadarContact,
  RewardState,
  RideState,
  WeaponStatus,
} from '../core/types';
import { formatDistance } from '../core/utils';
import { SoundEffectPool } from '../game/audio/SoundEffectPool';

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

const MENU_LOGO = '/ui/menu/logo-game.png';

const PAUSE_SUBHEADINGS = [
  'The driver is pretending this pause was tactical.',
  'Everybody breathe. Even the ones trying to eat us.',
  'Pointer lock escaped first. Typical.',
  'Tiny intermission before the next poor decision.',
];

const DEATH_SUBHEADINGS = [
  'The road finally cashed the check.',
  'That run had excellent intentions and terrible luck.',
  'Heroic posture. Catastrophic outcome.',
  'You survived the driver for a while. That still counts.',
];

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

type AudioPreferenceState = {
  sfxEnabled: boolean;
  musicEnabled: boolean;
};

type DeathCausePresentation = {
  title: string;
  body: string;
};

export class UISystem {
  onPrimaryAction?: () => void;
  onRestartAction?: () => void;
  onSfxPreferenceChange?: (enabled: boolean) => void;
  onMusicPreferenceChange?: (enabled: boolean) => void;
  onMobileLaneHoldChange?: (direction: -1 | 1, active: boolean) => void;
  onMobileReload?: () => void;
  onMobileFireHeldChange?: (active: boolean) => void;

  private readonly root = document.createElement('div');
  private readonly overlay = document.createElement('div');
  private readonly overlayTitle = document.createElement('h1');
  private readonly overlayText = document.createElement('p');
  private readonly overlayMeta = document.createElement('div');
  private readonly overlayBreakdown = document.createElement('div');
  private readonly overlayButton = document.createElement('button');
  private readonly overlayMenu = document.createElement('div');
  private readonly overlayMenuLogo = document.createElement('img');
  private readonly overlayMenuStartButton = document.createElement('button');
  private readonly overlayMenuCopy = document.createElement('p');
  private readonly overlayMenuStats = document.createElement('div');
  private readonly overlayMenuSfxToggle = document.createElement('button');
  private readonly overlayMenuMusicToggle = document.createElement('button');
  private readonly overlayStateSfxToggle = document.createElement('button');
  private readonly overlayStateMusicToggle = document.createElement('button');
  private readonly overlayDialog = document.createElement('div');
  private readonly overlayState = document.createElement('div');
  private readonly overlayStateLeft = document.createElement('div');
  private readonly overlayStateRight = document.createElement('div');
  private readonly overlayStateLogo = document.createElement('img');
  private readonly overlayStateTitle = document.createElement('h2');
  private readonly overlayStateSubtitle = document.createElement('p');
  private readonly overlayStateActions = document.createElement('div');
  private readonly overlayStatePrimaryButton = document.createElement('button');
  private readonly overlayStateSecondaryButton = document.createElement('button');
  private readonly overlayStateHint = document.createElement('div');
  private readonly overlayStateControlsPanel = document.createElement('section');
  private readonly overlayStateSummaryPanel = document.createElement('section');
  private readonly overlayStateCausePanel = document.createElement('section');
  private readonly overlayStateScoreValue = document.createElement('span');
  private readonly overlayStateDistanceValue = document.createElement('span');
  private readonly overlayStateTimeValue = document.createElement('span');
  private readonly overlayStateBestChainValue = document.createElement('span');
  private readonly overlayStateKillsValue = document.createElement('span');
  private readonly overlayStateCauseTitle = document.createElement('div');
  private readonly overlayStateCauseBody = document.createElement('div');
  private readonly rewardHud = document.createElement('div');
  private readonly statsPanel = document.createElement('div');
  private readonly healthFill = document.createElement('div');
  private readonly healthValue = document.createElement('span');
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
  private readonly accoladeBanner = document.createElement('div');
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
  private readonly laneRequestLeftLabel = document.createElement('div');
  private readonly laneRequestLeftRing = document.createElement('div');
  private readonly laneRequestLeftCore = document.createElement('div');
  private readonly laneRequestLeftKey = document.createElement('span');
  private readonly laneRequestRight = document.createElement('div');
  private readonly laneRequestRightLabel = document.createElement('div');
  private readonly laneRequestRightRing = document.createElement('div');
  private readonly laneRequestRightCore = document.createElement('div');
  private readonly laneRequestRightKey = document.createElement('span');
  private readonly mobileControls = document.createElement('div');
  private readonly mobileControlsLeft = document.createElement('div');
  private readonly mobileControlsRight = document.createElement('div');
  private readonly mobileLeftButton = document.createElement('button');
  private readonly mobileRightButton = document.createElement('button');
  private readonly mobileReloadButton = document.createElement('button');
  private readonly mobileFireButton = document.createElement('button');
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
  private readonly latchKeys = document.createElement('div');
  private readonly latchKeysPrompt = document.createElement('div');
  private readonly latchKeysRow = document.createElement('div');
  private readonly latchKeyA = document.createElement('span');
  private readonly latchKeyD = document.createElement('span');
  private readonly crosshair = document.createElement('div');
  private readonly crosshairLeft = document.createElement('span');
  private readonly crosshairRight = document.createElement('span');
  private readonly crosshairTop = document.createElement('span');
  private readonly crosshairBottom = document.createElement('span');
  private readonly crosshairDot = document.createElement('span');
  private readonly crosshairBracketLeft = document.createElement('span');
  private readonly crosshairBracketRight = document.createElement('span');
  private readonly vignette = document.createElement('div');
  private readonly driverDialogSound = new SoundEffectPool('/audio/ui/dialog-beep.ogg', {
    poolSize: 2,
    volume: 0.06,
    playbackRate: 1.12,
  });
  private readonly ammoRounds: HTMLSpanElement[] = [];
  private readonly radarDots: HTMLSpanElement[] = [];
  private audioPreferences: AudioPreferenceState = {
    sfxEnabled: true,
    musicEnabled: true,
  };
  private pauseSubtitle = PAUSE_SUBHEADINGS[0];
  private deathSubtitle = DEATH_SUBHEADINGS[0];
  private driverPanelHold = 0;
  private lastElapsedSeconds = 0;
  private lastDriverPresentation: DriverPresentation | null = null;
  private lastVisibleDriverPresentationKey: string | null = null;
  private lastWeaponType: WeaponStatus['weaponType'] | null = null;
  private lastNitroTimer = 0;
  private tankWarningCooldown = 0;
  private mobileControlsEnabled = false;

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

    this.statsPanel.className = 'stats-panel stats-panel--side';
    this.scoreValue.className = 'stat-value';
    this.multiplierValue.className = 'stat-chip stat-chip--reward';
    this.distanceValue.className = 'stat-value';
    this.timerValue.className = 'stat-value';
    this.statsPanel.append(
      this.createStatChip('score', 'Score', this.scoreValue),
      this.createStatChip('distance', 'Distance', this.distanceValue),
      this.createStatChip('time', 'Time', this.timerValue),
    );
    this.chainPanel.className = 'chain-panel';
    this.chainFill.className = 'chain-fill';
    this.chainLabel.className = 'chain-label';
    this.chainPanel.append(this.chainFill, this.chainLabel);
    this.rewardHud.append(this.multiplierValue, this.chainPanel);

    const leftPanel = document.createElement('div');
    leftPanel.className = 'hud-panel hud-panel--health';

    const healthHeader = document.createElement('div');
    healthHeader.className = 'health-header';
    this.healthValue.className = 'panel-value';
    healthHeader.append(this.healthValue);

    const healthBar = document.createElement('div');
    healthBar.className = 'health-bar';
    this.healthFill.className = 'health-fill';
    healthBar.append(this.healthFill);
    leftPanel.append(healthHeader, healthBar);

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
    this.adrenalineBuff.dataset.buff = 'adrenaline';
    this.nitroBuff.className = 'buff-chip';
    this.nitroBuff.dataset.buff = 'nitro';
    this.laneRequestHud.className = 'lane-request-hud';
    this.laneRequestLeft.className = 'lane-request lane-request--left';
    this.laneRequestLeftLabel.className = 'lane-request-label';
    this.laneRequestLeftLabel.textContent = '<<< Call Left Lane';
    this.laneRequestLeftRing.className = 'lane-request-ring';
    this.laneRequestLeftCore.className = 'lane-request-core';
    this.laneRequestLeftKey.className = 'lane-request-key';
    this.laneRequestLeftKey.textContent = 'A';
    this.laneRequestLeftCore.append(this.laneRequestLeftKey);
    this.laneRequestLeftRing.append(this.laneRequestLeftCore);
    this.laneRequestLeft.append(this.laneRequestLeftLabel, this.laneRequestLeftRing);
    this.laneRequestRight.className = 'lane-request lane-request--right';
    this.laneRequestRightLabel.className = 'lane-request-label';
    this.laneRequestRightLabel.textContent = 'Call Right Lane >>>';
    this.laneRequestRightRing.className = 'lane-request-ring';
    this.laneRequestRightCore.className = 'lane-request-core';
    this.laneRequestRightKey.className = 'lane-request-key';
    this.laneRequestRightKey.textContent = 'D';
    this.laneRequestRightCore.append(this.laneRequestRightKey);
    this.laneRequestRightRing.append(this.laneRequestRightCore);
    this.laneRequestRight.append(this.laneRequestRightLabel, this.laneRequestRightRing);
    this.laneRequestHud.append(this.laneRequestLeft, this.laneRequestRight);
    this.mobileControls.className = 'mobile-controls';
    this.mobileControlsLeft.className = 'mobile-controls-group mobile-controls-group--left';
    this.mobileControlsRight.className = 'mobile-controls-group mobile-controls-group--right';
    this.mobileLeftButton.className = 'mobile-control mobile-control--lane';
    this.mobileLeftButton.type = 'button';
    this.mobileLeftButton.dataset.touchControl = 'true';
    this.mobileLeftButton.textContent = 'LEFT';
    this.mobileRightButton.className = 'mobile-control mobile-control--lane';
    this.mobileRightButton.type = 'button';
    this.mobileRightButton.dataset.touchControl = 'true';
    this.mobileRightButton.textContent = 'RIGHT';
    this.mobileReloadButton.className = 'mobile-control mobile-control--reload';
    this.mobileReloadButton.type = 'button';
    this.mobileReloadButton.dataset.touchControl = 'true';
    this.mobileReloadButton.textContent = 'RELOAD';
    this.mobileFireButton.className = 'mobile-control mobile-control--fire';
    this.mobileFireButton.type = 'button';
    this.mobileFireButton.dataset.touchControl = 'true';
    this.mobileFireButton.textContent = 'SHOOT';
    this.bindHoldControl(this.mobileLeftButton, (active) => {
      this.onMobileLaneHoldChange?.(-1, active);
    });
    this.bindHoldControl(this.mobileRightButton, (active) => {
      this.onMobileLaneHoldChange?.(1, active);
    });
    this.bindHoldControl(this.mobileFireButton, (active) => {
      this.onMobileFireHeldChange?.(active);
    });
    this.mobileReloadButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.mobileReloadButton.dataset.active = 'true';
      this.mobileReloadButton.setPointerCapture?.(event.pointerId);
      this.onMobileReload?.();
    });
    this.mobileReloadButton.addEventListener('pointerup', () => {
      this.mobileReloadButton.dataset.active = 'false';
    });
    this.mobileReloadButton.addEventListener('pointercancel', () => {
      this.mobileReloadButton.dataset.active = 'false';
    });
    this.mobileReloadButton.addEventListener('lostpointercapture', () => {
      this.mobileReloadButton.dataset.active = 'false';
    });
    this.mobileControlsLeft.append(this.mobileLeftButton, this.mobileRightButton);
    this.mobileControlsRight.append(this.mobileReloadButton, this.mobileFireButton);
    this.mobileControls.append(this.mobileControlsLeft, this.mobileControlsRight);
    this.driverPanel.className = 'driver-panel';
    this.driverPortraitFrame.className = 'driver-portrait-frame';
    this.driverPortrait.className = 'driver-portrait';
    this.driverPortrait.alt = 'Driver portrait';
    this.driverPortrait.decoding = 'async';
    this.driverPrompt.className = 'driver-prompt';
    this.driverPromptSpeaker.className = 'driver-prompt-speaker';
    this.driverPromptSpeaker.hidden = true;
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
    this.latchKeys.className = 'latch-keys';
    this.latchKeysPrompt.className = 'latch-keys-prompt';
    this.latchKeysPrompt.textContent = 'Tap fast to shake it loose';
    this.latchKeysRow.className = 'latch-keys-row';
    this.latchKeyA.className = 'latch-key';
    this.latchKeyA.textContent = 'A';
    this.latchKeyD.className = 'latch-key';
    this.latchKeyD.textContent = 'D';
    this.latchKeysRow.append(this.latchKeyA, this.latchKeyD);
    this.latchKeys.append(this.latchKeysPrompt, this.latchKeysRow);
    this.latchWarning.append(this.latchLabel, latchBar, this.latchKeys);

    this.reloadHint.className = 'reload-hint';
    this.reloadHintTextBefore.className = 'reload-hint-text';
    this.reloadHintTextBefore.textContent = 'Press';
    this.reloadKey.className = 'reload-key';
    this.reloadKey.textContent = 'R';
    this.reloadLabel.className = 'reload-label';
    this.reloadLabel.textContent = 'to reload';
    this.reloadHint.append(this.reloadHintTextBefore, this.reloadKey, this.reloadLabel);
    this.rewardCallout.className = 'reward-callout';
    this.accoladeBanner.className = 'accolade-banner';

    hudTop.append(this.rewardHud, this.radarPanel, this.statsPanel);
    this.buffPanel.append(this.adrenalineBuff, this.nitroBuff);
    this.segmentChip.hidden = true;
    hudMiddle.append(this.eventChip, this.buffPanel);
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
    this.overlayMenu.className = 'overlay-menu';
    this.overlayDialog.className = 'overlay-dialog';
    this.overlayState.className = 'overlay-state';
    this.overlayStateLeft.className = 'overlay-state-left';
    this.overlayStateRight.className = 'overlay-state-right';
    this.overlayTitle.className = 'overlay-title';
    this.overlayText.className = 'overlay-text';
    this.overlayMeta.className = 'overlay-meta';
    this.overlayBreakdown.className = 'overlay-breakdown';
    this.overlayButton.className = 'overlay-button';
    this.overlayStateLogo.className = 'overlay-state-logo';
    this.overlayStateLogo.src = MENU_LOGO;
    this.overlayStateLogo.alt = 'Sidecar of the Dead';
    this.overlayStateLogo.decoding = 'async';
    this.overlayStateTitle.className = 'overlay-state-title';
    this.overlayStateSubtitle.className = 'overlay-state-subtitle';
    this.overlayStateActions.className = 'overlay-state-actions';
    this.overlayStatePrimaryButton.className = 'overlay-state-button overlay-state-button--primary';
    this.overlayStatePrimaryButton.type = 'button';
    this.overlayStateSecondaryButton.className =
      'overlay-state-button overlay-state-button--secondary';
    this.overlayStateSecondaryButton.type = 'button';
    this.overlayStateHint.className = 'overlay-state-hint';
    this.overlayStateControlsPanel.className = 'overlay-state-panel overlay-state-panel--controls';
    this.overlayStateSummaryPanel.className = 'overlay-state-panel overlay-state-panel--summary';
    this.overlayStateCausePanel.className = 'overlay-state-panel overlay-state-panel--cause';
    this.overlayStateCauseTitle.className = 'overlay-state-cause-title';
    this.overlayStateCauseBody.className = 'overlay-state-cause-body';
    this.overlayMenuLogo.className = 'overlay-menu-logo';
    this.overlayMenuLogo.src = MENU_LOGO;
    this.overlayMenuLogo.alt = 'Sidecar of the Dead';
    this.overlayMenuLogo.decoding = 'async';
    this.overlayMenuStartButton.className = 'overlay-menu-start';
    this.overlayMenuStartButton.type = 'button';
    this.overlayMenuStartButton.textContent = 'Start Run';
    this.overlayMenuCopy.className = 'overlay-menu-copy';
    this.overlayMenuCopy.textContent =
      'Built roughly 90% with AI tools: Cursor + Codex for code, Nano Banana for image iteration, ElevenLabs for voices and SFX passes, plus Gemini-assisted music and prompt workflow.';
    this.overlayMenuStats.className = 'overlay-menu-stats';
    this.overlayMenuSfxToggle.className = 'overlay-menu-toggle';
    this.overlayMenuSfxToggle.type = 'button';
    this.overlayMenuMusicToggle.className = 'overlay-menu-toggle';
    this.overlayMenuMusicToggle.type = 'button';
    this.overlayStateSfxToggle.className = 'overlay-menu-toggle';
    this.overlayStateSfxToggle.type = 'button';
    this.overlayStateMusicToggle.className = 'overlay-menu-toggle';
    this.overlayStateMusicToggle.type = 'button';
    this.overlayButton.addEventListener('click', () => {
      this.onPrimaryAction?.();
    });
    this.overlayStatePrimaryButton.addEventListener('click', () => {
      this.onPrimaryAction?.();
    });
    this.overlayStateSecondaryButton.addEventListener('click', () => {
      this.onRestartAction?.();
    });
    this.overlayMenuStartButton.addEventListener('click', () => {
      this.onPrimaryAction?.();
    });
    this.overlayMenuSfxToggle.addEventListener('click', () => {
      this.toggleSfxPreference();
    });
    this.overlayMenuMusicToggle.addEventListener('click', () => {
      this.toggleMusicPreference();
    });
    this.overlayStateSfxToggle.addEventListener('click', () => {
      this.toggleSfxPreference();
    });
    this.overlayStateMusicToggle.addEventListener('click', () => {
      this.toggleMusicPreference();
    });

    const menuLeft = document.createElement('section');
    menuLeft.className = 'overlay-menu-panel overlay-menu-panel--left';

    const menuEyebrow = document.createElement('div');
    menuEyebrow.className = 'overlay-menu-eyebrow';
    menuEyebrow.textContent = 'Driver Chaos Sidecar Survival';

    const menuTagline = document.createElement('p');
    menuTagline.className = 'overlay-menu-tagline';
    menuTagline.textContent = 'Ride shotgun. Shoot low. Survive your driver.';

    const menuOptions = document.createElement('div');
    menuOptions.className = 'overlay-menu-options';

    const menuOptionsLabel = document.createElement('div');
    menuOptionsLabel.className = 'overlay-menu-section-label';
    menuOptionsLabel.textContent = 'Boot Options';

    menuOptions.append(
      menuOptionsLabel,
      this.overlayMenuSfxToggle,
      this.overlayMenuMusicToggle,
    );

    const menuHint = document.createElement('div');
    menuHint.className = 'overlay-menu-hint';
    menuHint.textContent = 'Press Enter to start';

    menuLeft.append(
      this.overlayMenuLogo,
      menuEyebrow,
      menuTagline,
      this.overlayMenuStartButton,
      this.overlayMenuCopy,
      this.overlayMenuStats,
      menuOptions,
      menuHint,
    );

    const menuRight = document.createElement('div');
    menuRight.className = 'overlay-menu-right';

    const controlsCard = this.createMenuCard('Controls');
    controlsCard.append(
      this.createMenuControlRow('LMB', 'Fire weapon'),
      this.createMenuControlRow('Mouse', 'Aim sidecar gun'),
      this.createMenuControlRow('A / D Hold', 'Call for left or right lane'),
      this.createMenuControlRow('R', 'Reload handgun'),
    );

    const gameplayCard = this.createMenuCard('Gameplay');
    gameplayCard.append(
      this.createMenuPoint('Driver controls the bike. You react, shoot, and survive.'),
      this.createMenuPoint('Aim lower when a runner clamps onto the sidecar.'),
      this.createMenuPoint('Shotgun saves panic moments. Bazooka deletes bad boards.'),
      this.createMenuPoint('Barrels punish crowds, but hard blockers still end the run.'),
      this.createMenuPoint('Call lanes early. The driver is reckless, not psychic.'),
    );

    menuRight.append(controlsCard, gameplayCard);

    const pausedControlsTitle = document.createElement('h2');
    pausedControlsTitle.className = 'overlay-state-panel-title';
    pausedControlsTitle.textContent = 'Controls';
    const pausedAudioLabel = document.createElement('div');
    pausedAudioLabel.className = 'overlay-menu-section-label';
    pausedAudioLabel.textContent = 'Audio';
    this.overlayStateControlsPanel.append(
      pausedControlsTitle,
      this.createMenuControlRow('LMB', 'Fire weapon'),
      this.createMenuControlRow('Mouse', 'Aim sidecar gun'),
      this.createMenuControlRow('A / D Hold', 'Call for a lane change'),
      this.createMenuControlRow('R', 'Reload handgun'),
      pausedAudioLabel,
      this.overlayStateSfxToggle,
      this.overlayStateMusicToggle,
    );

    const summaryTitle = document.createElement('h2');
    summaryTitle.className = 'overlay-state-panel-title';
    summaryTitle.textContent = 'Run Summary';
    this.overlayStateSummaryPanel.append(
      summaryTitle,
      this.createSummaryRow('score', 'Score', this.overlayStateScoreValue),
      this.createSummaryRow('distance', 'Distance', this.overlayStateDistanceValue),
      this.createSummaryRow('time', 'Time', this.overlayStateTimeValue),
      this.createSummaryRow('chain', 'Best Chain', this.overlayStateBestChainValue),
      this.createSummaryRow('skull', 'Zombies Killed', this.overlayStateKillsValue),
    );

    const causeTitle = document.createElement('h2');
    causeTitle.className = 'overlay-state-panel-title overlay-state-panel-title--danger';
    causeTitle.textContent = 'Cause Of Death';
    const causeBadge = document.createElement('div');
    causeBadge.className = 'overlay-state-cause-badge';
    this.overlayStateCausePanel.append(
      causeTitle,
      causeBadge,
      this.overlayStateCauseTitle,
      this.overlayStateCauseBody,
    );

    this.overlayDialog.append(
      this.overlayTitle,
      this.overlayText,
      this.overlayMeta,
      this.overlayBreakdown,
      this.overlayButton,
    );
    this.overlayStateActions.append(
      this.overlayStatePrimaryButton,
      this.overlayStateSecondaryButton,
    );
    this.overlayStateLeft.append(
      this.overlayStateLogo,
      this.overlayStateTitle,
      this.overlayStateSubtitle,
      this.overlayStateActions,
      this.overlayStateHint,
    );
    this.overlayStateRight.append(
      this.overlayStateControlsPanel,
      this.overlayStateSummaryPanel,
      this.overlayStateCausePanel,
    );
    this.overlayState.append(this.overlayStateLeft, this.overlayStateRight);
    this.overlay.append(this.overlayMenu, this.overlayState, this.overlayDialog);
    this.overlayMenu.append(menuLeft, menuRight);
    this.syncAudioButtons();
    this.root.append(
      hud,
      this.mobileControls,
      this.laneRequestHud,
      this.driverPanel,
      this.latchWarning,
      this.accoladeBanner,
      this.rewardCallout,
      this.reloadHint,
      this.crosshair,
      this.vignette,
      this.overlay,
    );
    host.append(this.root);
    this.driverDialogSound.prime();
  }

  setState(gameState: GameStateType): void {
    this.root.dataset.state = gameState;
    if (gameState !== 'running') {
      this.driverPanelHold = 0;
      this.lastDriverPresentation = null;
      this.lastElapsedSeconds = 0;
      this.releaseMobileControls();
    }

    switch (gameState) {
      case 'menu':
        this.overlay.hidden = false;
        this.overlay.dataset.mode = 'menu';
        this.overlayMenu.hidden = false;
        this.overlayState.hidden = true;
        this.overlayDialog.hidden = true;
        break;
      case 'paused':
        this.overlay.hidden = false;
        this.overlay.dataset.mode = 'state';
        this.overlayMenu.hidden = true;
        this.overlayState.hidden = false;
        this.overlayDialog.hidden = true;
        this.pauseSubtitle = this.pickRandom(PAUSE_SUBHEADINGS, this.pauseSubtitle);
        this.overlayState.dataset.kind = 'paused';
        this.overlayStateTitle.textContent = 'Paused';
        this.overlayStateSubtitle.textContent = this.pauseSubtitle;
        this.overlayStatePrimaryButton.textContent = 'Resume Run';
        this.overlayStateSecondaryButton.textContent = 'Restart Game';
        this.overlayStateSecondaryButton.hidden = false;
        this.overlayStateControlsPanel.hidden = false;
        this.overlayStateSummaryPanel.hidden = true;
        this.overlayStateCausePanel.hidden = true;
        this.overlayStateHint.textContent = 'Press Enter to resume';
        break;
      case 'dead':
        this.overlay.hidden = false;
        this.overlay.dataset.mode = 'state';
        this.overlayMenu.hidden = true;
        this.overlayState.hidden = false;
        this.overlayDialog.hidden = true;
        this.deathSubtitle = this.pickRandom(DEATH_SUBHEADINGS, this.deathSubtitle);
        this.overlayState.dataset.kind = 'dead';
        this.overlayStateTitle.textContent = 'Game Over';
        this.overlayStateSubtitle.textContent = this.deathSubtitle;
        this.overlayStatePrimaryButton.textContent = 'Retry Game';
        this.overlayStateSecondaryButton.hidden = true;
        this.overlayStateControlsPanel.hidden = true;
        this.overlayStateSummaryPanel.hidden = false;
        this.overlayStateCausePanel.hidden = false;
        this.overlayStateHint.textContent = 'Press Enter to retry';
        break;
      case 'running':
      default:
        this.overlay.hidden = true;
        this.overlay.dataset.mode = 'hidden';
        this.overlayMenu.hidden = true;
        this.overlayState.hidden = true;
        this.overlayDialog.hidden = true;
        break;
    }

    this.updateMobileControlsVisibility(gameState);
  }

  setAudioPreferences(preferences: AudioPreferenceState): void {
    this.audioPreferences = { ...preferences };
    this.syncAudioButtons();
  }

  setTouchControlsEnabled(enabled: boolean): void {
    this.mobileControlsEnabled = enabled;
    this.root.dataset.touchControls = enabled ? 'true' : 'false';
    this.updateMobileControlsVisibility(this.root.dataset.state as GameStateType);
  }

  setDeathCause(cause: DeathCausePresentation): void {
    this.overlayStateCauseTitle.textContent = cause.title;
    this.overlayStateCauseBody.textContent = cause.body;
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
    this.healthValue.textContent = `${Math.ceil(snapshot.player.health)} HP`;
    const healthHue = Math.max(4, Math.round(healthRatio * 118));
    const healthColor = `hsl(${healthHue} 82% 50%)`;
    const healthAccent = `hsl(${Math.min(healthHue + 16, 128)} 78% 62%)`;
    this.healthFill.style.background = `linear-gradient(90deg, ${healthColor} 0%, ${healthAccent} 100%)`;
    this.healthFill.style.boxShadow = `0 0 22px hsla(${healthHue} 90% 56% / 0.42)`;

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

    this.reloadHint.hidden = !snapshot.weapon.showReloadHint || this.mobileControlsEnabled;

    this.scoreValue.textContent = `${snapshot.player.score}`;
    this.multiplierValue.textContent = `Chain x${snapshot.reward.multiplier.toFixed(2)}`;
    this.multiplierValue.dataset.active = snapshot.reward.chainCount > 1 ? 'true' : 'false';
    this.multiplierValue.dataset.tier = this.getChainTier(snapshot.reward);
    this.chainPanel.dataset.active = snapshot.reward.chainCount > 0 ? 'true' : 'false';
    this.chainPanel.dataset.ready = snapshot.reward.chainCount > 0 ? 'false' : 'true';
    this.chainPanel.dataset.tier = this.getChainTier(snapshot.reward);
    this.chainFill.style.transform = `scaleX(${snapshot.reward.chainTimerRatio.toFixed(3)})`;
    this.chainLabel.textContent =
      snapshot.reward.chainCount > 0
        ? `${snapshot.reward.chainCount} HIT CHAIN`
        : 'Chain Ready';
    this.distanceValue.textContent = formatDistance(snapshot.player.distance);
    this.timerValue.textContent = `${snapshot.elapsedSeconds.toFixed(1)}s`;
    this.rewardCallout.textContent = snapshot.reward.recentCallout;
    this.rewardCallout.dataset.visible =
      snapshot.reward.recentCalloutTimer > 0 && snapshot.reward.recentCallout !== ''
        ? 'true'
        : 'false';
    this.rewardCallout.dataset.combo =
      /(DOUBLE|TRIPLE|MULTI) KILL/.test(snapshot.reward.recentCallout) ? 'true' : 'false';
    this.accoladeBanner.hidden =
      snapshot.reward.activeAccoladeTimer <= 0 || snapshot.reward.activeAccolade === '';
    this.accoladeBanner.textContent = snapshot.reward.activeAccolade;
    this.accoladeBanner.dataset.visible =
      snapshot.reward.activeAccoladeTimer > 0 && snapshot.reward.activeAccolade !== ''
        ? 'true'
        : 'false';
    this.accoladeBanner.dataset.tone = snapshot.reward.activeAccoladeTone;

    const activeEvent = snapshot.ride?.activeEvent ?? 'none';
    const eventVisible = Boolean(snapshot.ride) && activeEvent !== 'none';
    this.eventChip.hidden = !eventVisible;
    this.eventChip.textContent = this.getEventLabel(activeEvent);
    this.eventChip.dataset.event = activeEvent;
    this.eventChip.dataset.visible = eventVisible ? 'true' : 'false';
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
    this.syncDriverDialogSound(visibleDriverPresentation, snapshot.gameState);
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
      this.latchLabel.textContent = 'Runner latched - shoot low or break it loose';
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
      this.overlayStateScoreValue.textContent = `${snapshot.player.score}`;
      this.overlayStateDistanceValue.textContent = formatDistance(snapshot.player.distance);
      this.overlayStateTimeValue.textContent = `${snapshot.elapsedSeconds.toFixed(1)}s`;
      this.overlayStateBestChainValue.textContent = `${snapshot.reward.bestChain}`;
      this.overlayStateKillsValue.textContent = `${snapshot.reward.zombiesKilled}`;
      return;
    }

    if (snapshot.gameState === 'menu') {
      this.overlayMenuStats.textContent =
        `Best Score  ${snapshot.reward.bestScore}\n` +
        `Best Chain  ${snapshot.reward.bestChainRecord}\n` +
        `Last Run  ${snapshot.reward.lastRunScore}`;
      this.overlayMeta.textContent = '';
      this.overlayBreakdown.hidden = true;
      this.overlayBreakdown.textContent = '';
      return;
    }

    this.overlayMenuStats.textContent = '';
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
        supportCue.intent === 'obstacleHit' || supportCue.intent === 'laneRequestWrong'
          ? 'panic'
          : supportCue.intent === 'laneRequestDenied'
            ? 'observing'
            : 'calm';
      const speaker =
        supportCue.intent === 'obstacleHit'
          ? 'Driver  Instantly Regretful'
          : supportCue.intent === 'laneRequestWrong'
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
        label: 'Critical damage. The bike is falling apart. Clear me a lane.',
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

  private createStatChip(
    kind: 'score' | 'distance' | 'time',
    label: string,
    valueNode: HTMLElement,
  ): HTMLElement {
    const chip = document.createElement('div');
    chip.className = `stat-chip stat-chip--${kind}`;

    const icon = document.createElement('span');
    icon.className = `stat-icon stat-icon--${kind}`;
    icon.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'stat-body';

    const labelNode = document.createElement('span');
    labelNode.className = 'stat-label';
    labelNode.textContent = label;

    body.append(labelNode, valueNode);
    chip.append(icon, body);
    return chip;
  }

  private createMenuCard(title: string): HTMLElement {
    const card = document.createElement('section');
    card.className = 'overlay-menu-card';

    const heading = document.createElement('h2');
    heading.className = 'overlay-menu-card-title';
    heading.textContent = title;

    card.append(heading);
    return card;
  }

  private createMenuControlRow(keyLabel: string, description: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'overlay-menu-control';

    const key = document.createElement('span');
    key.className = 'overlay-menu-key';
    key.textContent = keyLabel;

    const label = document.createElement('span');
    label.className = 'overlay-menu-control-label';
    label.textContent = description;

    row.append(key, label);
    return row;
  }

  private createMenuPoint(text: string): HTMLElement {
    const point = document.createElement('div');
    point.className = 'overlay-menu-point';
    point.textContent = text;
    return point;
  }

  private createSummaryRow(
    icon: 'score' | 'distance' | 'time' | 'chain' | 'skull',
    label: string,
    valueNode: HTMLElement,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'overlay-summary-row';

    const iconNode = document.createElement('span');
    iconNode.className = `overlay-summary-icon overlay-summary-icon--${icon}`;
    iconNode.setAttribute('aria-hidden', 'true');

    const labelNode = document.createElement('span');
    labelNode.className = 'overlay-summary-label';
    labelNode.textContent = label;

    valueNode.classList.add('overlay-summary-value');
    row.append(iconNode, labelNode, valueNode);
    return row;
  }

  private getChainTier(reward: RewardState): 'ready' | 'low' | 'mid' | 'high' | 'overdrive' {
    if (reward.chainCount <= 0) {
      return 'ready';
    }
    if (reward.multiplier >= 3.5 || reward.chainCount >= 12) {
      return 'overdrive';
    }
    if (reward.multiplier >= 2.5 || reward.chainCount >= 8) {
      return 'high';
    }
    if (reward.multiplier >= 1.75 || reward.chainCount >= 4) {
      return 'mid';
    }
    return 'low';
  }

  private pickRandom(options: readonly string[], previous: string): string {
    if (options.length <= 1) {
      return options[0] ?? previous;
    }

    let next = previous;
    while (next === previous) {
      next = options[Math.floor(Math.random() * options.length)] ?? previous;
    }
    return next;
  }

  private toggleSfxPreference(): void {
    const nextValue = !this.audioPreferences.sfxEnabled;
    this.audioPreferences.sfxEnabled = nextValue;
    this.syncAudioButtons();
    this.onSfxPreferenceChange?.(nextValue);
  }

  private toggleMusicPreference(): void {
    const nextValue = !this.audioPreferences.musicEnabled;
    this.audioPreferences.musicEnabled = nextValue;
    this.syncAudioButtons();
    this.onMusicPreferenceChange?.(nextValue);
  }

  private syncAudioButtons(): void {
    this.overlayMenuSfxToggle.dataset.enabled = this.audioPreferences.sfxEnabled
      ? 'true'
      : 'false';
    this.overlayMenuMusicToggle.dataset.enabled = this.audioPreferences.musicEnabled
      ? 'true'
      : 'false';
    this.overlayMenuSfxToggle.dataset.kind = 'sfx';
    this.overlayMenuMusicToggle.dataset.kind = 'music';
    this.overlayMenuSfxToggle.textContent = 'Enable SFX';
    this.overlayMenuMusicToggle.textContent = 'Enable Music';
    this.overlayStateSfxToggle.dataset.enabled = this.audioPreferences.sfxEnabled
      ? 'true'
      : 'false';
    this.overlayStateMusicToggle.dataset.enabled = this.audioPreferences.musicEnabled
      ? 'true'
      : 'false';
    this.overlayStateSfxToggle.dataset.kind = 'sfx';
    this.overlayStateMusicToggle.dataset.kind = 'music';
    this.overlayStateSfxToggle.textContent = this.audioPreferences.sfxEnabled
      ? 'SFX On'
      : 'SFX Off';
    this.overlayStateMusicToggle.textContent = this.audioPreferences.musicEnabled
      ? 'Music On'
      : 'Music Off';
  }

  private updateMobileControlsVisibility(gameState: GameStateType): void {
    this.mobileControls.hidden = !this.mobileControlsEnabled || gameState !== 'running';
  }

  private releaseMobileControls(): void {
    this.mobileLeftButton.dataset.active = 'false';
    this.mobileRightButton.dataset.active = 'false';
    this.mobileReloadButton.dataset.active = 'false';
    this.mobileFireButton.dataset.active = 'false';
    this.onMobileLaneHoldChange?.(-1, false);
    this.onMobileLaneHoldChange?.(1, false);
    this.onMobileFireHeldChange?.(false);
  }

  private bindHoldControl(
    button: HTMLButtonElement,
    onHoldChange: (active: boolean) => void,
  ): void {
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.dataset.active = 'true';
      button.setPointerCapture?.(event.pointerId);
      onHoldChange(true);
    });

    const release = (event?: PointerEvent) => {
      if (event) {
        event.preventDefault();
      }
      button.dataset.active = 'false';
      onHoldChange(false);
    };

    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', () => {
      button.dataset.active = 'false';
      onHoldChange(false);
    });
  }

  destroy(): void {
    this.releaseMobileControls();
    this.driverDialogSound.destroy();
    this.root.remove();
  }

  private syncDriverDialogSound(
    visibleDriverPresentation: DriverPresentation | null,
    gameState: GameStateType,
  ): void {
    if (gameState !== 'running' || !visibleDriverPresentation) {
      this.lastVisibleDriverPresentationKey = null;
      return;
    }

    if (this.lastVisibleDriverPresentationKey === visibleDriverPresentation.key) {
      return;
    }

    this.lastVisibleDriverPresentationKey = visibleDriverPresentation.key;
    this.driverDialogSound.play(0.055, 1.12 + Math.random() * 0.06);
  }

}
