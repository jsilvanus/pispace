import type { Point2D, VenueModel } from '../types.js';
import { resolveFurniture } from './layouts.js';

export interface SvgMapOptions {
  /** Level id (from venue.levels) to draw; everything else is faded. Default: all. */
  level?: string | undefined;
  /** Pixels per meter. Default 20. */
  scale?: number | undefined;
  /** Layout id whose movable objects are drawn. Default: the active layout. */
  layout?: string | undefined;
  /** Draw zones as coloured outlines. Default true. */
  zones?: boolean | undefined;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const r2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Renders the venue as a top-down SVG map (plan view). Map orientation: +Y (towards the altar)
 * points right, -X (pulpit side) points up, like a floor plan read from the entrance.
 */
export function renderVenueSvg(venue: VenueModel, options: SvgMapOptions = {}): string {
  const scale = options.scale ?? 20;
  const showZones = options.zones ?? true;
  const levels = venue.levels ?? [];
  const level = options.level ? levels.find((l) => l.id === options.level) : undefined;
  const levelZ = level?.elevation;
  // An element belongs to the chosen level when its base is within 2 m above that level's floor.
  const onLevel = (z: number): boolean =>
    levelZ === undefined || (z >= levelZ - 0.5 && z < levelZ + 2.0);

  const pts: Point2D[] = [];
  for (const w of venue.walls ?? []) pts.push(w.start, w.end);
  for (const f of venue.floors ?? []) pts.push(...f.polygon);
  for (const z of venue.zones) pts.push(...z.polygon);
  for (const s of venue.stairs ?? []) pts.push(...s.polygon);
  if (pts.length === 0) pts.push({ x: -1, y: -1 }, { x: 1, y: 1 });
  const margin = 1.5;
  const minX = Math.min(...pts.map((p) => p.x)) - margin;
  const maxX = Math.max(...pts.map((p) => p.x)) + margin;
  const minY = Math.min(...pts.map((p) => p.y)) - margin;
  const maxY = Math.max(...pts.map((p) => p.y)) + margin;
  const width = (maxY - minY) * scale;
  const height = (maxX - minX) * scale;
  const sx = (p: Point2D): number => r2((p.y - minY) * scale);
  const sy = (p: Point2D): number => r2((p.x - minX) * scale);
  const path = (poly: Point2D[]): string => poly.map((p) => `${sx(p)},${sy(p)}`).join(' ');
  const fade = (on: boolean): string => (on ? '' : ' opacity="0.25"');

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r2(width)} ${r2(height)}" width="${r2(width)}" height="${r2(height)}" font-family="sans-serif">`,
    `<title>${esc(venue.name)}${level ? ` - ${esc(level.name)}` : ''}</title>`,
    `<rect width="100%" height="100%" fill="#f8fafc"/>`,
  );

  for (const f of venue.floors ?? []) {
    out.push(`<polygon points="${path(f.polygon)}" fill="${esc(f.color ?? '#cbd5e1')}" fill-opacity="0.35" stroke="none"${fade(onLevel(f.elevation))}><title>${esc(f.name)}</title></polygon>`);
  }
  for (const r of venue.rooms ?? []) {
    out.push(`<polygon points="${path(r.polygon)}" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1"${fade(onLevel(r.floorZ))}><title>${esc(r.name)}</title></polygon>`);
  }
  for (const s of venue.stairs ?? []) {
    out.push(`<polygon points="${path(s.polygon)}" fill="url(#stairs)" stroke="#0e7490" stroke-width="1"${fade(onLevel(Math.min(s.fromZ, s.toZ)) || onLevel(Math.max(s.fromZ, s.toZ)))}><title>${esc(s.name)}</title></polygon>`);
  }
  if (showZones) {
    for (const z of venue.zones) {
      out.push(`<polygon points="${path(z.polygon)}" fill="none" stroke="${esc(z.color ?? '#f97316')}" stroke-width="1.5" stroke-dasharray="4 3"${fade(onLevel(z.floorHeight))}><title>${esc(z.name)}</title></polygon>`);
    }
  }
  for (const f of resolveFurniture(venue, options.layout)) {
    const a = ((f.rotationDeg ?? 0) * Math.PI) / 180;
    const w = f.size.width / 2;
    const d = f.size.depth / 2;
    const on = onLevel(f.center.z);
    const color = esc(f.color ?? (f.movable ? '#b45309' : '#64748b'));
    if (f.shape === 'cylinder') {
      out.push(`<ellipse cx="${sx(f.center)}" cy="${sy(f.center)}" rx="${r2(d * scale)}" ry="${r2(w * scale)}" fill="${color}" fill-opacity="0.6"${fade(on)}><title>${esc(f.name)}</title></ellipse>`);
      continue;
    }
    const corners = [[-w, -d], [w, -d], [w, d], [-w, d]].map(([lx, ly]) => ({
      x: f.center.x + lx! * Math.cos(a) - ly! * Math.sin(a),
      y: f.center.y + lx! * Math.sin(a) + ly! * Math.cos(a),
    }));
    out.push(`<polygon points="${path(corners)}" fill="${color}" fill-opacity="0.6"${fade(on)}><title>${esc(f.name)}</title></polygon>`);
  }
  for (const w of venue.walls ?? []) {
    const on = onLevel(w.bottomZ) || (w.bottomZ < (levelZ ?? 0) && w.topZ > (levelZ ?? 0));
    const dash = w.bottomZ > 0.5 ? ' stroke-dasharray="6 3"' : '';
    out.push(`<line x1="${sx(w.start)}" y1="${sy(w.start)}" x2="${sx(w.end)}" y2="${sy(w.end)}" stroke="${esc(w.color ?? '#334155')}" stroke-width="${r2(Math.max(w.thickness * scale, 1.5))}" stroke-linecap="square"${dash}${fade(on)}><title>${esc(w.name)}</title></line>`);
  }
  for (const e of venue.exits ?? []) {
    const on = level ? (e.level ? e.level === level.id : onLevel(e.position.z)) : true;
    out.push(`<g${fade(on)}><circle cx="${sx(e.position)}" cy="${sy(e.position)}" r="${r2(0.45 * scale)}" fill="#16a34a"/><text x="${sx(e.position)}" y="${r2(sy(e.position) + 0.18 * scale)}" font-size="${r2(0.5 * scale)}" fill="#fff" text-anchor="middle">E</text><title>${esc(e.name)}</title></g>`);
  }
  for (const c of Object.values(venue.cameras)) {
    out.push(`<g><rect x="${r2(sx(c.position) - 0.3 * scale)}" y="${r2(sy(c.position) - 0.3 * scale)}" width="${r2(0.6 * scale)}" height="${r2(0.6 * scale)}" fill="#dc2626"/><text x="${r2(sx(c.position) + 0.5 * scale)}" y="${sy(c.position)}" font-size="${r2(0.6 * scale)}" fill="#dc2626">${esc(c.id)}</text><title>${esc(c.name)}</title></g>`);
  }
  // Origin marker
  out.push(`<circle cx="${sx({ x: 0, y: 0 })}" cy="${sy({ x: 0, y: 0 })}" r="3" fill="#000"><title>origin (0, 0)</title></circle>`);
  out.push(`<defs><pattern id="stairs" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 0 L0 6" stroke="#0e7490" stroke-width="1"/></pattern></defs>`);
  out.push('</svg>');
  return out.join('\n');
}
