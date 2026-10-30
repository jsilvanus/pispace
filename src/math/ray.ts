import type { Point3D, Ray3D, Plane3D } from '../types.js';
import { add, sub, scale, dot, normalize } from './vector3.js';

export function createRay(origin: Point3D, direction: Point3D): Ray3D {
  return {
    origin,
    direction: normalize(direction),
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
