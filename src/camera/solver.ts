import type {
  CameraMount,
  Point3D,
  ShotType,
  PtzSolution,
  CameraIntrinsics,
} from '../types.js';
import { radToDeg, distance } from '../math/vector3.js';
import {
  AVER_PTZ330_INTRINSICS,
  focalLengthToRawZoom,
  focalLengthToHfov,
} from './calibration.js';

export interface FramingTargetOptions {
  shotType?: ShotType | undefined;
  /** Estimated target subject height in meters (default 1.8m) */
  subjectHeightMeters?: number | undefined;
  targetZoneId?: string | null | undefined;
}

const DESIRED_FRAME_HEIGHTS: Record<ShotType, number> = {
  wide: 8.0,      // Full altar/stage overview
  medium: 2.8,    // Waist-up speaker with comfortable headroom
  close_up: 1.2,  // Head and shoulders portrait
  tight: 0.6,     // Tight face shot
};

/**
 * Solves the inverse kinematics for a PTZ camera:
 * Given camera mount and 3D target coordinate, computes the exact Pan, Tilt, and Zoom.
 */
export function solvePtzForTarget(
  mount: CameraMount,
  targetPoint: Point3D,
  options: FramingTargetOptions = {},
  intrinsics: CameraIntrinsics = AVER_PTZ330_INTRINSICS
): PtzSolution {
  const shotType: ShotType = options.shotType ?? 'medium';
  const camPos = mount.position;

  const dx = targetPoint.x - camPos.x;
  const dy = targetPoint.y - camPos.y;
  const dz = targetPoint.z - camPos.z;

  const distHoriz = Math.sqrt(dx * dx + dy * dy);
  const dist3D = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Pan: angle around Z axis. Forward is +Y.
  // Rotated forward vector is (-sin(pan), cos(pan)).
  // Therefore, tan(pan) = -dx / dy => pan = atan2(-dx, dy)
  const worldPanDeg = radToDeg(Math.atan2(-dx, dy));

  // Tilt: angle above/below horizontal plane.
  const worldTiltDeg = radToDeg(Math.atan2(dz, Math.max(1e-6, distHoriz)));

  // Subtract mount's base orientation to get camera-local pan/tilt
  let localPan = worldPanDeg - mount.baseOrientation.pan;
  // Normalize local pan to -180..+180
  while (localPan > 180) localPan -= 360;
  while (localPan < -180) localPan += 360;

  const localTilt = worldTiltDeg - mount.baseOrientation.tilt;

  // Compute required zoom based on desired frame height at distance dist3D
  const frameHeight = DESIRED_FRAME_HEIGHTS[shotType];
  const requiredVfovRad = 2 * Math.atan(frameHeight / (2 * Math.max(1.0, dist3D)));
  
  // Focal length required for this VFOV: f = sensorHeight / (2 * tan(VFOV / 2))
  const requiredFocalLengthMm = intrinsics.sensorHeightMm / (2 * Math.tan(requiredVfovRad / 2));
  
  const rawZoom = focalLengthToRawZoom(requiredFocalLengthMm, intrinsics);
  const estimatedHfovDeg = focalLengthToHfov(requiredFocalLengthMm, intrinsics.sensorWidthMm);

  let roundedPan = Math.round(localPan * 10) / 10;
  if (Object.is(roundedPan, -0) || Math.abs(roundedPan) < 1e-6) roundedPan = 0;

  let roundedTilt = Math.round(localTilt * 10) / 10;
  if (Object.is(roundedTilt, -0) || Math.abs(roundedTilt) < 1e-6) roundedTilt = 0;

  return {
    cameraId: mount.id,
    targetPoint,
    targetZoneId: options.targetZoneId ?? null,
    distanceMeters: Math.round(dist3D * 100) / 100,
    pan: roundedPan,
    tilt: roundedTilt,
    zoom: rawZoom,
    estimatedHfovDeg: Math.round(estimatedHfovDeg * 10) / 10,
    shotType,
  };
}
