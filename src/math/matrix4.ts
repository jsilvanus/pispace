import type { Point3D } from '../types.js';
import { degToRad } from './vector3.js';

/**
 * 4x4 matrix stored in row-major order:
 * [ m00, m01, m02, m03,
 *   m10, m11, m12, m13,
 *   m20, m21, m22, m23,
 *   m30, m31, m32, m33 ]
 */
export type Matrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export function mat4Identity(): Matrix4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
}

export function mat4Multiply(a: Matrix4, b: Matrix4): Matrix4 {
  const out: number[] = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[r * 4 + k]! * b[k * 4 + c]!;
      }
      out[r * 4 + c] = sum;
    }
  }
  return out as Matrix4;
}

export function mat4Translation(tx: number, ty: number, tz: number): Matrix4 {
  return [
    1, 0, 0, tx,
    0, 1, 0, ty,
    0, 0, 1, tz,
    0, 0, 0, 1,
  ];
}

/**
 * Rotation around Z axis (Pan).
 */
export function mat4RotationZ(rad: number): Matrix4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    c, -s, 0, 0,
    s,  c, 0, 0,
    0,  0, 1, 0,
    0,  0, 0, 1,
  ];
}

/**
 * Rotation around X axis (Pitch / Tilt).
 */
export function mat4RotationX(rad: number): Matrix4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    1, 0,  0, 0,
    0, c, -s, 0,
    0, s,  c, 0,
    0, 0,  0, 1,
  ];
}

/**
 * Rotation around Y axis (Roll).
 */
export function mat4RotationY(rad: number): Matrix4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
     c, 0, s, 0,
     0, 1, 0, 0,
    -s, 0, c, 0,
     0, 0, 0, 1,
  ];
}

/**
 * FreeD Euler angles to Rotation Matrix.
 * FreeD uses Z-X'-Y'' (Pan then Tilt then Roll).
 */
export function mat4FromFreeDEuler(panDeg: number, tiltDeg: number, rollDeg: number): Matrix4 {
  const rZ = mat4RotationZ(degToRad(panDeg));
  const rX = mat4RotationX(degToRad(tiltDeg));
  const rY = mat4RotationY(degToRad(rollDeg));
  return mat4Multiply(rZ, mat4Multiply(rX, rY));
}

export function mat4TransformPoint(m: Matrix4, p: Point3D): Point3D {
  const w = m[12] * p.x + m[13] * p.y + m[14] * p.z + m[15];
  const invW = Math.abs(w) > 1e-12 ? 1 / w : 1;
  return {
    x: (m[0] * p.x + m[1] * p.y + m[2] * p.z + m[3]) * invW,
    y: (m[4] * p.x + m[5] * p.y + m[6] * p.z + m[7]) * invW,
    z: (m[8] * p.x + m[9] * p.y + m[10] * p.z + m[11]) * invW,
  };
}

export function mat4TransformDirection(m: Matrix4, d: Point3D): Point3D {
  return {
    x: m[0] * d.x + m[1] * d.y + m[2] * d.z,
    y: m[4] * d.x + m[5] * d.y + m[6] * d.z,
    z: m[8] * d.x + m[9] * d.y + m[10] * d.z,
  };
}
