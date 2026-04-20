import {
  Camera,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import type { GameConfig, GameStateType, RideState } from '../../core/types';
import { approach } from '../../core/utils';

export class VehicleRigSystem {
  private readonly vehicleRig = new Group();
  private readonly obstructionShakeGroup = new Group();
  private readonly vehicleSpace = new Group();
  private readonly modelRoot = new Group();
  private readonly seatPivot = new Group();
  private readonly cameraYaw = new Group();
  private readonly cameraPitch = new Group();
  private readonly sidecarLatchAnchor = new Group();
  private readonly baseRigOffset = new Vector3();
  private readonly baseModelPosition = new Vector3();
  private readonly baseModelRotation = new Vector3();
  private readonly baseSeatPivotPosition = new Vector3();
  private readonly baseCameraOffset = new Vector3();
  private readonly lookDownReveal = new Vector3();
  private readonly baseLatchPosition = new Vector3();
  private loadedScene: Object3D | null = null;
  private time = 0;
  private hitShake = 0;
  private lastHitFlash = 0;

  constructor(
    private readonly camera: Camera,
    private readonly config: GameConfig,
  ) {
    const rig = this.config.vehicle.stage1Rig;

    this.vehicleRig.name = 'VehicleRig';
    this.obstructionShakeGroup.name = 'VehicleObstructionShake';
    this.vehicleSpace.name = 'VehicleSpace';
    this.modelRoot.name = 'VehicleModelRoot';
    this.seatPivot.name = 'VehicleSeatPivot';
    this.cameraYaw.name = 'VehicleCameraYaw';
    this.cameraPitch.name = 'VehicleCameraPitch';

    this.baseRigOffset.set(...rig.position);
    this.baseModelPosition.set(...rig.modelPosition);
    this.baseModelRotation.set(
      MathUtils.degToRad(rig.modelRotationDegrees[0]),
      MathUtils.degToRad(rig.modelRotationDegrees[1]),
      MathUtils.degToRad(rig.modelRotationDegrees[2]),
    );
    this.baseSeatPivotPosition.set(...rig.seatPivotPosition);
    this.baseCameraOffset.set(...rig.cameraOffset);
    this.lookDownReveal.set(...rig.lookDownReveal);
    this.baseLatchPosition.set(...rig.sidecarLatchPosition);

    this.seatPivot.position.copy(this.baseSeatPivotPosition);
    this.cameraYaw.position.copy(this.baseCameraOffset);
    this.sidecarLatchAnchor.position.copy(this.baseLatchPosition);

    this.vehicleSpace.add(this.modelRoot, this.seatPivot, this.sidecarLatchAnchor);
    this.seatPivot.add(this.cameraYaw);
    this.cameraYaw.add(this.cameraPitch);
    this.obstructionShakeGroup.add(this.vehicleSpace);
    this.vehicleRig.add(this.obstructionShakeGroup);

    this.camera.parent?.add(this.vehicleRig);
    this.cameraPitch.add(this.camera);
    this.reset();
    void this.loadVehicleModel();
  }

  getCameraYawPivot(): Object3D {
    return this.cameraYaw;
  }

  getCameraPitchPivot(): Object3D {
    return this.cameraPitch;
  }

  getSidecarLatchAnchor(): Object3D {
    return this.sidecarLatchAnchor;
  }

  reset(): void {
    this.time = 0;
    this.hitShake = 0;
    this.lastHitFlash = 0;
    this.vehicleRig.position.set(0, 0, 0);
    this.vehicleRig.rotation.set(0, 0, 0);
    this.obstructionShakeGroup.position.set(0, 0, 0);
    this.obstructionShakeGroup.rotation.set(0, 0, 0);
    this.vehicleSpace.position.set(0, 0, 0);
    this.vehicleSpace.rotation.set(0, 0, 0);
    this.seatPivot.position.copy(this.baseSeatPivotPosition);
    this.seatPivot.rotation.set(0, 0, 0);
    this.cameraYaw.position.copy(this.baseCameraOffset);
    this.cameraYaw.rotation.set(0, 0, 0);
    this.cameraPitch.rotation.set(0, 0, 0);
    this.modelRoot.position.copy(this.baseModelPosition);
    this.modelRoot.rotation.set(
      this.baseModelRotation.x,
      this.baseModelRotation.y,
      this.baseModelRotation.z,
    );
    this.sidecarLatchAnchor.position.copy(this.baseLatchPosition);
    this.sidecarLatchAnchor.rotation.set(0, 0, 0);
    this.vehicleRig.visible = true;
  }

  update(
    deltaTime: number,
    playerPosition: Vector3,
    turnAmount: number,
    hitFlash: number,
    gameState: GameStateType,
    ride: RideState | null = null,
  ): void {
    const rig = this.config.vehicle.stage1Rig;
    this.time += deltaTime;
    const running = gameState === 'running';
    const lookDown = MathUtils.clamp(this.cameraPitch.rotation.x, 0, MathUtils.degToRad(40));
    const lookDownAlpha = lookDown / MathUtils.degToRad(40);
    const turnSign = Math.abs(this.camera.rotation.z) > 0.001 ? -Math.sign(this.camera.rotation.z) : 0;
    const laneDirection = ride ? Math.sign(ride.targetLaneIndex - ride.laneIndex) : 0;
    const laneTravel = ride ? Math.sin(ride.laneChangeAlpha * Math.PI) : 0;
    const rideShake = ride?.cameraShake ?? 0;
    const latchShake = ride?.latchActive ? rig.latchShakeAmplitude : 0;
    const failureShake = (ride?.failureSeverity ?? 0) * rig.failureShakeAmplitude;
    const laneCutJolt = ride?.laneCutJolt ?? 0;
    const potholeJolt = ride?.potholeJolt ?? 0;
    const barrelJolt = ride?.barrelJolt ?? 0;

    this.vehicleRig.position.copy(playerPosition).add(this.baseRigOffset);

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
      Math.cos(this.time * (rig.swayFrequency * 1.11)) * rig.swayAmplitude[1] * swayAlpha;
    const swayZ =
      Math.sin(this.time * (rig.swayFrequency * 0.75)) * rig.swayAmplitude[2] * swayAlpha;
    const vibration =
      Math.sin(this.time * rig.vibrationFrequency) * rig.vibrationAmplitude * swayAlpha;
    const turnShift = turnSign * turnAmount * rig.turnShift;
    const turnRoll = MathUtils.degToRad(rig.turnRollDegrees) * turnSign * turnAmount;
    const laneShift = laneDirection * laneTravel * rig.laneShift;
    const laneRoll = MathUtils.degToRad(rig.laneRollDegrees) * laneDirection * laneTravel;
    const cutOvershoot = laneDirection * laneCutJolt * 0.12;
    const wheelHop = Math.sin(this.time * 28) * potholeJolt * 0.08;
    const slamRoll = Math.sin(this.time * 20) * barrelJolt * 0.05;

    // The whole vehicle and seat move together as one ride space, so the model
    // feels seated/world-attached while the FPS weapon remains a separate child
    // of the camera itself.
    this.vehicleSpace.position.set(
      swayX + turnShift + vibration * 0.65 + laneShift + cutOvershoot,
      swayY + vibration * 0.45 + rideShake * 0.3 + wheelHop,
      swayZ,
    );
    this.vehicleSpace.rotation.set(
      vibration * 0.06 + rideShake * 0.18 + wheelHop * 0.4,
      -turnShift * 0.08 + laneShift * 0.18 + cutOvershoot * 0.45,
      turnRoll + laneRoll + vibration * 0.12 + slamRoll,
    );

    this.cameraYaw.position.set(
      this.baseCameraOffset.x + this.lookDownReveal.x * lookDownAlpha,
      this.baseCameraOffset.y + this.lookDownReveal.y * lookDownAlpha,
      this.baseCameraOffset.z + this.lookDownReveal.z * lookDownAlpha,
    );
    this.sidecarLatchAnchor.position.set(
      this.baseLatchPosition.x + laneShift * 0.6,
      this.baseLatchPosition.y + rideShake * 0.12,
      this.baseLatchPosition.z,
    );

    const shakeNoiseA = Math.sin(this.time * 42.0);
    const shakeNoiseB = Math.cos(this.time * 37.0);
    const shakeNoiseC = Math.sin(this.time * 29.0);
    const totalShake =
      this.hitShake +
      latchShake +
      failureShake +
      rideShake +
      potholeJolt * 0.04 +
      barrelJolt * 0.05;
    this.obstructionShakeGroup.position.set(
      shakeNoiseA * totalShake,
      shakeNoiseB * totalShake * 0.65,
      0,
    );
    this.obstructionShakeGroup.rotation.set(
      shakeNoiseB * totalShake * 0.18,
      shakeNoiseC * totalShake * 0.1,
      shakeNoiseA * totalShake * 0.2,
    );
  }

  destroy(): void {
    this.vehicleRig.removeFromParent();
    this.disposeObject(this.loadedScene);
  }

  private async loadVehicleModel(): Promise<void> {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();

      try {
        const gltf = await loader.loadAsync(this.config.vehicle.stage1Rig.assetPath);
        this.mountModel(gltf.scene);
        return;
      } catch (primaryError) {
        console.warn('Failed to load textured sidecar GLB, trying fallback.', primaryError);
      }

      const fallback = await loader.loadAsync(this.config.vehicle.stage1Rig.fallbackAssetPath);
      this.mountModel(fallback.scene);
    } catch (error) {
      console.warn('Failed to load sidecar GLBs.', error);
    }
  }

  private mountModel(model: Object3D): void {
    if (this.loadedScene) {
      this.modelRoot.remove(this.loadedScene);
      this.disposeObject(this.loadedScene);
    }

    this.prepareModel(model);
    model.position.copy(this.baseModelPosition);
    model.rotation.set(
      this.baseModelRotation.x,
      this.baseModelRotation.y,
      this.baseModelRotation.z,
    );
    model.scale.setScalar(this.config.vehicle.stage1Rig.modelScale);
    this.modelRoot.add(model);
    this.loadedScene = model;
  }

  private prepareModel(model: Object3D): void {
    model.traverse((object) => {
      object.frustumCulled = false;

      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.renderOrder = 1;
      maybeMesh.castShadow = false;
      maybeMesh.receiveShadow = false;
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];
      for (const material of materials) {
        const litMaterial = material as Partial<MeshStandardMaterial>;
        if (typeof litMaterial.roughness === 'number') {
          litMaterial.roughness = Math.max(litMaterial.roughness, 0.88);
        }
      }
    });
  }

  private disposeObject(root: Object3D | null): void {
    if (!root) {
      return;
    }

    root.traverse((object) => {
      const maybeMesh = object as Mesh;
      if (!maybeMesh.isMesh) {
        return;
      }

      maybeMesh.geometry.dispose();
      const materials = Array.isArray(maybeMesh.material)
        ? maybeMesh.material
        : [maybeMesh.material];
      for (const material of materials) {
        material.dispose();
      }
    });
  }
}
