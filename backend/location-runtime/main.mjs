/**
 * Dormant M2.4 Staging Firebase Admin runtime. Intentionally not deployed.
 * Start is denied unless explicitly configured on one named Cloud Run service.
 * Firebase ID tokens are verified by actual Admin Auth, not by a client UID.
 */
import {createServer} from 'node:http';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeApp,applicationDefault} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {createLocationService,STAGING_PROJECT} from '../location/location-service.mjs';
import {createFirestoreLocationStore,createFirestoreLocationRateLimiter} from '../location/firestore-location-adapters.mjs';
import {createNodeLocationHandler} from './edge.mjs';

const SERVICE_NAME='heremate-m2-location-staging';

export function validateStagingServiceEnvironment(env) {
  if(env.HEREMATE_M2_ENABLE_SERVER!=='true' ||
    env.K_SERVICE!==SERVICE_NAME ||
    env.GOOGLE_CLOUD_PROJECT!==STAGING_PROJECT ||
    (env.GCLOUD_PROJECT && env.GCLOUD_PROJECT!==STAGING_PROJECT) ||
    env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST ||
    env.GOOGLE_APPLICATION_CREDENTIALS)
    throw Error('staging_service_disabled');
  const port=Number(env.PORT);
  if(!Number.isSafeInteger(port)||port<1||port>65535)
    throw Error('staging_port_invalid');
  return port;
}

export function startStagingServer(env=process.env) {
  const port=validateStagingServiceEnvironment(env);
  // Only Cloud Run service-account ADC. Never ship a service account JSON key.
  const app=initializeApp({
    projectId:STAGING_PROJECT,
    credential:applicationDefault()
  },SERVICE_NAME);
  const db=getFirestore(app);
  const service=createLocationService({
    adminAuth:getAuth(app),
    store:createFirestoreLocationStore(db),
    rateLimiter:createFirestoreLocationRateLimiter(db)
  });
  const server=createServer(createNodeLocationHandler(service));
  server.requestTimeout=10_000;
  server.headersTimeout=10_000;
  server.timeout=10_000;
  server.keepAliveTimeout=5_000;
  server.listen(port);
  return server;
}

// Explicit executable entrypoint, no effect when imported by a unit test.
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    startStagingServer();
  }catch{
    process.stderr.write('staging_location_service_start_denied\\n');
    process.exitCode=1;
  }
}
