import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

test('models dir: env wins, else next to the venue file, else ./models', () => {
  assert.equal(loadConfig({ PISPACE_MODELS_DIR: '/srv/scan' }).modelsDir, '/srv/scan');
  assert.equal(
    loadConfig({ PISPACE_VENUE_FILE: '/site/apps/pispace/venue.json' }).modelsDir,
    path.join('/site/apps/pispace', 'models'),
  );
  assert.equal(loadConfig({}).modelsDir, path.resolve('models'));
});
