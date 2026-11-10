// Pure helpers for the live view. No DOM, no three.js, so any program (and the tests) can use them.
// Venue frame: metres, +Z up, pan 0° = +Y, clockwise seen from above (90° = +X), tilt negative = down.

const DEG = Math.PI / 180;

/** Unit vector a camera looks along for a world pan/tilt in degrees. */
export function lookDirection(panDeg, tiltDeg) {
  const p = panDeg * DEG;
  const t = tiltDeg * DEG;
  return { x: Math.sin(p) * Math.cos(t), y: Math.cos(p) * Math.cos(t), z: Math.sin(t) };
}

/** World pan/tilt (degrees) of a camera: mount base plus FreeD offsets, as pispace computes it. */
export function cameraPanTilt(cameraState) {
  const base = cameraState?.mount?.baseOrientation ?? { pan: 0, tilt: 0 };
  const tel = cameraState?.telemetry;
  return { pan: (base.pan ?? 0) + (tel?.pan ?? 0), tilt: (base.tilt ?? 0) + (tel?.tilt ?? 0) };
}

/** Four far corners of a camera's view pyramid, `range` metres out. Order: top-left, top-right, bottom-right, bottom-left. */
export function frustumCorners(position, panDeg, tiltDeg, hfovDeg, vfovDeg, range = 6) {
  const f = lookDirection(panDeg, tiltDeg);
  // Right is the forward direction turned 90° clockwise in the floor plane; up completes the frame.
  const r = { x: Math.cos(panDeg * DEG), y: -Math.sin(panDeg * DEG), z: 0 };
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const th = Math.tan((hfovDeg / 2) * DEG);
  const tv = Math.tan((vfovDeg / 2) * DEG);
  const corner = (sx, sy) => ({
    x: position.x + range * (f.x + sx * th * r.x + sy * tv * u.x),
    y: position.y + range * (f.y + sx * th * r.y + sy * tv * u.y),
    z: position.z + range * (f.z + sx * th * r.z + sy * tv * u.z),
  });
  return [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)];
}

/** Where a ray meets the horizontal plane z = planeZ, or null when it points away or runs parallel. */
export function rayHitPlane(origin, dir, planeZ = 0) {
  if (Math.abs(dir.z) < 1e-9) return null;
  const t = (planeZ - origin.z) / dir.z;
  if (t <= 0) return null;
  return { x: origin.x + t * dir.x, y: origin.y + t * dir.y, z: planeZ };
}

/** Even-odd point-in-polygon test in the floor plane. */
export function pointInPolygon(p, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Floor height under a floor-plan point: the highest raised floor or zone that contains it, else 0.
 * Used to put a click on the gallery or the chancel at the right height.
 */
export function floorHeightAt(venue, p) {
  let z = 0;
  for (const f of venue?.floors ?? []) if (f.polygon?.length > 2 && pointInPolygon(p, f.polygon)) z = Math.max(z, f.elevation ?? 0);
  for (const zone of venue?.zones ?? []) if (zone.polygon?.length > 2 && pointInPolygon(p, zone.polygon)) z = Math.max(z, zone.floorHeight ?? 0);
  return z;
}

/** Point a camera should aim at for a tracked person: about chest height above the feet. */
export function subjectAimPoint(subject, chestRatio = 0.8) {
  const h = subject.headHeight > 0 ? subject.headHeight : 1.7;
  return { x: subject.position.x, y: subject.position.y, z: subject.position.z + h * chestRatio };
}

const PALETTE = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#bfef45', '#469990', '#9a6324'];

/** Stable colour per track id, so a person keeps one colour while tracked. */
export function trackColor(trackId) {
  const n = Number.isFinite(trackId) ? Math.abs(Math.trunc(trackId)) : 0;
  return PALETTE[n % PALETTE.length];
}

/** Subjects not seen within maxAgeMs of `now` are dropped from the view. */
export function freshSubjects(scene, now = Date.now(), maxAgeMs = 5000) {
  return (scene?.subjects ?? []).filter((s) => {
    const t = Date.parse(s.lastSeenAt);
    return Number.isNaN(t) || now - t <= maxAgeMs;
  });
}
