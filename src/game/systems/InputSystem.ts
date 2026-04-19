import { Vector2 } from 'three';

export class InputSystem {
  onPointerLockChange?: (locked: boolean) => void;

  private readonly pressedKeys = new Set<string>();
  private readonly lookDelta = new Vector2();
  private pointerLocked = false;
  private fireHeld = false;
  private reloadQueued = false;
  private actionQQueued = false;
  private actionEQueued = false;
  private wigglePulse = 0;
  private lastLeanTapCode = '';
  private lastLeanTapTime = 0;

  constructor(private readonly domElement: HTMLElement) {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
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
    document.addEventListener('pointerlockchange', this.handlePointerLock);
  }

  requestPointerLock(): void {
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
    document.removeEventListener('pointerlockchange', this.handlePointerLock);
  }

  isPointerLocked(): boolean {
    return this.pointerLocked;
  }

  getStrafeAxis(): number {
    const left = this.pressedKeys.has('KeyA') ? -1 : 0;
    const right = this.pressedKeys.has('KeyD') ? 1 : 0;
    return left + right;
  }

  getLeanAxis(): number {
    return this.getStrafeAxis();
  }

  isFireHeld(): boolean {
    return this.fireHeld;
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

  consumeWigglePulse(): number {
    const pulse = this.wigglePulse;
    this.wigglePulse = 0;
    return pulse;
  }

  clearTransientInput(): void {
    this.fireHeld = false;
    this.reloadQueued = false;
    this.actionQQueued = false;
    this.actionEQueued = false;
    this.wigglePulse = 0;
    this.lookDelta.set(0, 0);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    this.pressedKeys.add(event.code);

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
      const now = performance.now();
      const oppositeKey =
        event.code === 'KeyA'
          ? 'KeyD'
          : 'KeyA';
      if (
        this.lastLeanTapCode === oppositeKey &&
        now - this.lastLeanTapTime <= 280
      ) {
        this.wigglePulse += 0.42;
      }
      this.lastLeanTapCode = event.code;
      this.lastLeanTapTime = now;
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    this.pressedKeys.delete(event.code);
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
      this.fireHeld = true;
    }
  }

  private handleMouseUp(event: MouseEvent): void {
    if (event.button === 0) {
      this.fireHeld = false;
    }
  }

  private handlePointerLock(): void {
    this.pointerLocked = document.pointerLockElement === this.domElement;
    this.onPointerLockChange?.(this.pointerLocked);
  }

  private handleWindowBlur(): void {
    this.pressedKeys.clear();
    this.fireHeld = false;
    this.actionQQueued = false;
    this.actionEQueued = false;
    this.wigglePulse = 0;
  }

  private handleContextMenu(event: MouseEvent): void {
    if (this.pointerLocked) {
      event.preventDefault();
    }
  }
}
