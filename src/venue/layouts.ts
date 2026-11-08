import type { VenueFurniture, VenueLayout, VenueModel, Point3D } from '../types.js';

/** The layout in use: venue.activeLayout, else the first layout, else none. */
export function getActiveLayout(venue: VenueModel): VenueLayout | null {
  const layouts = venue.layouts ?? [];
  return layouts.find((l) => l.id === venue.activeLayout) ?? layouts[0] ?? null;
}

/**
 * Fixed furniture plus the placements of a layout (default: the active one), each placement
 * expanded from its object type. Placements whose type is missing are skipped.
 */
export function resolveFurniture(venue: VenueModel, layoutId?: string): VenueFurniture[] {
  const fixed = venue.furniture ?? [];
  const layout = layoutId ? (venue.layouts ?? []).find((l) => l.id === layoutId) ?? null : getActiveLayout(venue);
  if (!layout) return fixed;
  const types = new Map((venue.objectTypes ?? []).map((t) => [t.id, t]));
  const placed: VenueFurniture[] = [];
  for (const p of layout.placements) {
    const t = types.get(p.typeId);
    if (!t) continue;
    placed.push({
      id: p.id,
      name: p.name ?? t.name,
      kind: t.kind,
      shape: t.shape,
      center: { ...p.center },
      size: { ...t.size },
      rotationDeg: p.rotationDeg,
      color: t.color,
      movable: true,
      typeId: t.id,
      layoutId: layout.id,
    });
  }
  return [...fixed, ...placed];
}

/** Checks layouts and object types; throws with a readable message. */
export function validateLayouts(venue: VenueModel): void {
  const typeIds = new Set<string>();
  for (const t of venue.objectTypes ?? []) {
    if (!t || typeof t.id !== 'string') throw new Error('Each object type requires string "id"');
    if (typeIds.has(t.id)) throw new Error(`Duplicate object type id "${t.id}"`);
    const s = t.size as Record<string, unknown> | undefined;
    if (!s || typeof s.width !== 'number' || typeof s.depth !== 'number' || typeof s.height !== 'number') {
      throw new Error(`Object type ${t.id} requires size width/depth/height`);
    }
    typeIds.add(t.id);
  }
  const layoutIds = new Set<string>();
  for (const l of venue.layouts ?? []) {
    if (!l || typeof l.id !== 'string') throw new Error('Each layout requires string "id"');
    if (layoutIds.has(l.id)) throw new Error(`Duplicate layout id "${l.id}"`);
    layoutIds.add(l.id);
    if (!Array.isArray(l.placements)) throw new Error(`Layout ${l.id} requires "placements" array`);
    const seen = new Set<string>();
    for (const p of l.placements) {
      if (!p || typeof p.id !== 'string') throw new Error(`Layout ${l.id}: each placement requires string "id"`);
      if (seen.has(p.id)) throw new Error(`Layout ${l.id}: duplicate placement id "${p.id}"`);
      seen.add(p.id);
      if (!typeIds.has(p.typeId)) throw new Error(`Layout ${l.id}: placement ${p.id} uses unknown object type "${p.typeId}"`);
      const c = p.center as Partial<Point3D> | undefined;
      if (!c || typeof c.x !== 'number' || typeof c.y !== 'number' || typeof c.z !== 'number') {
        throw new Error(`Layout ${l.id}: placement ${p.id} requires center x/y/z`);
      }
    }
  }
  if (venue.activeLayout !== undefined && !layoutIds.has(venue.activeLayout)) {
    throw new Error(`activeLayout "${venue.activeLayout}" is not a layout id`);
  }
}
