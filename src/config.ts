import path from 'node:path';

export interface AppConfig {
  port: number;
  host: string;
  gatewayUrl: string;
  venueFile?: string | undefined;
  apiKey?: string | undefined;
  /** Bearer key that allows PUT /api/v1/venue. Unset = venue cannot be replaced over HTTP. */
  editKey?: string | undefined;
  corsOrigins?: string[] | undefined;
  /** Folder served at /models/:filename (venue modelUrl and mesh occluders). */
  modelsDir?: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PISPACE_PORT ?? 3203);
  const host = env.PISPACE_HOST ?? '0.0.0.0';
  const gatewayUrl = env.PISPACE_GATEWAY_URL ?? env.PIGATEWAY_URL ?? 'http://127.0.0.1:3000';
  const venueFile = env.PISPACE_VENUE_FILE?.trim() || undefined;
  const apiKey = env.PISPACE_API_KEY?.trim() || undefined;
  const editKey = env.PISPACE_EDIT_KEY?.trim() || undefined;
  // Site meshes (scans) live outside this repo: PISPACE_MODELS_DIR, else `models` next to the
  // venue file, else ./models.
  const modelsDir = env.PISPACE_MODELS_DIR?.trim()
    || (venueFile ? path.join(path.dirname(path.resolve(venueFile)), 'models') : path.resolve('models'));
  const corsOrigins = env.PISPACE_CORS_ORIGINS
    ? env.PISPACE_CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : undefined;

  return {
    port,
    host,
    gatewayUrl,
    venueFile,
    apiKey,
    editKey,
    corsOrigins,
    modelsDir,
  };
}
