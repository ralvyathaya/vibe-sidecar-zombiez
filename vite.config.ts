import { readFile, writeFile } from 'node:fs/promises';
import { defineConfig } from 'vite';

type Vec3Tuple = [number, number, number];

type DebugTransformSnapshot = {
  position?: Vec3Tuple;
  rotationDegrees?: Vec3Tuple;
  scale?: Vec3Tuple;
};

type DebugConfigPayload = {
  transforms?: Record<string, DebugTransformSnapshot>;
  tunings?: Record<string, Record<string, number>>;
};

const CONFIG_FILE = new URL('./src/core/config.ts', import.meta.url);

export default defineConfig({
  plugins: [debugConfigWriterPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three/examples/jsm/')) {
            return 'three-examples';
          }

          if (id.includes('node_modules/three/')) {
            return 'three-core';
          }

          return undefined;
        },
      },
    },
  },
});

function debugConfigWriterPlugin() {
  return {
    name: 'joe-must-drive-debug-config-writer',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (path: string, handler: (request: any, response: any) => void) => void } }) {
      server.middlewares.use('/__debug/save-config', (request, response) => {
        void handleSaveConfigRequest(request, response);
      });
    },
  };
}

async function handleSaveConfigRequest(request: any, response: any): Promise<void> {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Use POST.' });
    return;
  }

  try {
    const payload = JSON.parse(await readRequestBody(request)) as DebugConfigPayload;
    const draftCount =
      Object.keys(payload.transforms ?? {}).length +
      Object.keys(payload.tunings ?? {}).length;

    if (draftCount <= 0) {
      sendJson(response, 400, {
        error: 'No F2 drafts to save. Change a field or click Apply Target first.',
      });
      return;
    }

    const source = await readFile(CONFIG_FILE, 'utf8');
    const result = applyDebugConfigPayload(source, payload);
    await writeFile(CONFIG_FILE, result.source, 'utf8');
    sendJson(response, 200, {
      message: `Saved ${result.applied} F2 config value(s) to src/core/config.ts. Rebuild/redeploy to publish.`,
    });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Failed to save config.',
    });
  }
}

function applyDebugConfigPayload(source: string, payload: DebugConfigPayload): { source: string; applied: number } {
  let next = source;
  let applied = 0;
  const transforms = payload.transforms ?? {};

  const applyRolePosition = (target: string, block: string, property: string) => {
    const position = transforms[target]?.position;
    if (!position) {
      return;
    }
    next = replaceArrayInBlock(next, block, property, position);
    applied += 1;
  };

  applyRolePosition('driverCamera', 'driver', 'cameraOffset');
  applyRolePosition('gunnerCamera', 'gunner', 'cameraOffset');
  applyRolePosition('driverSeat', 'driver', 'seatPivotPosition');
  applyRolePosition('gunnerSeat', 'gunner', 'seatPivotPosition');

  const applyFpsViewmodel = (target: string, block: string) => {
    const snapshot = transforms[target];
    if (!snapshot) {
      return;
    }
    next = applyTransformToBlock(next, block, snapshot);
    applied += countTransformFields(snapshot);
  };

  applyFpsViewmodel('driverPistolViewmodel', 'driver_pistol');
  applyFpsViewmodel('gunnerHandgunViewmodel', 'gunner_handgun');
  applyFpsViewmodel('gunnerShotgunViewmodel', 'gunner_shotgun');
  applyFpsViewmodel('gunnerBazookaViewmodel', 'gunner_bazooka');
  if (
    transforms.pistolViewmodel &&
    !transforms.driverPistolViewmodel &&
    !transforms.gunnerHandgunViewmodel
  ) {
    applyFpsViewmodel('pistolViewmodel', 'gunner_handgun');
  }
  if (transforms.shotgunViewmodel && !transforms.gunnerShotgunViewmodel) {
    applyFpsViewmodel('shotgunViewmodel', 'gunner_shotgun');
  }
  if (transforms.bazookaViewmodel && !transforms.gunnerBazookaViewmodel) {
    applyFpsViewmodel('bazookaViewmodel', 'gunner_bazooka');
  }

  const assaultRifle = transforms.assaultRifleViewmodel;
  if (assaultRifle) {
    next = applyTransformToNestedBlock(next, 'assaultRifle', 'viewmodel', assaultRifle);
    applied += countTransformFields(assaultRifle);
  }

  const shotgunSpray = payload.tunings?.shotgunSpray;
  if (shotgunSpray) {
    for (const key of [
      'spread',
      'spreadKick',
      'pelletsPerShot',
      'pelletVisualCount',
      'pelletTraceMinLength',
      'pelletTraceMaxLength',
      'pelletTraceDuration',
      'pelletTraceMuzzleForward',
      'pelletTraceWidth',
      'pelletTraceGlowWidth',
      'pelletJitter',
      'burstAimDistance',
    ]) {
      if (typeof shotgunSpray[key] === 'number') {
        next = replaceScalarInBlock(next, 'shotgun', key, shotgunSpray[key]);
        applied += 1;
      }
    }
  }

  const handgunTrace = payload.tunings?.handgunTrace;
  if (handgunTrace) {
    for (const key of ['duration', 'width', 'glowWidth', 'opacity', 'missLength']) {
      if (typeof handgunTrace[key] === 'number') {
        next = replaceScalarInNestedBlock(next, 'weapon', 'tracer', key, handgunTrace[key]);
        applied += 1;
      }
    }
  }

  const motorHeadlight = payload.tunings?.motorHeadlight;
  if (motorHeadlight) {
    next = applyMotorHeadlightTuning(next, motorHeadlight);
    applied += Object.keys(motorHeadlight).length;
  }

  return { source: next, applied };
}

function applyMotorHeadlightTuning(source: string, tuning: Record<string, number>): string {
  let next = source;
  if (hasNumbers(tuning, ['positionX', 'positionY', 'positionZ'])) {
    next = replaceArrayInBlock(next, 'stage1Rig', 'headlightPosition', [
      tuning.positionX,
      tuning.positionY,
      tuning.positionZ,
    ]);
  }
  if (hasNumbers(tuning, ['targetX', 'targetY', 'targetZ'])) {
    next = replaceArrayInBlock(next, 'stage1Rig', 'headlightTargetPosition', [
      tuning.targetX,
      tuning.targetY,
      tuning.targetZ,
    ]);
  }
  if (hasNumbers(tuning, ['fillTargetX', 'fillTargetY', 'fillTargetZ'])) {
    next = replaceArrayInBlock(next, 'stage1Rig', 'headlightFillTargetPosition', [
      tuning.fillTargetX,
      tuning.fillTargetY,
      tuning.fillTargetZ,
    ]);
  }

  const scalarMap: Record<string, string> = {
    intensity: 'headlightIntensity',
    distance: 'headlightDistance',
    fillIntensity: 'headlightFillIntensity',
    fillDistance: 'headlightFillDistance',
    nearIntensity: 'nearFillIntensity',
    nearDistance: 'nearFillDistance',
    hotspotOpacity: 'headlightHotspotOpacity',
    spillOpacity: 'headlightSpillOpacity',
    glowOpacity: 'headlightGlowOpacity',
  };

  for (const [sourceKey, configKey] of Object.entries(scalarMap)) {
    if (typeof tuning[sourceKey] === 'number') {
      next = replaceScalarInBlock(next, 'stage1Rig', configKey, tuning[sourceKey]);
    }
  }

  return next;
}

function applyTransformToBlock(source: string, block: string, snapshot: DebugTransformSnapshot): string {
  let next = source;
  if (snapshot.position) {
    next = replaceArrayInBlock(next, block, 'position', snapshot.position);
  }
  if (snapshot.rotationDegrees) {
    next = replaceArrayInBlock(next, block, 'rotationDegrees', snapshot.rotationDegrees);
  }
  if (snapshot.scale) {
    next = replaceScalarInBlock(next, block, 'scale', averageScale(snapshot.scale));
  }
  return next;
}

function applyTransformToNestedBlock(
  source: string,
  outerBlock: string,
  innerBlock: string,
  snapshot: DebugTransformSnapshot,
): string {
  let next = source;
  if (snapshot.position) {
    next = replaceArrayInNestedBlock(next, outerBlock, innerBlock, 'position', snapshot.position);
  }
  if (snapshot.rotationDegrees) {
    next = replaceArrayInNestedBlock(next, outerBlock, innerBlock, 'rotationDegrees', snapshot.rotationDegrees);
  }
  if (snapshot.scale) {
    next = replaceScalarInNestedBlock(next, outerBlock, innerBlock, 'scale', averageScale(snapshot.scale));
  }
  return next;
}

function replaceArrayInBlock(source: string, block: string, property: string, values: Vec3Tuple): string {
  const pattern = new RegExp(
    `(^\\s*${escapeRegExp(block)}:\\s*{[\\s\\S]*?^\\s*${escapeRegExp(property)}:\\s*)\\[[^\\]]*\\]`,
    'm',
  );
  return replaceRequired(source, pattern, `$1${formatTuple(values)}`, `${block}.${property}`);
}

function replaceArrayInNestedBlock(
  source: string,
  outerBlock: string,
  innerBlock: string,
  property: string,
  values: Vec3Tuple,
): string {
  const pattern = new RegExp(
    `(^\\s*${escapeRegExp(outerBlock)}:\\s*{[\\s\\S]*?^\\s*${escapeRegExp(innerBlock)}:\\s*{[\\s\\S]*?^\\s*${escapeRegExp(property)}:\\s*)\\[[^\\]]*\\]`,
    'm',
  );
  return replaceRequired(source, pattern, `$1${formatTuple(values)}`, `${outerBlock}.${innerBlock}.${property}`);
}

function replaceScalarInBlock(source: string, block: string, property: string, value: number): string {
  const pattern = new RegExp(
    `(^\\s*${escapeRegExp(block)}:\\s*{[\\s\\S]*?^\\s*${escapeRegExp(property)}:\\s*)-?\\d+(?:\\.\\d+)?`,
    'm',
  );
  return replaceRequired(source, pattern, `$1${formatNumber(value)}`, `${block}.${property}`);
}

function replaceScalarInNestedBlock(
  source: string,
  outerBlock: string,
  innerBlock: string,
  property: string,
  value: number,
): string {
  const pattern = new RegExp(
    `(^\\s*${escapeRegExp(outerBlock)}:\\s*{[\\s\\S]*?^\\s*${escapeRegExp(innerBlock)}:\\s*{[\\s\\S]*?^\\s*${escapeRegExp(property)}:\\s*)-?\\d+(?:\\.\\d+)?`,
    'm',
  );
  return replaceRequired(source, pattern, `$1${formatNumber(value)}`, `${outerBlock}.${innerBlock}.${property}`);
}

function replaceRequired(source: string, pattern: RegExp, replacement: string, label: string): string {
  if (!pattern.test(source)) {
    throw new Error(`Could not find config path ${label}.`);
  }
  return source.replace(pattern, replacement);
}

function countTransformFields(snapshot: DebugTransformSnapshot): number {
  return Number(Boolean(snapshot.position)) + Number(Boolean(snapshot.rotationDegrees)) + Number(Boolean(snapshot.scale));
}

function hasNumbers(record: Record<string, number>, keys: string[]): boolean {
  return keys.every((key) => typeof record[key] === 'number');
}

function averageScale(scale: Vec3Tuple): number {
  return (scale[0] + scale[1] + scale[2]) / 3;
}

function formatTuple(values: Vec3Tuple): string {
  return `[${values.map(formatNumber).join(', ')}]`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return Number.parseFloat(value.toFixed(4)).toString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readRequestBody(request: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 200_000) {
        reject(new Error('Debug config payload is too large.'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function sendJson(response: any, statusCode: number, payload: Record<string, unknown>): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(payload));
}
