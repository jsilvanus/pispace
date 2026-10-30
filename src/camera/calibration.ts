import type { CameraIntrinsics } from '../types.js';
import { radToDeg, degToRad } from '../math/vector3.js';

export const AVER_PTZ330_INTRINSICS: CameraIntrinsics = {
  sensorWidthMm: 5.16,
  sensorHeightMm: 2.90,
  focalLengthWideMm: 4.3,
  focalLengthTeleMm: 129.0,
  minHfovDeg: 2.3,
  maxHfovDeg: 67.0,
  maxRawZoom: 16777215, // 24-bit FreeD position
};

/**
 * Maps raw FreeD zoom (0 to maxRawZoom) to optical focal length in mm.
 * Zoom curve in PTZ lenses is exponential (logarithmic optical step).
 */
export function rawZoomToFocalLength(
  rawZoom: number,
  intrinsics: CameraIntrinsics = AVER_PTZ330_INTRINSICS
): number {
  const normZoom = Math.max(0, Math.min(1, rawZoom / intrinsics.maxRawZoom));
  // Exponential zoom interpolation: f = f_wide * (f_tele / f_wide)^normZoom
  const ratio = intrinsics.focalLengthTeleMm / intrinsics.focalLengthWideMm;
  return intrinsics.focalLengthWideMm * Math.pow(ratio, normZoom);
}

/**
 * Calculates focal length in mm from raw FreeD zoom or normalized zoom.
 */
export function focalLengthToRawZoom(
  focalLengthMm: number,
  intrinsics: CameraIntrinsics = AVER_PTZ330_INTRINSICS
): number {
  const clampedF = Math.max(
    intrinsics.focalLengthWideMm,
    Math.min(intrinsics.focalLengthTeleMm, focalLengthMm)
  );
  const ratio = intrinsics.focalLengthTeleMm / intrinsics.focalLengthWideMm;
  const normZoom = Math.log(clampedF / intrinsics.focalLengthWideMm) / Math.log(ratio);
  return Math.round(normZoom * intrinsics.maxRawZoom);
}

/**
 * Computes Horizontal Field of View (HFOV) from focal length and sensor width.
 */
export function focalLengthToHfov(
  focalLengthMm: number,
  sensorWidthMm = AVER_PTZ330_INTRINSICS.sensorWidthMm
): number {
  return radToDeg(2 * Math.atan(sensorWidthMm / (2 * focalLengthMm)));
}

/**
 * Computes Vertical Field of View (VFOV) from focal length and sensor height.
 */
export function focalLengthToVfov(
  focalLengthMm: number,
  sensorHeightMm = AVER_PTZ330_INTRINSICS.sensorHeightMm
): number {
  return radToDeg(2 * Math.atan(sensorHeightMm / (2 * focalLengthMm)));
}

/**
 * Resolves camera optical parameters from a FreeD zoom reading.
 */
export function getCameraOptics(
  rawZoom: number,
  intrinsics: CameraIntrinsics = AVER_PTZ330_INTRINSICS
): { hfovDeg: number; vfovDeg: number; focalLengthMm: number } {
  const focalLengthMm = rawZoomToFocalLength(rawZoom, intrinsics);
  const hfovDeg = focalLengthToHfov(focalLengthMm, intrinsics.sensorWidthMm);
  const vfovDeg = focalLengthToVfov(focalLengthMm, intrinsics.sensorHeightMm);
  return { hfovDeg, vfovDeg, focalLengthMm };
}
