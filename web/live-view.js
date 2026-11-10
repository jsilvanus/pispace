// pispace live view: the venue, the cameras with their view pyramids, and every tracked person, in 3D.
// Framework-free ES module, meant to be dropped into any page (picontrol, church-3d-mapper, a kiosk):
//
//   import { mountLiveView } from 'http://<pi>:3203/web/live-view.js';
//   const view = await mountLiveView(document.getElementById('box'), { baseUrl: 'http://<pi>:3203' });
//   view.on('aim', (solution) => console.log(solution.pan, solution.tilt, solution.zoom));
//
// Data: GET /api/v1/venue once, then the SSE stream /api/v1/events (scene snapshots).
// Click a camera to select it, then click a person or a floor spot: pispace solves the pan/tilt/zoom
// (POST /api/v1/solve-ptz) and the view draws the aim line and emits 'aim'. The view never moves a real
// camera itself; the host decides what to do with the solution.

import {
  cameraPanTilt,
  floorHeightAt,
  freshSubjects,
  frustumCorners,
  lookDirection,
  rayHitPlane,
  subjectAimPoint,
  trackColor,
} from './live-geometry.js';

const DEFAULT_THREE_URL = new URL('../vendor/three/three.module.js', import.meta.url).href;

/**
 * @param {HTMLElement} el container; the view fills it and follows its size
 * @param {object} [opts]
 * @param {string} [opts.baseUrl] pispace address, '' = same origin
 * @param {object} [opts.THREE] a three.js namespace the host already loaded (else loaded from opts.threeUrl)
 * @param {string} [opts.threeUrl] where to import three.js from (default: the copy pispace serves)
 * @param {boolean} [opts.aim=true] click-to-aim on/off
 * @param {string} [opts.shotType='medium'] wide | medium | close_up | tight
 * @param {number} [opts.maxAgeMs=5000] hide people not seen for this long
 * @param {boolean} [opts.hud=true] small status/selection line in the corner
 * @param {typeof fetch} [opts.fetch]
 * @param {typeof EventSource} [opts.EventSource]
 */
export async function mountLiveView(el, opts = {}) {
  const THREE = opts.THREE ?? (await import(opts.threeUrl ?? DEFAULT_THREE_URL));
  const base = (opts.baseUrl ?? '').replace(/\/$/, '');
  const doFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const ES = opts.EventSource ?? globalThis.EventSource;
  const aimEnabled = opts.aim !== false;
  const shotType = opts.shotType ?? 'medium';
  const maxAgeMs = opts.maxAgeMs ?? 5000;

  const listeners = new Map();
  const emit = (name, detail) => {
    for (const fn of listeners.get(name) ?? []) fn(detail);
    el.dispatchEvent(new CustomEvent(`pispace:${name}`, { detail }));
  };

  // --- three.js setup (Z up) ---
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  el.appendChild(renderer.domElement);

  const scene3 = new THREE.Scene();
  scene3.background = new THREE.Color(opts.background ?? '#14171c');
  const cam = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
  cam.up.set(0, 0, 1);
  scene3.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(8, -10, 20);
  scene3.add(sun);

  const venueGroup = new THREE.Group();
  const cameraGroup = new THREE.Group();
  const subjectGroup = new THREE.Group();
  const aimGroup = new THREE.Group();
  scene3.add(venueGroup, cameraGroup, subjectGroup, aimGroup);

  let hud = null;
  if (opts.hud !== false) {
    hud = document.createElement('div');
    Object.assign(hud.style, {
      position: 'absolute', left: '8px', bottom: '8px', padding: '4px 8px', borderRadius: '4px',
      font: '12px system-ui, sans-serif', color: '#e8ecf1', background: 'rgba(0,0,0,0.55)', pointerEvents: 'none',
      whiteSpace: 'pre',
    });
    el.appendChild(hud);
  }

  // --- simple orbit: left drag turns, right drag or shift-drag pans, wheel zooms ---
  const orbit = { target: new THREE.Vector3(0, -8, 1), dist: 30, az: -0.6, el: 0.75 };
  const placeCamera = () => {
    const ce = Math.cos(orbit.el);
    cam.position.set(
      orbit.target.x + orbit.dist * ce * Math.sin(orbit.az),
      orbit.target.y - orbit.dist * ce * Math.cos(orbit.az),
      orbit.target.z + orbit.dist * Math.sin(orbit.el),
    );
    cam.lookAt(orbit.target);
  };

  const resize = () => {
    const w = el.clientWidth || 640;
    const h = el.clientHeight || 400;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  ro?.observe(el);
  resize();

  let drag = null;
  const canvas = renderer.domElement;
  const onDown = (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false, pan: e.button === 2 || e.shiftKey };
    canvas.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (drag.pan) {
      const s = orbit.dist / 600;
      const right = new THREE.Vector3(Math.cos(orbit.az), Math.sin(orbit.az), 0);
      const fwd = new THREE.Vector3(-Math.sin(orbit.az), Math.cos(orbit.az), 0);
      orbit.target.addScaledVector(right, -dx * s).addScaledVector(fwd, dy * s);
    } else {
      orbit.az -= dx * 0.008;
      orbit.el = Math.min(1.5, Math.max(0.05, orbit.el + dy * 0.008));
    }
    placeCamera();
  };
  const onUp = (e) => {
    const wasClick = drag && !drag.moved;
    drag = null;
    if (wasClick && e.button === 0) handleClick(e);
  };
  const onWheel = (e) => {
    e.preventDefault();
    orbit.dist = Math.min(150, Math.max(2, orbit.dist * Math.exp(e.deltaY * 0.001)));
    placeCamera();
  };
  const onContext = (e) => e.preventDefault();
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContext);

  // --- state ---
  let venue = null;
  let scene = null;
  let selectedCameraId = null;
  let lastAim = null;
  let status = 'connecting';

  const clear = (group) => {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse?.((o) => {
        o.geometry?.dispose?.();
        if (o.material) for (const m of [].concat(o.material)) m.dispose?.();
      });
    }
  };

  const lineMat = (color, opacity = 1) => new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  const polyLine = (pts, color, opacity, closed) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y, p.z ?? 0)));
    return closed ? new THREE.LineLoop(g, lineMat(color, opacity)) : new THREE.Line(g, lineMat(color, opacity));
  };
  const flatPolygon = (polygon, z, color, opacity) => {
    const shape = new THREE.Shape(polygon.map((p) => new THREE.Vector2(p.x, p.y)));
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape),
      new THREE.MeshLambertMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.position.z = z;
    return mesh;
  };

  function drawVenue() {
    clear(venueGroup);
    if (!venue) return;
    const grid = new THREE.GridHelper(80, 80, 0x2c3440, 0x20262e);
    grid.rotation.x = Math.PI / 2;
    venueGroup.add(grid);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ visible: false }));
    ground.userData.pick = 'floor';
    venueGroup.add(ground);

    for (const f of venue.floors ?? []) {
      if ((f.polygon?.length ?? 0) < 3) continue;
      const m = flatPolygon(f.polygon, f.elevation ?? 0, f.color ?? '#5b6573', 0.35);
      m.userData.pick = 'floor';
      venueGroup.add(m);
    }
    for (const w of venue.walls ?? []) {
      const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      const h = Math.max(0.05, (w.topZ ?? 3) - (w.bottomZ ?? 0));
      if (len < 0.01) continue;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(len, Math.max(0.05, w.thickness ?? 0.2), h),
        new THREE.MeshLambertMaterial({ color: w.color ?? '#8a93a0', transparent: true, opacity: w.seeThrough ? 0.08 : 0.18, depthWrite: false }),
      );
      box.position.set((w.start.x + w.end.x) / 2, (w.start.y + w.end.y) / 2, (w.bottomZ ?? 0) + h / 2);
      box.rotation.z = Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x);
      venueGroup.add(box);
    }
    for (const z of venue.zones ?? []) {
      if ((z.polygon?.length ?? 0) < 3) continue;
      const color = z.color ?? '#5fb3ff';
      venueGroup.add(polyLine(z.polygon.map((p) => ({ ...p, z: (z.floorHeight ?? 0) + 0.02 })), color, 0.9, true));
      const m = flatPolygon(z.polygon, (z.floorHeight ?? 0) + 0.01, color, 0.12);
      m.userData.pick = 'floor';
      venueGroup.add(m);
    }
    // Origin marker: the altar (fixed reference point of the venue frame).
    venueGroup.add(new THREE.AxesHelper(1));
  }

  function drawCameras() {
    clear(cameraGroup);
    const states = scene?.cameras ?? {};
    const mounts = venue?.cameras ?? {};
    const ids = new Set([...Object.keys(mounts), ...Object.keys(states)]);
    for (const id of ids) {
      const st = states[id] ?? { id, mount: mounts[id], telemetry: null, frustum: null };
      const mount = st.mount ?? mounts[id];
      if (!mount?.position) continue;
      const { pan, tilt } = cameraPanTilt({ ...st, mount });
      const selected = id === selectedCameraId;
      const color = st.onAir ? '#ff3b30' : selected ? '#ffd60a' : '#9fd3ff';
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.3), new THREE.MeshLambertMaterial({ color }));
      body.position.set(mount.position.x, mount.position.y, mount.position.z);
      body.userData.pick = 'camera';
      body.userData.cameraId = id;
      g.add(body);
      const hfov = st.frustum?.hfovDeg ?? 60;
      const vfov = st.frustum?.vfovDeg ?? 36;
      const range = selected ? 9 : 5;
      const c = frustumCorners(mount.position, pan, tilt, hfov, vfov, range);
      const p = mount.position;
      for (const k of c) g.add(polyLine([p, k], color, selected ? 0.9 : 0.5));
      g.add(polyLine(c, color, selected ? 0.9 : 0.5, true));
      if (st.frustum?.targetIntersection) {
        const t = st.frustum.targetIntersection;
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color }));
        dot.position.set(t.x, t.y, t.z);
        g.add(dot);
      }
      g.add(label(id, color, { x: p.x, y: p.y, z: p.z + 0.5 }));
      cameraGroup.add(g);
    }
  }

  function drawSubjects() {
    clear(subjectGroup);
    for (const s of freshSubjects(scene, Date.now(), maxAgeMs)) {
      const color = trackColor(s.trackId);
      const h = s.headHeight > 0 ? s.headHeight : 1.7;
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color });
      const bodyH = Math.max(0.3, h - 0.25);
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, bodyH, 14), mat);
      torso.rotation.x = Math.PI / 2;
      torso.position.set(s.position.x, s.position.y, s.position.z + bodyH / 2);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), mat);
      head.position.set(s.position.x, s.position.y, s.position.z + bodyH + 0.12);
      for (const m of [torso, head]) {
        m.userData.pick = 'subject';
        m.userData.trackId = s.trackId;
      }
      g.add(torso, head);
      const ring = polyLine(
        Array.from({ length: 24 }, (_, i) => ({ x: s.position.x + 0.4 * Math.cos((i / 24) * 2 * Math.PI), y: s.position.y + 0.4 * Math.sin((i / 24) * 2 * Math.PI), z: s.position.z + 0.02 })),
        color, 0.9, true,
      );
      g.add(ring);
      const text = `#${s.trackId}${s.zoneName ? ' ' + s.zoneName : ''}`;
      g.add(label(text, color, { x: s.position.x, y: s.position.y, z: s.position.z + h + 0.35 }));
      subjectGroup.add(g);
    }
  }

  function drawAim() {
    clear(aimGroup);
    if (!lastAim) return;
    const mount = venue?.cameras?.[lastAim.cameraId];
    if (!mount) return;
    const t = lastAim.targetPoint;
    aimGroup.add(polyLine([mount.position, t], '#ffd60a', 1));
    const d = lookDirection(mount.baseOrientation.pan + lastAim.pan, mount.baseOrientation.tilt + lastAim.tilt);
    const far = { x: mount.position.x + d.x * lastAim.distanceMeters, y: mount.position.y + d.y * lastAim.distanceMeters, z: mount.position.z + d.z * lastAim.distanceMeters };
    // The solved direction drawn dashed-ish (second, thinner colour) so a pan sign error would show at once.
    aimGroup.add(polyLine([mount.position, far], '#ff9f0a', 0.6));
    const mark = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffd60a' }));
    mark.position.set(t.x, t.y, t.z);
    aimGroup.add(mark);
  }

  // Text sprites (canvas texture), scaled in metres.
  function label(text, color, at) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    const font = '28px system-ui, sans-serif';
    ctx.font = font;
    c.width = Math.ceil(ctx.measureText(text).width) + 16;
    c.height = 40;
    ctx.font = font;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 8, 21);
    const tex = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set((c.width / c.height) * 0.4, 0.4, 1);
    sprite.position.set(at.x, at.y, at.z);
    sprite.renderOrder = 10;
    sprite.material.map = tex;
    return sprite;
  }

  function updateHud() {
    if (!hud) return;
    const people = freshSubjects(scene, Date.now(), maxAgeMs).length;
    const lines = [`${status} · ${people} ${people === 1 ? 'person' : 'people'}`];
    if (aimEnabled) lines.push(selectedCameraId ? `aiming ${selectedCameraId}: click a person or the floor` : 'click a camera to aim it');
    if (lastAim) lines.push(`${lastAim.cameraId} pan ${lastAim.pan}° tilt ${lastAim.tilt}° · view ${Math.round(lastAim.estimatedHfovDeg)}° wide · ${Number(lastAim.distanceMeters).toFixed(1)} m`);
    hud.textContent = lines.join('\n');
  }

  // --- picking ---
  const raycaster = new THREE.Raycaster();
  function handleClick(e) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, cam);
    const hits = raycaster.intersectObjects([cameraGroup, subjectGroup, venueGroup], true).filter((h) => h.object.userData.pick);
    const hit = hits[0];
    if (!hit) return;
    const kind = hit.object.userData.pick;
    if (kind === 'camera') {
      selectCamera(hit.object.userData.cameraId === selectedCameraId ? null : hit.object.userData.cameraId);
      return;
    }
    if (kind === 'subject') {
      const s = (scene?.subjects ?? []).find((x) => x.trackId === hit.object.userData.trackId);
      emit('select-subject', s ?? null);
      if (s && selectedCameraId && aimEnabled) void aimAt(subjectAimPoint(s), { trackId: s.trackId });
      return;
    }
    // Floor: snap to the floor height at that spot (gallery, chancel), aim at chest height.
    const ray = raycaster.ray;
    const p0 = rayHitPlane(ray.origin, ray.direction, hit.point.z) ?? hit.point;
    const z = floorHeightAt(venue, p0);
    const p = rayHitPlane(ray.origin, ray.direction, z) ?? p0;
    emit('select-point', { x: p.x, y: p.y, z });
    if (selectedCameraId && aimEnabled) void aimAt({ x: p.x, y: p.y, z: z + 1.4 });
  }

  function selectCamera(id) {
    selectedCameraId = id ?? null;
    emit('select-camera', selectedCameraId);
    drawCameras();
    updateHud();
  }

  /** Solve pan/tilt/zoom for the selected (or given) camera towards a venue point; emits 'aim'. */
  async function aimAt(point, extra = {}, cameraId = selectedCameraId) {
    if (!cameraId) throw new Error('No camera selected');
    const res = await doFetch(`${base}/api/v1/solve-ptz`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cameraId, target: point, shotType }),
    });
    if (!res.ok) throw new Error(`solve-ptz ${res.status}`);
    lastAim = { ...(await res.json()), ...extra };
    drawAim();
    updateHud();
    emit('aim', lastAim);
    return lastAim;
  }

  // --- data ---
  async function loadVenue() {
    const res = await doFetch(`${base}/api/v1/venue`);
    if (!res.ok) throw new Error(`venue ${res.status}`);
    venue = await res.json();
    drawVenue();
    drawCameras();
  }

  function setScene(next) {
    scene = next;
    drawCameras();
    drawSubjects();
    updateHud();
    emit('scene', scene);
  }

  let es = null;
  let pollTimer = null;
  function connect() {
    if (!ES) {
      // No EventSource (e.g. tests): poll the snapshot instead.
      const poll = async () => {
        try {
          const r = await doFetch(`${base}/api/v1/scene`);
          if (r.ok) { status = 'live (polling)'; setScene(await r.json()); }
        } catch { status = 'offline'; updateHud(); }
      };
      void poll();
      pollTimer = setInterval(poll, 1000);
      return;
    }
    es = new ES(`${base}/api/v1/events`);
    es.addEventListener('open', () => { status = 'live'; updateHud(); });
    es.addEventListener('error', () => { status = 'reconnecting'; updateHud(); });
    es.addEventListener('scene', (ev) => { status = 'live'; setScene(JSON.parse(ev.data)); });
    es.addEventListener('venue-updated', () => { void loadVenue().catch(() => {}); });
  }

  // Age out people even when no new snapshot arrives.
  const ageTimer = setInterval(() => { if (scene) { drawSubjects(); updateHud(); } }, 1000);

  let raf = 0;
  const loop = () => {
    renderer.render(scene3, cam);
    raf = requestAnimationFrame(loop);
  };

  placeCamera();
  await loadVenue();
  connect();
  updateHud();
  loop();

  return {
    on(name, fn) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
    selectCamera,
    aimAt,
    /** Feed a scene snapshot yourself (when the host already has the stream). */
    setScene,
    get venue() { return venue; },
    get scene() { return scene; },
    get selectedCamera() { return selectedCameraId; },
    destroy() {
      cancelAnimationFrame(raf);
      clearInterval(ageTimer);
      if (pollTimer) clearInterval(pollTimer);
      es?.close();
      ro?.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContext);
      for (const g of [venueGroup, cameraGroup, subjectGroup, aimGroup]) clear(g);
      renderer.dispose();
      canvas.remove();
      hud?.remove();
    },
  };
}
