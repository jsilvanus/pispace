#!/usr/bin/env node

const baseUrl = process.env.PISPACE_URL ?? 'http://127.0.0.1:3203';

function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`Error (${res.status}): ${err}`);
      process.exit(1);
    }
    return await res.json();
  } catch (err) {
    console.error(`Failed to connect to pispace at ${url}:`, err.message);
    process.exit(1);
  }
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0] ?? 'help';

  switch (command) {
    case 'scene': {
      const scene = await request('/api/v1/scene');
      console.log('=== PISPACE SPATIAL SCENE ===');
      console.log(`Updated at: ${scene.updatedAt}`);
      console.log(`Active zones: ${scene.activeZones.length ? scene.activeZones.join(', ') : '(none)'}`);
      console.log('\n--- Cameras ---');
      for (const [id, cam] of Object.entries(scene.cameras)) {
        console.log(`[${id}] ${cam.mount.name}`);
        console.log(`  Mount: (${cam.mount.position.x}, ${cam.mount.position.y}, ${cam.mount.position.z}) m`);
        if (cam.telemetry) {
          console.log(`  FreeD: Pan ${cam.telemetry.pan}°, Tilt ${cam.telemetry.tilt}°, Zoom ${cam.telemetry.zoom}`);
        } else {
          console.log('  FreeD: (no telemetry received yet)');
        }
        if (cam.frustum?.activeZoneId) {
          console.log(`  Aiming at zone: ${cam.frustum.activeZoneId}`);
        }
      }
      console.log('\n--- Subjects in 3D ---');
      if (scene.subjects.length === 0) {
        console.log('(No subjects tracked)');
      } else {
        for (const s of scene.subjects) {
          console.log(`Track #${s.trackId} [${s.label}] via ${s.sourceCameraId}:`);
          console.log(`  3D Pos: (${s.position.x}, ${s.position.y}, ${s.position.z}) m`);
          console.log(`  Zone: ${s.zoneName ?? '(outside defined zones)'}`);
          console.log(`  Confidence: ${Math.round(s.confidence * 100)}%`);
        }
      }
      break;
    }

    case 'zones': {
      const zones = await request('/api/v1/zones');
      console.log('=== VENUE SPATIAL ZONES ===');
      for (const z of zones) {
        console.log(`[${z.id}] ${z.name}`);
        console.log(`  Floor Elevation: ${z.floorHeight} m | Ceiling: ${z.ceilingHeight} m`);
        console.log(`  Target Center: (${z.targetPoint.x}, ${z.targetPoint.y}, ${z.targetPoint.z}) m`);
        console.log(`  Tags: ${(z.tags || []).join(', ')}`);
      }
      break;
    }

    case 'occluders': {
      const occluders = await request('/api/v1/occluders');
      console.log('=== 3D OCCLUDERS (AR KEYMASKS) ===');
      if (occluders.length === 0) {
        console.log('(No occluders configured in this venue)');
      } else {
        for (const o of occluders) {
          console.log(`[${o.id}] ${o.name}`);
          console.log(`  Kind: ${o.kind}${o.meshUrl ? ` (Asset: ${o.meshUrl})` : ''}`);
          console.log(`  Position: (${o.position.x}, ${o.position.y}, ${o.position.z}) m`);
          if (o.dimensions) {
            console.log(`  Dimensions: ${o.dimensions.width}m W x ${o.dimensions.height}m H x ${o.dimensions.depth}m D`);
          }
        }
      }
      break;
    }

    case 'solve': {
      const cameraId = flags.camera || flags.c || 'cam1';
      const zoneId = flags.zone || flags.z;
      const shotType = flags.shot || 'medium';

      if (!zoneId) {
        console.error('Usage: pispace solve --camera cam1 --zone pulpit [--shot wide|medium|close_up|tight]');
        process.exit(1);
      }

      const solution = await request('/api/v1/solve-ptz', {
        method: 'POST',
        body: JSON.stringify({
          cameraId,
          target: { zoneId },
          shotType,
        }),
      });

      console.log(`=== PTZ SOLUTION FOR ${cameraId.toUpperCase()} ➔ ${zoneId.toUpperCase()} ===`);
      console.log(`Shot Type: ${solution.shotType}`);
      console.log(`Target 3D: (${solution.targetPoint.x}, ${solution.targetPoint.y}, ${solution.targetPoint.z}) m`);
      console.log(`Distance: ${solution.distanceMeters} m`);
      console.log(`Command Angles:`);
      console.log(`  Pan:  ${solution.pan}°`);
      console.log(`  Tilt: ${solution.tilt}°`);
      console.log(`  Zoom: ${solution.zoom} (raw FreeD) -> ~${solution.estimatedHfovDeg}° HFOV`);
      break;
    }

    case 'project': {
      const cameraId = flags.camera || 'cam1';
      const bboxStr = flags.bbox;
      if (!bboxStr) {
        console.error('Usage: pispace project --camera cam1 --bbox 0.2,0.3,0.8,0.5 [--stage 0.4]');
        process.exit(1);
      }
      const bbox = bboxStr.split(',').map(Number);
      const stageHeightMeters = Number(flags.stage ?? 0.4);

      const result = await request('/api/v1/project', {
        method: 'POST',
        body: JSON.stringify({
          cameraId,
          bbox,
          stageHeightMeters,
        }),
      });

      console.log('=== PROJECTED 3D WORLD COORDINATE ===');
      console.log(`Standing Position: (${result.standingPosition.x}, ${result.standingPosition.y}, ${result.standingPosition.z}) m`);
      console.log(`Zone: ${result.zone ? `${result.zone.name} (${result.zone.id})` : '(none)'}`);
      break;
    }

    case 'help':
    default:
      console.log(`
pispace - Spatial engine for the Pi ecosystem

Usage:
  pispace scene                         Display live spatial scene & tracked subjects
  pispace zones                         List defined 3D venue zones
  pispace occluders                     List 3D physical occluders for AR keymasking
  pispace solve --camera <id> --zone <zone> [--shot <type>]
                                        Solve Pan/Tilt/Zoom to frame a zone
  pispace project --camera <id> --bbox <ymin,xmin,ymax,xmax> [--stage <m>]
                                        Project 2D camera bbox to 3D world space
      `);
      break;
  }
}

main();
