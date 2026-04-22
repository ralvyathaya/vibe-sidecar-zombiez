import { Vector2 } from 'three';

export interface LaneRequestInputState {
  active: boolean;
  direction: -1 | 0 | 1;
  holdRatio: number;
}

export class InputSystem {
  onPointerLockChange?: (locked: boolean) => void;

  private readonly keyboardKeys = new Set<string>();
  private readonly virtualKeys = new Set<string>();
  private readonly lookDelta = new Vector2();
  private readonly touchLookSensitivity = 0.92;
  private readonly touchControlsEnabled = this.detectTouchControls();
  private pointerLocked = false;
  private mouseFireHeld = false;
  private virtualFireHeld = false;
  private reloadQueued = false;
  private actionQQueued = false;
  private actionEQueued = false;
  private wigglePulse = 0;
  private lastLeanTapCode = '';
  private lastLeanTapTime = 0;
  private laneRequestDirection: -1 | 0 | 1 = 0;
  private laneRequestStartedAt = 0;
  private laneRequestTriggered = false;
  private aimTouchId: number | null = null;
  private aimLastX = 0;
  private aimLastY = 0;

  constructor(private readonly domElement: HTMLElement) {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
    this.handlePointerLock = this.handlePointerLock.bind(this);
    this.handleWindowBlur = this.handleWindowBlur.bind(this);
    this.handleContextMenu = this.handleContextMenu.bind(this);

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mousedown', this.handleMouseDown);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('blur', this.handleWindowBlur);
    window.addEventListener('contextmenu', this.handleContextMenu);
    this.domElement.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.domElement.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.domElement.addEventListener('touchend', this.handleTouchEnd, { passive: false });
    this.domElement.addEventListener('touchcancel', this.handleTouchEnd, { passive: false });
    document.addEventListener('pointerlockchange', this.handlePointerLock);
  }

  requestPointerLock(): void {
    if (!this.shouldUsePointerLock()) {
      return;
    }

    this.domElement.requestPointerLock();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mousedown', this.handleMouseDown);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('blur', this.handleWindowBlur);
    window.removeEventListener('contextmenu', this.handleContextMenu);
    this.domElement.removeEventListener('touchstart', this.handleTouchStart);
    this.domElement.removeEventListener('touchmove', this.handleTouchMove);
    this.domElement.removeEventListener('touchend', this.handleTouchEnd);
    this.domElement.removeEventListener('touchcancel', this.handleTouchEnd);
    document.removeEventListener('pointerlockchange', this.handlePointerLock);
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  shouldUsePointerLock(): boolean {
    return !this.touchControlsEnabled;
  }

  usesTouchControls(): boolean {
    return this.touchControlsEnabled;
  }

  getStrafeAxis(): number {
    const left = this.hasKey('KeyA') ? -1 : 0;
    const right = this.hasKey('KeyD') ? 1 : 0;
    return left + right;
  }

  getLeanAxis(): number {
    return 0;
  }

  isFireHeld(): boolean {
    return this.mouseFireHeld || this.virtualFireHeld;
  }

  consumeLookDelta(target = new Vector2()): Vector2 {
    target.copy(this.lookDelta);
    this.lookDelta.set(0, 0);
    return target;
  }

  consumeReloadPressed(): boolean {
    const wasQueued = this.reloadQueued;
    this.reloadQueued = false;
    return wasQueued;
  }

  consumeActionQ(): boolean {
    const wasQueued = this.actionQQueued;
    this.actionQQueued = false;
    return wasQueued;
  }

  consumeActionE(): boolean {
    const wasQueued = this.actionEQueued;
    this.actionEQueued = false;
    return wasQueued;
  }

  isAccelerateHeld(): boolean {
    return this.hasKey('KeyW');
  }

  isBrakeHeld(): boolean {
    return this.hasKey('KeyS');
  }

  consumeWigglePulse(): number {
    const pulse = this.wigglePulse;
    this.wigglePulse = 0;
    return pulse;
  }

  getLaneRequestState(
    holdDurationSeconds: number,
    blocked = false,
  ): LaneRequestInputState {
    const state = this.updateLaneRequestState(
      holdDurationSeconds,
      blocked,
      performance.now(),
      false,
    );
    return {
      active: state.active,
      direction: state.direction,
      holdRatio: state.holdRatio,
    };
  }

  consumeLaneRequest(holdDurationSeconds: number, blocked = false): -1 | 0 | 1 {
    const state = this.updateLaneRequestState(
      holdDurationSeconds,
      blocked,
      performance.now(),
      true,
    );
    return state.triggered ? state.direction : 0;
  }

  setVirtualLaneHeld(direction: -1 | 1, active: boolean): void {
    const code = direction < 0 ? 'KeyA' : 'KeyD';
    this.setVirtualKey(code, active);
  }

  setVirtualFireHeld(active: boolean): void {
    this.virtualFireHeld = active;
  }

  queueVirtualReload(): void {
    this.reloadQueued = true;
  }

  releaseVirtualControls(): void {
    this.virtualKeys.clear();
    this.virtualFireHeld = false;
    this.aimTouchId = null;
    this.resetLaneRequestState();
  }

  clearTransientInput(): void {
    this.mouseFireHeld = false;
    this.virtualFireHeld = false;
    this.reloadQueued = false;
    this.actionQQueued = false;
    this.actionEQueued = false;
    this.wigglePulse = 0;
    this.lookDelta.set(0, 0);
    this.aimTouchId = null;
    this.virtualKeys.clear();
    this.resetLaneRequestState();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    this.keyboardKeys.add(event.code);

    if (event.code === 'KeyR') {
      this.reloadQueued = true;
      return;
    }

    if (event.code === 'KeyQ') {
      this.actionQQueued = true;
      return;
    }

    if (event.code === 'KeyE') {
      this.actionEQueued = true;
      return;
    }

    if (event.code === 'KeyA' || event.code === 'KeyD') {
      this.registerLeanTap(event.code);
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    this.keyboardKeys.delete(event.code);
    if (event.code === 'KeyA' || event.code === 'KeyD') {
      const direction = this.getStrafeAxis();
      if (direction !== -1 && direction !== 1) {
        this.resetLaneRequestState();
      }
    }
  }

  private handleMouseMove(event: MouseEvent): void {
    if (!this.pointerLocked) {
      return;
    }

    this.lookDelta.x += event.movementX;
    this.lookDelta.y += event.movementY;
  }

  private handleMouseDown(event: MouseEvent): void {
    if (event.button === 0) {
      this.mouseFireHeld = true;
    }
  }

  private handleMouseUp(event: MouseEvent): void {
    if (event.button === 0) {
      this.mouseFireHeld = false;
    }
  }

  private handleTouchStart(event: TouchEvent): void {
    if (!this.touchControlsEnabled || this.aimTouchId !== null) {
      return;
    }

    const touch = event.changedTouches[0];
    if (!touch) {
      return;
    }

    this.aimTouchId = touch.identifier;
    this.aimLastX = touch.clientX;
    this.aimLastY = touch.clientY;
    event.preventDefault();
  }

  private handleTouchMove(event: TouchEvent): void {
    if (!this.touchControlsEnabled || this.aimTouchId === null) {
      return;
    }

    const touch = this.findTouchById(event.touches, this.aimTouchId);
    if (!touch) {
      return;
    }

    this.lookDelta.x += (touch.clientX - this.aimLastX) * this.touchLookSensitivity;
    this.lookDelta.y += (touch.clientY - this.aimLastY) * this.touchLookSensitivity;
    this.aimLastX = touch.clientX;
    this.aimLastY = touch.clientY;
    event.preventDefault();
  }

  private handleTouchEnd(event: TouchEvent): void {
    if (!this.touchControlsEnabled || this.aimTouchId === null) {
      return;
    }

    const touch = this.findTouchById(event.changedTouches, this.aimTouchId);
    if (!touch) {
      return;
    }

    this.aimTouchId = null;
    event.preventDefault();
  }

  private handlePointerLock(): void {
    this.pointerLocked = document.pointerLockElement === this.domElement;
    this.onPointerLockChange?.(this.pointerLocked);
  }

  private handleWindowBlur(): void {
    this.keyboardKeys.clear();
    this.virtualKeys.clear();
    this.mouseFireHeld = false;
    this.virtualFireHeld = false;
    this.actionQQueued = false;
    this.actionEQueued = false;
    this.wigglePulse = 0;
    this.aimTouchId = null;
    this.resetLaneRequestState();
  }

  private handleContextMenu(event: MouseEvent): void {
    if (this.pointerLocked) {
      event.preventDefault();
    }
  }

  private detectTouchControls(): boolean {
    const coarsePointer =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
    return (
      navigator.maxTouchPoints > 0 ||
      coarsePointer
    );
  }

  private findTouchById(touchList: TouchList, id: number): Touch | null {
    for (let index = 0; index < touchList.length; index += 1) {
      const touch = touchList.item(index);
      if (touch && touch.identifier === id) {
        return touch;
      }
    }

    return null;
  }

  private hasKey(code: string): boolean {
    return this.keyboardKeys.has(code) || this.virtualKeys.has(code);
  }

  private setVirtualKey(code: string, active: boolean): void {
    if (active) {
      if (this.virtualKeys.has(code)) {
        return;
      }

      this.virtualKeys.add(code);
      if (code === 'KeyA' || code === 'KeyD') {
        this.registerLeanTap(code);
      }
      return;
    }

    if (!this.virtualKeys.delete(code)) {
      return;
    }

    if (code === 'KeyA' || code === 'KeyD') {
      const direction = this.getStrafeAxis();
      if (direction !== -1 && direction !== 1) {
        this.resetLaneRequestState();
      }
    }
  }

  private registerLeanTap(code: string): void {
    const now = performance.now();
    const oppositeKey = code === 'KeyA' ? 'KeyD' : 'KeyA';
    if (this.lastLeanTapCode === oppositeKey && now - this.lastLeanTapTime <= 280) {
      this.wigglePulse += 0.34;
    }
    this.lastLeanTapCode = code;
    this.lastLeanTapTime = now;
  }

  private resetLaneRequestState(): void {
    this.laneRequestDirection = 0;
    this.laneRequestStartedAt = 0;
    this.laneRequestTriggered = false;
  }

  private updateLaneRequestState(
    holdDurationSeconds: number,
    blocked: boolean,
    now: number,
    commitTrigger: boolean,
  ): LaneRequestInputState & { triggered: boolean } {
    if (blocked) {
      this.resetLaneRequestState();
      return {
        active: false,
        direction: 0,
        holdRatio: 0,
        triggered: false,
      };
    }

    const direction = this.getStrafeAxis();
    if (direction !== -1 && direction !== 1) {
      this.resetLaneRequestState();
      return {
        active: false,
        direction: 0,
        holdRatio: 0,
        triggered: false,
      };
    }

    if (this.laneRequestDirection !== direction || this.laneRequestStartedAt <= 0) {
      this.laneRequestDirection = direction;
      this.laneRequestStartedAt = now;
      this.laneRequestTriggered = false;
    }

    if (this.laneRequestTriggered) {
      return {
        active: false,
        direction: 0,
        holdRatio: 0,
        triggered: false,
      };
    }

    const durationMs = Math.max(holdDurationSeconds * 1000, 1);
    const elapsedMs = Math.max(0, now - this.laneRequestStartedAt);
    const triggered = !this.laneRequestTriggered && elapsedMs >= durationMs;
    if (triggered && commitTrigger) {
      this.laneRequestTriggered = true;
    }

    return {
      active: true,
      direction,
      holdRatio: Math.min(1, elapsedMs / durationMs),
      triggered,
    };
  }
}
