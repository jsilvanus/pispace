import type {
  CameraMount,
  CameraFreeDTelemetry,
  BoundingBox2D,
  Point3D,
  Ray3D,
  CameraIntrinsics,
  CameraFrustum,
} from '../types.js';
import { degToRad, normalize, add, scale, sub } from '../math/vector3.js';
import {
  mat4FromFreeDEuler,
  mat4TransformDirection,
  mat4Multiply,
  mat4RotationZ,
  mat4RotationX,
  mat4RotationY,
} from '../math/matrix4.js';
import { createRay, intersectRayHorizontalPlane } from '../math/ray.js';
import { getCameraOptics, AVER_PTZ330_INTRINSICS } from './calibration.js';

export interface CameraPose {
  position: Point3D;
  panDeg: number;
  tiltDeg: number;
  rollDeg: number;
  hfovDeg: number;
  vfovDeg: number;
  focalLengthMm: number;
}

/**
 * Computes the total camera world pose from mount extrinsics and live FreeD telemetry.
 */
export function getCameraWorldPose(
  mount: CameraMount,
  telemetry: CameraFreeDTelemetry | null,
  intrinsics: CameraIntrinsics = AVER_PTZ330_INTRINSICS
): CameraPose {
  const pan = (mount.baseOrientation.pan + (telemetry?.pan ?? 0)) % 360;
  const tilt = mount.baseOrientation.tilt + (telemetry?.tilt ?? 0);
  const roll = mount.baseOrientation.roll + (telemetry?.roll ?? 0);

  const optics = getCameraOptics(telemetry?.zoom ?? 0, intrinsics);

  return {
    position: mount.position,
    panDeg: pan,
    tiltDeg: tilt,
    rollDeg: roll,
    hfovDeg: optics.hfovDeg,
    vfovDeg: optics.vfovDeg,
    focalLengthMm: optics.focalLengthMm,
  };
}

/**
 * Computes the 3D ray in venue world space for a given normalized image coordinate (u, v).
 * u = 0 (left) to 1 (right)
 * v = 0 (top) to 1 (bottom)
 */
export function castImageRay(
  pose: CameraPose,
  u: number,
  v: number
): Ray3D {
  // Normalized camera-frame coordinates
  const halfHfovRad = degToRad(pose.hfovDeg / 2);
  const halfVfovRad = degToRad(pose.vfovDeg / 2);

  // Offset from image center
  const tanX = (u - 0.5) * 2 * Math.tan(halfHfovRad);
  const tanY = (0.5 - v) * 2 * Math.tan(halfVfovRad);

  // Local camera forward vector (forward = +Y, right = +X, up = +Z)
  const localDir = normalize({
    x: tanX,
    y: 1.0,
    z: tanY,
  });

  // World rotation matrix for Camera
  const rZ = mat4RotationZ(degToRad(pose.panDeg));
  const rX = mat4RotationX(degToRad(pose.tiltDeg));
  const rY = mat4RotationY(degToRad(pose.rollDeg));
  const rotMatrix = mat4Multiply(rZ, mat4Multiply(rX, rY));

  const worldDir = mat4TransformDirection(rotMatrix, localDir);
  return createRay(pose.position, worldDir);
}

/**
 * Returns optical axis ray (center of frame u = 0.5, v = 0.5).
 */
export function castOpticalAxisRay(pose: CameraPose): Ray3D {
  return castImageRay(pose, 0.5, 0.5);
}

/**
 * Projects a 2D bounding box [ymin, xmin, ymax, xmax] onto a horizontal floor plane
 * at stageHeightMeters (default 0).
 * Uses the bottom-center of the bounding box as the subject's feet contact point.
 */
export function projectBoundingBoxToFloor(
  pose: CameraPose,
  bbox: BoundingBox2D,
  stageHeightMeters = 0
): { standingPosition: Point3D; feetRay: Ray3D; headRay: Ray3D } | null {
  const [ymin, xmin, ymax, xmax] = bbox;
  const feetU = (xmin + xmax) / 2;
  const feetV = ymax;

  const headU = feetU;
  const headV = ymin;

  const feetRay = castImageRay(pose, feetU, feetV);
  const headRay = castImageRay(pose, headU, headV);

  // Ray-plane intersection at subject's floor height
  const feetHit = intersectRayHorizontalPlane(feetRay, stageHeightMeters);
  if (!feetHit) {
    return null;
  }

  return {
    standingPosition: feetHit.point,
    feetRay,
    headRay,
  };
}

/**
 * Computes camera frustum and optical target intersection.
 */
export function computeCameraFrustum(
  pose: CameraPose,
  referenceFloorHeight = 0
): CameraFrustum {
  const axisRay = castOpticalAxisRay(pose);
  const hit = intersectRayHorizontalPlane(axisRay, referenceFloorHeight);

  return {
    opticalAxis: axisRay.direction,
    targetIntersection: hit ? hit.point : null,
    hfovDeg: pose.hfovDeg,
    vfovDeg: pose.vfovDeg,
    focalLengthMm: pose.focalLengthMm,
    activeZoneId: null,
  };
}
