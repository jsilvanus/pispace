import test from 'node:test';
import assert from 'node:assert/strict';
import { solvePtzForTarget } from '../src/camera/solver.js';
import type { CameraMount } from '../src/types.js';

test('solve PTZ for camera directly facing target', () => {
  const mount: CameraMount = {
    id: 'cam_test',
    name: 'Test Cam',
    position: { x: 0, y: 0, z: 2.0 },
    baseOrientation: { pan: 0, tilt: 0, roll: 0 },
  };

  // Target 10 meters forward along +Y at floor level z = 0
  const target = { x: 0, y: 10, z: 0 };
  const solution = solvePtzForTarget(mount, target, { shotType: 'medium' });

  assert.equal(solution.cameraId, 'cam_test');
  assert.equal(solution.pan, 0); // straight forward
  assert.ok(solution.tilt < 0); // looking down
  assert.ok(solution.distanceMeters > 10);
  assert.ok(solution.zoom >= 0);
});

test('solve PTZ for target to the right', () => {
  const mount: CameraMount = {
    id: 'cam_test',
    name: 'Test Cam',
    position: { x: 0, y: 0, z: 2.0 },
    baseOrientation: { pan: 0, tilt: 0, roll: 0 },
  };

  // Target at x = 10, y = 10 (45 degrees to the right)
  const target = { x: 10, y: 10, z: 2.0 };
  const solution = solvePtzForTarget(mount, target);

  // dx = 10, dy = 10 -> pan = atan2(10, 10) = 45 deg (clockwise towards +X)
  assert.equal(Math.round(solution.pan), 45);
  assert.equal(Math.round(solution.tilt), 0);
});

test('solver pan and projection agree: pan 90 looks towards +X', async () => {
  const { getCameraWorldPose, computeCameraFrustum } = await import('../src/camera/projection.js');
  const mount = { id: 'c', name: 'c', position: { x: 0, y: 0, z: 2 }, baseOrientation: { pan: 0, tilt: 0, roll: 0 } };
  const sol = solvePtzForTarget(mount, { x: 5, y: 0, z: 2 });
  assert.equal(sol.pan, 90);
  const pose = getCameraWorldPose(mount, { camId: 1, pan: sol.pan, tilt: sol.tilt, roll: 0, zoom: 0 });
  const f = computeCameraFrustum(pose);
  assert.ok(f.opticalAxis.x > 0.99, `axis ${JSON.stringify(f.opticalAxis)}`);
});
