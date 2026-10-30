import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { KESKUSKIRKKO_VENUE } from './venue/keskuskirkko.js';
import { loadVenueFromFile } from './venue/model.js';
import { SpatialSceneManager } from './scene/spatial-scene.js';
import { GatewayClient } from './scene/gateway-client.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();

  let venue = KESKUSKIRKKO_VENUE;
  if (config.venueFile && fs.existsSync(config.venueFile)) {
    console.log(`[pispace] Loading venue configuration from ${config.venueFile}`);
    venue = loadVenueFromFile(config.venueFile);
  } else {
    const defaultJson = path.resolve('venues/keskuskirkko.json');
    if (fs.existsSync(defaultJson)) {
      console.log(`[pispace] Loading default venue configuration from ${defaultJson}`);
      venue = loadVenueFromFile(defaultJson);
    }
  }

  const sceneManager = new SpatialSceneManager({
    venue,
  });

  const gatewayClient = new GatewayClient(sceneManager, {
    gatewayUrl: config.gatewayUrl,
    apiKey: config.apiKey,
  });

  // Start listening to pigateway events
  gatewayClient.start();

  const server = createServer(sceneManager, config);

  try {
    const address = await server.listen({
      port: config.port,
      host: config.host,
    });
    console.log(`[pispace] Spatial server listening at ${address}`);
    console.log(`[pispace] Connected to PiGateway at ${config.gatewayUrl}`);
  } catch (err) {
    console.error('[pispace] Failed to start server:', err);
    process.exit(1);
  }

  const shutdown = async () => {
    console.log('[pispace] Shutting down...');
    gatewayClient.stop();
    sceneManager.stop();
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[pispace] Fatal error:', err);
  process.exit(1);
});
