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

  validateOptionalArrays(v);
  return data as VenueModel;
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function checkPolygon(owner: string, poly: unknown): void {
  if (!Array.isArray(poly) || poly.length < 3) throw new Error(`${owner} requires polygon array with at least 3 vertices`);
  for (const p of poly as Array<Record<string, unknown>>) {
    if (!p || !isNum(p.x) || !isNum(p.y)) throw new Error(`${owner} has a polygon vertex without numeric x/y`);
  }
}

function checkPoint3(owner: string, p: unknown): void {
  const q = p as Record<string, unknown> | undefined;
  if (!q || !isNum(q.x) || !isNum(q.y) || !isNum(q.z)) throw new Error(`${owner} requires a point with numeric x/y/z`);
}

/** Checks the optional map elements (levels, floors, walls, furniture, stairs, exits, rooms). */
function validateOptionalArrays(v: Record<string, unknown>): void {
  const groups: Array<[string, (item: Record<string, unknown>, owner: string) => void]> = [
    ['levels', (i, o) => { if (!isNum(i.elevation)) throw new Error(`${o} requires numeric "elevation"`); }],
    ['floors', (i, o) => { if (!isNum(i.elevation)) throw new Error(`${o} requires numeric "elevation"`); checkPolygon(o, i.polygon); }],
    ['walls', (i, o) => {
      const s = i.start as Record<string, unknown> | undefined;
      const e = i.end as Record<string, unknown> | undefined;
      if (!s || !e || !isNum(s.x) || !isNum(s.y) || !isNum(e.x) || !isNum(e.y)) throw new Error(`${o} requires start/end points`);
      if (!isNum(i.bottomZ) || !isNum(i.topZ) || i.topZ < i.bottomZ) throw new Error(`${o} requires bottomZ <= topZ`);
    }],
    ['furniture', (i, o) => {
      checkPoint3(o, i.center);
      const sz = i.size as Record<string, unknown> | undefined;
      if (!sz || !isNum(sz.width) || !isNum(sz.depth) || !isNum(sz.height)) throw new Error(`${o} requires size width/depth/height`);
    }],
    ['stairs', (i, o) => { if (!isNum(i.fromZ) || !isNum(i.toZ)) throw new Error(`${o} requires numeric fromZ/toZ`); checkPolygon(o, i.polygon); }],
    ['exits', (i, o) => checkPoint3(o, i.position)],
    ['rooms', (i, o) => { if (!isNum(i.floorZ)) throw new Error(`${o} requires numeric "floorZ"`); checkPolygon(o, i.polygon); }],
  ];
  for (const [key, check] of groups) {
    const arr = v[key];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) throw new Error(`"${key}" must be an array`);
    const seen = new Set<string>();
    for (const item of arr as Array<Record<string, unknown>>) {
      if (!item || typeof item.id !== 'string') throw new Error(`Each item of "${key}" requires string "id"`);
      if (seen.has(item.id)) throw new Error(`Duplicate id "${item.id}" in "${key}"`);
      seen.add(item.id);
      check(item, `${key} item ${item.id}`);
    }
  }
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
