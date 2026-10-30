import fs from 'node:fs';
import path from 'node:path';
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

/**
 * Validates that an untrusted object meets the required VenueModel shape.
 */
export function validateVenueModel(data: unknown): VenueModel {
  if (!data || typeof data !== 'object') {
    throw new Error('Venue model must be an object');
  }

  const v = data as Record<string, unknown>;
  if (typeof v.name !== 'string') throw new Error('Venue model requires string "name"');
  if (!v.dimensions || typeof v.dimensions !== 'object') throw new Error('Venue model requires "dimensions" object');
  if (!v.cameras || typeof v.cameras !== 'object') throw new Error('Venue model requires "cameras" object');
  if (!Array.isArray(v.zones)) throw new Error('Venue model requires "zones" array');

  for (const z of v.zones as Array<Record<string, unknown>>) {
    if (typeof z.id !== 'string') throw new Error('Each zone requires string "id"');
    if (typeof z.name !== 'string') throw new Error('Each zone requires string "name"');
    if (typeof z.floorHeight !== 'number') throw new Error(`Zone ${z.id} requires numeric "floorHeight"`);
    if (typeof z.ceilingHeight !== 'number') throw new Error(`Zone ${z.id} requires numeric "ceilingHeight"`);
    if (!Array.isArray(z.polygon) || z.polygon.length < 3) {
      throw new Error(`Zone ${z.id} requires polygon array with at least 3 vertices`);
    }
  }

  return data as VenueModel;
}

/**
 * Loads a venue model from an external JSON file path.
 */
export function loadVenueFromFile(filePath: string): VenueModel {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(raw);
  return validateVenueModel(parsed);
}
