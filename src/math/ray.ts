import type { Point3D, Ray3D, Plane3D } from '../types.js';
import { add, sub, scale, dot, normalize } from './vector3.js';

export function createRay(origin: Point3D, direction: Point3D): Ray3D {
  return {
    origin,
    direction: normalize(direction),
  };
}

export interface RayTriangulationResult {
  point: Point3D;
  errorMeters: number;
  t1: number;
  t2: number;
  closestPoint1: Point3D;
  closestPoint2: Point3D;
  isBehindCamera: boolean;
  isParallel: boolean;
}

/**
 * Triangulates two 3D rays by finding the line segment of closest approach (skew line intersection).
 * Returns the midpoint of closest approach as the triangulated 3D point, plus the residual error distance.
 * Returns null if the rays are parallel or nearly collinear.
 */
export function triangulateRays(ray1: Ray3D, ray2: Ray3D, eps = 1e-6): RayTriangulationResult | null {
  const u = ray1.direction;
  const v = ray2.direction;
  const w0 = sub(ray1.origin, ray2.origin);

  const a = dot(u, u);
  const b = dot(u, v);
  const c = dot(v, v);
  const d = dot(u, w0);
  const e = dot(v, w0);

  const denom = a * c - b * b;
  if (Math.abs(denom) < eps) {
    return null;
  }

  const t1 = (b * e - c * d) / denom;
  const t2 = (a * e - b * d) / denom;

  const p1 = rayPointAt(ray1, t1);
  const p2 = rayPointAt(ray2, t2);

  const midpoint: Point3D = {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
    z: (p1.z + p2.z) / 2,
  };

  const diff = sub(p1, p2);
  const errorMeters = Math.sqrt(dot(diff, diff));

  return {
    point: midpoint,
    errorMeters,
    t1,
    t2,
    closestPoint1: p1,
    closestPoint2: p2,
    isBehindCamera: t1 < 0 || t2 < 0,
    isParallel: false,
  };
}

export function rayPointAt(ray: Ray3D, t: number): Point3D {
  return add(ray.origin, scale(ray.direction, t));
}

/**
 * Intersects a ray with an arbitrary 3D plane.
 * Returns null if the ray is parallel to the plane or points away from it (t < 0).
 */
export function intersectRayPlane(ray: Ray3D, plane: Plane3D, eps = 1e-7): { point: Point3D; t: number } | null {
  const denom = dot(ray.direction, plane.normal);
  if (Math.abs(denom) < eps) {
    return null; // Parallel
  }

  const t = dot(sub(plane.point, ray.origin), plane.normal) / denom;
  if (t < 0) {
    return null; // Behind ray
  }

  return {
    point: rayPointAt(ray, t),
    t,
  };
}

/**
 * Intersects a ray with a horizontal floor/stage plane at z = heightMeters.
 * Normal is (0, 0, 1).
 */
export function intersectRayHorizontalPlane(ray: Ray3D, heightMeters: number, eps = 1e-7): { point: Point3D; t: number } | null {
  const plane: Plane3D = {
    point: { x: 0, y: 0, z: heightMeters },
    normal: { x: 0, y: 0, z: 1 },
  };
  return intersectRayPlane(ray, plane, eps);
}
