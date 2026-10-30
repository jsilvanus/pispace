import type { Point3D } from '../types.js';

export function vec3(x = 0, y = 0, z = 0): Point3D {
  return { x, y, z };
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function add(a: Point3D, b: Point3D): Point3D {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(v: Point3D, s: number): Point3D {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Point3D, b: Point3D): Point3D {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthSq(v: Point3D): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

export function length(v: Point3D): number {
  return Math.sqrt(lengthSq(v));
}

export function normalize(v: Point3D): Point3D {
  const len = length(v);
  if (len === 0 || Math.abs(len) < 1e-12) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function distance(a: Point3D, b: Point3D): number {
  return length(sub(a, b));
}

export function distanceSq(a: Point3D, b: Point3D): number {
  return lengthSq(sub(a, b));
}

export function lerp(a: Point3D, b: Point3D, t: number): Point3D {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function equals(a: Point3D, b: Point3D, eps = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.z - b.z) <= eps
  );
}
