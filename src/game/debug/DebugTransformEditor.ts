import type {
  ControlProfile,
  DebugTransformSnapshot,
  DebugTransformTarget,
  Vec3Tuple,
} from '../../core/types';

export type DebugTransformBinding = {
  label: string;
  description: string;
  get: () => DebugTransformSnapshot;
  set: (snapshot: DebugTransformSnapshot) => void;
  reset: () => DebugTransformSnapshot;
};

type DebugTransformEditorOptions = {
  host: HTMLElement;
  enabled: boolean;
  initialProfile: ControlProfile;
  targets: Partial<Record<DebugTransformTarget, DebugTransformBinding>>;
  onProfileChange: (profile: ControlProfile) => void;
  onStartLocalRun: (profile: ControlProfile) => void;
};

const STORAGE_KEY = 'sidecar-of-the-dead.debug-transforms.v1';
const PROFILE_LABELS: Record<ControlProfile, string> = {
  legacyGunner: 'Legacy Gunner',
  coopGunner: 'Co-op Gunner',
  driver: 'Driver',
};

export class DebugTransformEditor {
  private readonly root = document.createElement('div');
  private readonly profileSelect = document.createElement('select');
  private readonly targetSelect = document.createElement('select');
  private readonly status = document.createElement('div');
  private readonly inputs: Record<keyof DebugTransformSnapshot, HTMLInputElement[]> = {
    position: [],
    rotationDegrees: [],
    scale: [],
  };
  private readonly targets: Partial<Record<DebugTransformTarget, DebugTransformBinding>>;
  private readonly enabled: boolean;
  private selectedProfile: ControlProfile;

  constructor(private readonly options: DebugTransformEditorOptions) {
    this.enabled = options.enabled;
    this.selectedProfile = options.initialProfile;
    this.targets = options.targets;

    if (!this.enabled) {
      return;
    }

    this.buildUi();
    this.options.host.append(this.root);
    this.applyStoredDrafts();
    this.syncTargetFields();
    window.addEventListener('keydown', this.handleKeyDown);
  }

  destroy(): void {
    if (!this.enabled) {
      return;
    }

    window.removeEventListener('keydown', this.handleKeyDown);
    this.root.remove();
  }

  setProfile(profile: ControlProfile): void {
    this.selectedProfile = profile;
    if (this.profileSelect.value !== profile) {
      this.profileSelect.value = profile;
    }
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code !== 'F2') {
      return;
    }

    event.preventDefault();
    this.root.hidden = !this.root.hidden;
  };

  private buildUi(): void {
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Co-op debug transform editor');
    this.root.style.cssText = [
      'position:absolute',
      'right:16px',
      'top:16px',
      'z-index:80',
      'width:min(360px,calc(100vw - 32px))',
      'max-height:calc(100vh - 32px)',
      'overflow:auto',
      'padding:14px',
      'border:1px solid rgba(255,190,110,.34)',
      'border-radius:14px',
      'background:linear-gradient(180deg,rgba(20,18,16,.96),rgba(8,9,11,.92))',
      'box-shadow:0 24px 52px rgba(0,0,0,.42)',
      'color:#fff1d8',
      'font-family:Quantico,Segoe UI,sans-serif',
      'pointer-events:auto',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'Co-op Debug / 3D Tuner';
    title.style.cssText =
      'font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#ffba6b;margin-bottom:8px';

    const hint = document.createElement('div');
    hint.textContent = 'F2 toggle. Drafts save to localStorage; Copy JSON for config.';
    hint.style.cssText = 'font-size:12px;color:#d9c8aa;line-height:1.35;margin-bottom:12px';

    const profileRow = this.createRow('Profile');
    for (const profile of Object.keys(PROFILE_LABELS) as ControlProfile[]) {
      const option = document.createElement('option');
      option.value = profile;
      option.textContent = PROFILE_LABELS[profile];
      this.profileSelect.append(option);
    }
    this.profileSelect.value = this.selectedProfile;
    this.styleControl(this.profileSelect);
    const applyProfileButton = this.createButton('Apply');
    applyProfileButton.addEventListener('click', () => {
      this.selectedProfile = this.profileSelect.value as ControlProfile;
      this.options.onProfileChange(this.selectedProfile);
      this.setStatus(`Profile set: ${PROFILE_LABELS[this.selectedProfile]}`);
    });
    const startButton = this.createButton('Start Local');
    startButton.addEventListener('click', () => {
      this.selectedProfile = this.profileSelect.value as ControlProfile;
      this.options.onStartLocalRun(this.selectedProfile);
      this.setStatus(`Started local ${PROFILE_LABELS[this.selectedProfile]}`);
    });
    profileRow.append(this.profileSelect, applyProfileButton, startButton);

    const targetRow = this.createRow('Target');
    for (const target of Object.keys(this.targets) as DebugTransformTarget[]) {
      const binding = this.targets[target];
      if (!binding) {
        continue;
      }
      const option = document.createElement('option');
      option.value = target;
      option.textContent = binding.label;
      this.targetSelect.append(option);
    }
    this.styleControl(this.targetSelect);
    this.targetSelect.addEventListener('change', () => {
      this.syncTargetFields();
    });
    targetRow.append(this.targetSelect);

    const fields = document.createElement('div');
    fields.style.cssText = 'display:grid;gap:8px;margin:10px 0';
    fields.append(
      this.createVectorInputs('position', 'Position', 0.01),
      this.createVectorInputs('rotationDegrees', 'Rotation deg', 0.25),
      this.createVectorInputs('scale', 'Scale', 0.01),
    );

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
    const applyTargetButton = this.createButton('Apply Target');
    applyTargetButton.addEventListener('click', () => {
      this.applyCurrentTarget();
    });
    const resetButton = this.createButton('Reset Target');
    resetButton.addEventListener('click', () => {
      this.resetCurrentTarget();
    });
    const copyButton = this.createButton('Copy JSON');
    copyButton.addEventListener('click', () => {
      void this.copyJson();
    });
    actions.append(applyTargetButton, resetButton, copyButton);

    this.status.style.cssText = 'min-height:18px;margin-top:10px;font-size:12px;color:#d9c8aa';
    this.root.append(title, hint, profileRow, targetRow, fields, actions, this.status);
  }

  private createRow(label: string): HTMLElement {
    const row = document.createElement('label');
    row.style.cssText = 'display:grid;grid-template-columns:72px 1fr auto auto;gap:8px;align-items:center;margin:8px 0';
    const text = document.createElement('span');
    text.textContent = label;
    text.style.cssText = 'font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#d9c8aa';
    row.append(text);
    return row;
  }

  private createVectorInputs(
    key: keyof DebugTransformSnapshot,
    label: string,
    step: number,
  ): HTMLElement {
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:86px repeat(3,1fr);gap:6px;align-items:center';
    const text = document.createElement('span');
    text.textContent = label;
    text.style.cssText = 'font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#d9c8aa';
    row.append(text);

    for (const axis of ['X', 'Y', 'Z']) {
      const input = document.createElement('input');
      input.type = 'number';
      input.step = String(step);
      input.placeholder = axis;
      this.styleControl(input);
      input.addEventListener('change', () => {
        this.applyCurrentTarget();
      });
      this.inputs[key].push(input);
      row.append(input);
    }

    return row;
  }

  private createButton(label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = [
      'min-height:30px',
      'padding:0 10px',
      'border:1px solid rgba(255,190,110,.28)',
      'border-radius:9px',
      'background:linear-gradient(180deg,rgba(255,173,84,.18),rgba(45,31,22,.88))',
      'color:#ffe8bf',
      'font:700 11px Quantico,Segoe UI,sans-serif',
      'letter-spacing:.08em',
      'text-transform:uppercase',
      'cursor:pointer',
    ].join(';');
    return button;
  }

  private styleControl(control: HTMLElement): void {
    control.style.cssText = [
      'min-width:0',
      'height:30px',
      'padding:0 8px',
      'border:1px solid rgba(255,226,189,.18)',
      'border-radius:8px',
      'background:rgba(4,5,7,.74)',
      'color:#fff1d8',
      'font:700 12px Quantico,Segoe UI,sans-serif',
    ].join(';');
  }

  private getCurrentTarget(): DebugTransformTarget | null {
    const value = this.targetSelect.value as DebugTransformTarget;
    return this.targets[value] ? value : null;
  }

  private syncTargetFields(): void {
    const target = this.getCurrentTarget();
    if (!target) {
      return;
    }

    const binding = this.targets[target];
    if (!binding) {
      return;
    }

    this.writeFields(binding.get());
    this.setStatus(binding.description);
  }

  private applyCurrentTarget(): void {
    const target = this.getCurrentTarget();
    if (!target) {
      return;
    }

    const binding = this.targets[target];
    if (!binding) {
      return;
    }

    const snapshot = this.readFields();
    binding.set(snapshot);
    this.saveDraft(target, snapshot);
    this.setStatus(`Applied ${binding.label}`);
  }

  private resetCurrentTarget(): void {
    const target = this.getCurrentTarget();
    if (!target) {
      return;
    }

    const binding = this.targets[target];
    if (!binding) {
      return;
    }

    const snapshot = binding.reset();
    this.writeFields(snapshot);
    this.removeDraft(target);
    this.setStatus(`Reset ${binding.label}`);
  }

  private writeFields(snapshot: DebugTransformSnapshot): void {
    this.writeTuple(this.inputs.position, snapshot.position);
    this.writeTuple(this.inputs.rotationDegrees, snapshot.rotationDegrees);
    this.writeTuple(this.inputs.scale, snapshot.scale);
  }

  private writeTuple(inputs: HTMLInputElement[], values: Vec3Tuple): void {
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      if (!input) {
        continue;
      }
      input.value = this.formatNumber(values[index] ?? 0);
    }
  }

  private readFields(): DebugTransformSnapshot {
    return {
      position: this.readTuple(this.inputs.position, [0, 0, 0]),
      rotationDegrees: this.readTuple(this.inputs.rotationDegrees, [0, 0, 0]),
      scale: this.readTuple(this.inputs.scale, [1, 1, 1]),
    };
  }

  private readTuple(inputs: HTMLInputElement[], fallback: Vec3Tuple): Vec3Tuple {
    return [0, 1, 2].map((index) => {
      const parsed = Number(inputs[index]?.value);
      return Number.isFinite(parsed) ? parsed : fallback[index];
    }) as Vec3Tuple;
  }

  private getStoredDrafts(): Partial<Record<DebugTransformTarget, DebugTransformSnapshot>> {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return {};
      }
      return JSON.parse(raw) as Partial<Record<DebugTransformTarget, DebugTransformSnapshot>>;
    } catch {
      return {};
    }
  }

  private saveDraft(target: DebugTransformTarget, snapshot: DebugTransformSnapshot): void {
    try {
      const drafts = this.getStoredDrafts();
      drafts[target] = snapshot;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
    } catch {
      this.setStatus('Could not save draft to localStorage.');
    }
  }

  private removeDraft(target: DebugTransformTarget): void {
    try {
      const drafts = this.getStoredDrafts();
      delete drafts[target];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
    } catch {
      this.setStatus('Could not update localStorage draft.');
    }
  }

  private applyStoredDrafts(): void {
    const drafts = this.getStoredDrafts();
    for (const target of Object.keys(drafts) as DebugTransformTarget[]) {
      const binding = this.targets[target];
      const snapshot = drafts[target];
      if (!binding || !snapshot) {
        continue;
      }
      binding.set(snapshot);
    }
  }

  private async copyJson(): Promise<void> {
    const payload: Partial<Record<DebugTransformTarget, DebugTransformSnapshot>> = {};
    for (const target of Object.keys(this.targets) as DebugTransformTarget[]) {
      const binding = this.targets[target];
      if (!binding) {
        continue;
      }
      payload[target] = binding.get();
    }

    const json = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      this.setStatus('Copied debug transform JSON.');
    } catch {
      this.setStatus(json);
    }
  }

  private formatNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }

  private setStatus(message: string): void {
    this.status.textContent = message;
  }
}
