import type { Camera, Object3D, Vector3 } from 'three';

export class MuzzlePointResolver {
  private node: Object3D | null = null;
  private markerNames: readonly string[] = [];
  private warnedMissing = false;

  constructor(
    private readonly label: string,
    private readonly fallbackAnchor: Object3D,
  ) {}

  bind(root: Object3D | null, markerNames: readonly string[] | undefined): void {
    this.markerNames = markerNames ?? [];
    this.node = root && this.markerNames.length > 0
      ? findNamedDescendant(root, this.markerNames)
      : null;
    this.warnedMissing = false;

    if (root && this.markerNames.length > 0 && !this.node) {
      this.warnMissing();
    }
  }

  hasMarker(): boolean {
    return this.node !== null;
  }

  getWorldPosition(target: Vector3): Vector3 {
    if (this.node) {
      return this.node.getWorldPosition(target);
    }

    this.warnMissing();
    return this.fallbackAnchor.getWorldPosition(target);
  }

  private warnMissing(): void {
    if (this.warnedMissing || this.markerNames.length === 0) {
      return;
    }

    this.warnedMissing = true;
    console.warn(
      `${this.label} missing muzzle marker (${this.markerNames.join(', ')}); using fallback muzzle offset.`,
    );
  }
}

export function findNamedDescendant(
  root: Object3D,
  markerNames: readonly string[],
): Object3D | null {
  for (const markerName of markerNames) {
    const exactMatch = root.getObjectByName(markerName);
    if (exactMatch) {
      return exactMatch;
    }
  }

  for (const markerName of markerNames) {
    const normalizedName = markerName.toLowerCase();
    let match: Object3D | null = null;

    root.traverse((object) => {
      if (match || object.name.toLowerCase() !== normalizedName) {
        return;
      }

      match = object;
    });

    if (match) {
      return match;
    }
  }

  return null;
}

export function setCameraLocalPositionFromWorld(
  camera: Camera,
  worldPosition: Vector3,
  target: Object3D,
): void {
  target.position.copy(worldPosition);
  camera.worldToLocal(target.position);
}

export function setLocalPositionFromWorld(
  parent: Object3D,
  worldPosition: Vector3,
  target: Object3D,
): void {
  target.position.copy(worldPosition);
  parent.worldToLocal(target.position);
}
