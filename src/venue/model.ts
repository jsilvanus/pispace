import type { VenueModel, SpatialZone, Point3D } from '../types.js';
import { pointInSpatialZone, polygonCentroid } from '../math/polygon.js';

export function findZoneAtPoint(venue: VenueModel, point: Point3D): SpatialZone | null {
  // Sort zones by floor height descending so elevated structures (e.g. Pulpit) take precedence over general chancel
  const sorted = [...venue.zones].sort((a, b) => b.floorHeight - a.floorHeight);
  for (const zone of sorted) {
    if (pointInSpatialZone(point, zone)) {
      return zone;
    }
  }
  return null;
}

export function getZoneById(venue: VenueModel, zoneId: string): SpatialZone | null {
  return venue.zones.find((z) => z.id === zoneId) ?? null;
}

/**
 * Returns a recommended 3D targeting point for a zone (e.g. center of the zone at typical chest/head level).
 */
export function getZoneTargetPoint(zone: SpatialZone, targetHeightOffset = 1.4): Point3D {
  const center2D = polygonCentroid(zone.polygon);
  return {
    x: Math.round(center2D.x * 100) / 100,
    y: Math.round(center2D.y * 100) / 100,
    z: Math.round((zone.floorHeight + targetHeightOffset) * 100) / 100,
  };
}
