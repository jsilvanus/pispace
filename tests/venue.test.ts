import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadVenueFromFile, validateVenueModel, findZoneAtPoint, getZoneTargetPoint } from '../src/venue/model.js';

test('load and validate venue from JSON file', () => {
  const jsonPath = path.resolve('venues/keskuskirkko.json');
  const venue = loadVenueFromFile(jsonPath);

  assert.equal(venue.name, 'Riihimäen Keskuskirkko');
  assert.ok(venue.cameras.cam1);
  assert.ok(venue.cameras.cam2);
  assert.ok(venue.zones.length >= 6);

  // Test Pulpit coordinates: x = -3.5, y = 0.5, z = 1.3
  const pulpitZone = findZoneAtPoint(venue, { x: -3.5, y: 0.5, z: 1.3 });
  assert.ok(pulpitZone);
  assert.equal(pulpitZone.id, 'pulpit');

  // Test Altar coordinates: x = 0.0, y = 2.0, z = 0.4
  const altarZone = findZoneAtPoint(venue, { x: 0.0, y: 2.0, z: 0.4 });
  assert.ok(altarZone);
  assert.equal(altarZone.id, 'altar');

  // Test target center
  const target = getZoneTargetPoint(pulpitZone);
  assert.ok(target.x < 0);
  assert.ok(target.z > 2.0); // elevated floor + eye level
});

test('validateVenueModel rejects invalid schema', () => {
  assert.throws(() => validateVenueModel({}), /requires string "name"/);
  assert.throws(() => validateVenueModel({ name: 'Test', dimensions: {}, cameras: {}, zones: [{ id: 'z1' }] }), /requires string "name"/);
});
