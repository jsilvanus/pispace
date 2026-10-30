import type { Point2D, Point3D, SpatialZone } from '../types.js';

/**
 * Standard ray-casting (even-odd rule) algorithm to test if a 2D point is inside a polygon.
 */
export function pointInPolygon2D(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const { x, y } = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;

    const intersect =
      pi.y > y !== pj.y > y &&
      x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Checks if a 3D coordinate is inside a spatial zone (extruded polygonal prism).
 */
export function pointInSpatialZone(point: Point3D, zone: SpatialZone): boolean {
  // Height check
  if (point.z < zone.floorHeight || point.z > zone.ceilingHeight) {
    return false;
  }

  // 2D horizontal plane check
  return pointInPolygon2D({ x: point.x, y: point.y }, zone.polygon);
}

/**
 * Calculates the horizontal 2D centroid of a polygon.
 */
export function polygonCentroid(polygon: Point2D[]): Point2D {
  if (polygon.length === 0) return { x: 0, y: 0 };
  if (polygon.length === 1) return { ...polygon[0]! };

  let signedArea = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < polygon.length; i++) {
    const p0 = polygon[i]!;
    const p1 = polygon[(i + 1) % polygon.length]!;

    const a = p0.x * p1.y - p1.x * p0.y;
    signedArea += a;
    cx += (p0.x + p1.x) * a;
    cy += (p0.y + p1.y) * a;
  }

  signedArea *= 0.5;
  if (Math.abs(signedArea) < 1e-9) {
    // Fallback to bounding box midpoint
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of polygon) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  }

  return {
    x: cx / (6 * signedArea),
    y: cy / (6 * signedArea),
  };
}

/**
 * Computes bounding rectangle of a polygon.
 */
export function polygonBounds(polygon: Point2D[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return { minX, maxX, minY, maxY };
}
