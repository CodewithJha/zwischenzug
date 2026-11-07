// Checks a Presage API key without a camera: runs the SmartSpectra SDK for ~20 s on blank
// frames and reports whether Presage accepted the key. The key is read from PRESAGE_API_KEY
// (or .env) and never printed. A blank frame has no face, so "no face" here means success.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  SmartSpectraSDK,
  MetricType,
  ProcessingStatus,
  ValidationCode,
  SmartSpectraErrorCode,
} = require('@smartspectra/node-sdk');

if (!process.env.PRESAGE_API_KEY && existsSync('.env')) process.loadEnvFile('.env');
const key = process.env.PRESAGE_API_KEY?.trim();
if (!key) {
  console.log('FAIL: no key. Put PRESAGE_API_KEY=... in .env or the environment.');
  process.exit(2);
}

const name = (table, code) => Object.keys(table).find((k) => table[k] === code) ?? code;
const t0 = Date.now();
const log = (m) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
let error = null;
let validated = false;

log(`SDK ${SmartSpectraSDK.version}, key present (${key.length} chars)`);
const sdk = new SmartSpectraSDK({
  apiKey: key,
  requestedMetrics: [MetricType.PULSE_RATE],
  enableTelemetry: false,
});
sdk.on('processingStatus', (s) => log(`status ${name(ProcessingStatus, s)}`));
sdk.on('validationStatus', (c) => {
  if (!validated) log(`first validation packet: ${name(ValidationCode, c)}`);
  validated = true;
});
sdk.on('error', (c, msg, retryable) => {
  error ??= name(SmartSpectraErrorCode, c);
  log(`error ${name(SmartSpectraErrorCode, c)} (retryable=${retryable}): ${msg}`);
});
sdk.useCustomInput();
try {
  sdk.start();
} catch (e) {
  error ??= `start threw: ${e.message}`;
}

const w = 640;
const h = 480;
const frame = Buffer.alloc(w * h * 3, 128);
const pump = setInterval(() => {
  try {
    sdk.sendFrame(frame, w, h, w * 3, 0, Date.now() * 1000);
  } catch {
    // rejected while not running; the error event says why
  }
}, 33);

setTimeout(async () => {
  clearInterval(pump);
  await sdk.stopAsync().catch(() => undefined);
  await sdk.destroy();
  if (error) console.log(`FAIL: ${error}`);
  else if (validated) console.log('OK: Presage accepted the key and the pipeline is running.');
  else console.log('UNCLEAR: no error, but no validation packet within 20 s.');
  process.exit(error ? 1 : validated ? 0 : 3);
}, 20_000);
