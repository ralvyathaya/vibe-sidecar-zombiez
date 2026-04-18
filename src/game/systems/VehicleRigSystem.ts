import {
  BoxGeometry,
  Camera,
  CylinderGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { GameConfig, GameStateType } from '../../core/types';
import { approach } from '../../core/utils';

const BIKE_BODY_GEOMETRY = new BoxGeometry(0.42, 0.18, 0.7);
const BIKE_COWL_GEOMETRY = new BoxGeometry(0.3, 0.14, 0.28);
const HANDLEBAR_GEOMETRY = new BoxGeometry(0.36, 0.03, 0.03);
const SHOULDER_GEOMETRY = new BoxGeometry(0.28, 0.16, 0.18);
const HEAD_GEOMETRY = new SphereGeometry(0.08, 8, 8);
const RAIL_GEOMETRY = new CylinderGeometry(0.014, 0.014, 1, 8);
const WINDSHIELD_GEOMETRY = new BoxGeometry(0.24, 0.16, 0.02);

export class VehicleRigSystem {
  private readonly vehicleRig = new Group();
  private readonly obstructionShakeGroup = new Group();
  private readonly vehicleSpace = new Group();
  private readonly seatPivot = new Group();
  private readonly leftBikeGroup = new Group();
  private readonly rightSidecarGroup = new Group();
  private readonly bikeMaterial: MeshStandardMaterial;
  private readonly bikeAccentMaterial: MeshStandardMaterial;
  private readonly buddyMaterial: MeshStandardMaterial;
  private readonly railMaterial: MeshStandardMaterial;
  private readonly railAccentMaterial: MeshStandardMaterial;
  private readonly windshieldMaterial: MeshBasicMaterial;
  private time = 0;
  private hitShake = 0;
  private lastHitFlash = 0;

  constructor(
    private readonly camera: Camera,
    private readonly config: GameConfig,
  ) {
    this.bikeMaterial = this.createMatteMaterial(this.config.vehicle.stage1Rig.bikeColor);
    this.bikeAccentMaterial = this.createMatteMaterial(this.config.vehicle.stage1Rig.bikeAccentColor);
    this.buddyMaterial = this.createMatteMaterial(this.config.vehicle.stage1Rig.buddyColor);
    this.railMaterial = this.createMatteMaterial(this.config.vehicle.stage1Rig.railColor);
    this.railAccentMaterial = this.createMatteMaterial(this.config.vehicle.stage1Rig.railAccentColor);
    this.windshieldMaterial = new MeshBasicMaterial({
      color: this.config.vehicle.stage1Rig.windshieldColor,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });

    this.vehicleRig.name = 'VehicleRig';
    this.vehicleSpace.name = 'VehicleSpace';
    this.seatPivot.name = 'VehicleSeatPivot';
    this.obstructionShakeGroup.name = 'VehicleObstructionShake';
    this.leftBikeGroup.name = 'VehicleLeftBike';
    this.rightSidecarGroup.name = 'VehicleRightSidecar';

    this.vehicleRig.scale.setScalar(this.config.vehicle.stage1Rig.scale);
    this.leftBikeGroup.position.set(...this.config.vehicle.stage1Rig.leftBikeOffset);
    this.rightSidecarGroup.position.set(...this.config.vehicle.stage1Rig.rightRailOffset);

    this.buildLeftBikePresence();
    this.buildRightSidecarPresence();

    this.vehicleSpace.add(this.leftBikeGroup, this.rightSidecarGroup, this.seatPivot);
    this.obstructionShakeGroup.add(this.vehicleSpace);
    this.vehicleRig.add(this.obstructionShakeGroup);
    this.camera.parent?.add(this.vehicleRig);
    this.seatPivot.add(this.camera);
    this.reset();
  }

  reset(): void {
    this.time = 0;
    this.hitShake = 0;
    this.lastHitFlash = 0;
    this.vehicleRig.position.set(0, 0, 0);
    this.vehicleRig.rotation.set(0, 0, 0);
    this.vehicleSpace.position.set(...this.config.vehicle.stage1Rig.position);
    this.vehicleSpace.rotation.set(0, 0, 0);
    this.seatPivot.position.set(0, 0, 0);
    this.seatPivot.rotation.set(0, 0, 0);
    this.obstructionShakeGroup.position.set(0, 0, 0);
    this.obstructionShakeGroup.rotation.set(0, 0, 0);
    this.vehicleRig.visible = true;
  }

  update(
    deltaTime: number,
    playerPosition: Vector3,
    turnAmount: number,
    hitFlash: number,
    gameState: GameStateType,
  ): void {
    this.time += deltaTime;
    const rig = this.config.vehicle.stage1Rig;
    const turnSign = Math.abs(this.camera.rotation.z) > 0.001 ? Math.sign(this.camera.rotation.z) : 0;
    const running = gameState === 'running';

    this.vehicleRig.position.copy(playerPosition);

    if (hitFlash > this.lastHitFlash + 0.18) {
      this.hitShake = Math.min(
        1,
        this.hitShake + rig.damageShakeAmplitude + hitFlash * rig.damageShakeAmplitude,
      );
    }
    this.lastHitFlash = hitFlash;
    this.hitShake = approach(this.hitShake, 0, deltaTime * rig.damageShakeDecay);

    const swayAlpha = running ? 1 : 0.2;
    const swayX = Math.sin(this.time * rig.swayFrequency) * rig.swayAmplitude[0] * swayAlpha;
    const swayY =
      Math.cos(this.time * (rig.swayFrequency * 1.17)) * rig.swayAmplitude[1] * swayAlpha;
    const swayZ =
      Math.sin(this.time * (rig.swayFrequency * 0.72)) * rig.swayAmplitude[2] * swayAlpha;
    const vibration =
      Math.sin(this.time * rig.vibrationFrequency) * rig.vibrationAmplitude * swayAlpha;
    const turnShift = turnSign * turnAmount * rig.turnShift;
    const turnRoll = MathUtils.degToRad(rig.turnRollDegrees) * turnSign * turnAmount;

    this.vehicleSpace.position.set(...rig.position);
    this.vehicleSpace.rotation.set(0, 0, 0);

    // Seat pivot owns the calm ride motion while the left/right anchors remain
    // in the same vehicle space, so looking around reveals them naturally.
    this.seatPivot.position.set(
      swayX + turnShift + vibration * 0.8,
      swayY + vibration * 0.55,
      swayZ,
    );
    this.seatPivot.rotation.set(
      vibration * 0.08,
      -turnShift * 0.18,
      turnRoll + vibration * 0.22,
    );

    const shakeNoiseA = Math.sin(this.time * 42.0);
    const shakeNoiseB = Math.cos(this.time * 37.0);
    const shakeNoiseC = Math.sin(this.time * 29.0);
    this.obstructionShakeGroup.position.set(
      shakeNoiseA * this.hitShake,
      shakeNoiseB * this.hitShake * 0.65,
      0,
    );
    this.obstructionShakeGroup.rotation.set(
      shakeNoiseB * this.hitShake * 0.22,
      shakeNoiseC * this.hitShake * 0.14,
      shakeNoiseA * this.hitShake * 0.28,
    );
  }

  destroy(): void {
    this.vehicleRig.removeFromParent();
    this.disposeGroup(this.vehicleRig);
    this.bikeMaterial.dispose();
    this.bikeAccentMaterial.dispose();
    this.buddyMaterial.dispose();
    this.railMaterial.dispose();
    this.railAccentMaterial.dispose();
    this.windshieldMaterial.dispose();
  }

  private buildLeftBikePresence(): void {
    const tank = this.makeMesh(BIKE_BODY_GEOMETRY, this.bikeMaterial);
    tank.position.set(0.2, 0.08, 0.08);
    tank.rotation.set(MathUtils.degToRad(8), MathUtils.degToRad(18), MathUtils.degToRad(-4));
    tank.scale.set(0.95, 1, 1);

    const cowl = this.makeMesh(BIKE_COWL_GEOMETRY, this.bikeAccentMaterial);
    cowl.position.set(-0.06, 0.02, -0.26);
    cowl.rotation.set(MathUtils.degToRad(12), MathUtils.degToRad(12), MathUtils.degToRad(-6));

    const leftFork = this.makeRailSegment(0.46, this.bikeAccentMaterial);
    leftFork.position.set(-0.14, -0.15, -0.16);
    leftFork.rotation.z = MathUtils.degToRad(12);

    const rightFork = this.makeRailSegment(0.4, this.bikeAccentMaterial);
    rightFork.position.set(-0.03, -0.14, -0.12);
    rightFork.rotation.z = MathUtils.degToRad(9);

    const handlebar = this.makeMesh(HANDLEBAR_GEOMETRY, this.bikeAccentMaterial);
    handlebar.position.set(-0.05, 0.12, -0.08);
    handlebar.rotation.set(0, MathUtils.degToRad(18), MathUtils.degToRad(12));

    const shoulder = this.makeMesh(SHOULDER_GEOMETRY, this.buddyMaterial);
    shoulder.position.set(0.46, 0.2, 0.3);
    shoulder.rotation.set(0, MathUtils.degToRad(22), MathUtils.degToRad(-8));

    const head = this.makeMesh(HEAD_GEOMETRY, this.buddyMaterial);
    head.position.set(0.55, 0.36, 0.32);
    head.scale.set(0.9, 1.05, 0.88);

    this.leftBikeGroup.add(tank, cowl, leftFork, rightFork, handlebar, shoulder, head);
    this.leftBikeGroup.rotation.set(0, MathUtils.degToRad(10), 0);
  }

  private buildRightSidecarPresence(): void {
    const upperRail = this.makeRailSegment(0.82, this.railMaterial);
    upperRail.position.set(-0.04, 0.18, -0.02);
    upperRail.rotation.z = MathUtils.degToRad(90);
    upperRail.rotation.y = MathUtils.degToRad(12);

    const lowerRail = this.makeRailSegment(0.94, this.railAccentMaterial);
    lowerRail.position.set(0.06, -0.02, 0.08);
    lowerRail.rotation.z = MathUtils.degToRad(90);
    lowerRail.rotation.y = MathUtils.degToRad(6);

    const frontRail = this.makeRailSegment(0.5, this.railMaterial);
    frontRail.position.set(-0.3, 0.1, -0.28);
    frontRail.rotation.z = MathUtils.degToRad(34);
    frontRail.rotation.x = MathUtils.degToRad(8);

    const rearRail = this.makeRailSegment(0.44, this.railAccentMaterial);
    rearRail.position.set(0.26, 0.06, 0.2);
    rearRail.rotation.z = MathUtils.degToRad(-20);
    rearRail.rotation.x = MathUtils.degToRad(-4);

    const windshield = this.makeMesh(WINDSHIELD_GEOMETRY, this.windshieldMaterial);
    windshield.position.set(-0.2, 0.16, -0.19);
    windshield.rotation.set(MathUtils.degToRad(24), MathUtils.degToRad(-8), MathUtils.degToRad(14));

    this.rightSidecarGroup.add(upperRail, lowerRail, frontRail, rearRail, windshield);
    this.rightSidecarGroup.rotation.set(MathUtils.degToRad(2), MathUtils.degToRad(-8), 0);
  }

  private makeRailSegment(length: number, material: MeshStandardMaterial): Mesh {
    const rail = this.makeMesh(RAIL_GEOMETRY, material);
    rail.scale.y = length;
    return rail;
  }

  private makeMesh(
    geometry: BoxGeometry | CylinderGeometry | SphereGeometry,
    material: MeshStandardMaterial | MeshBasicMaterial,
  ): Mesh {
    const mesh = new Mesh(geometry.clone(), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  private createMatteMaterial(color: number): MeshStandardMaterial {
    return new MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: 0.98,
      metalness: 0.02,
    });
  }

  private disposeGroup(root: Group): void {
    root.traverse((object) => {
      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.geometry.dispose();
    });
  }
}
