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
import {createNodeGeofenceHandler} from '../geofences/geofence-edge.mjs';
import {createGeofenceService} from '../geofences/geofence-service.mjs';
import {createFirestoreGeofenceStore} from '../geofences/firestore-geofence-store.mjs';
import {createFirestoreGeofenceRateLimiter} from '../geofences/geofence-rate-limiter.mjs';


const SERVICE_NAME='heremate-m2-location-staging';

export function validateStagingServiceEnvironment(env) {
  if(env.HEREMATE_M2_ENABLE_SERVER!=='true' ||
    env.K_SERVICE!==SERVICE_NAME ||
    env.GOOGLE_CLOUD_PROJECT!==STAGING_PROJECT ||
    (env.GCLOUD_PROJECT && env.GCLOUD_PROJECT!==STAGING_PROJECT) ||
    env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST ||
    env.GOOGLE_APPLICATION_CREDENTIALS)
    throw Error('staging_service_disabled');
  // M4 is OFF by default. Human-approved Staging only: these flags must
  // be set only after the separate read-only ACTIVE-TTL and cost review.
  // Environment flags assert operator approval; they are NOT TTL proof.
  if(env.HEREMATE_M4_ENABLE_SERVER!==undefined&&
     env.HEREMATE_M4_ENABLE_SERVER!=='false'&&
     env.HEREMATE_M4_ENABLE_SERVER!=='true')
    throw Error('staging_m4_invalid_flag');
  if(env.HEREMATE_M4_ENABLE_SERVER==='true'&&
     (env.HEREMATE_M4_TTL_REVIEWED!=='true'||
      env.HEREMATE_M4_BUDGET_REVIEWED!=='true'))
    throw Error('staging_m4_approval_missing');
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
  // This revision only introduces a dormant M4 code path. The deployed M2
  // service will remain M2-only until separately reviewed and redeployed
  // with explicit M4 flags after ACTIVE Firestore TTL verification.
  const m2Handler=createNodeLocationHandler(service);
  let handler=m2Handler;
  if(env.HEREMATE_M4_ENABLE_SERVER==='true'){
    const m4=createGeofenceService({
      adminAuth:getAuth(app),
      store:createFirestoreGeofenceStore(db),
      rateLimiter:createFirestoreGeofenceRateLimiter(db)
    });
    handler=createStagingRouteHandler(m2Handler,createNodeGeofenceHandler(m4));
  }
  const server=createServer(handler);
  server.requestTimeout=10_000;
  server.headersTimeout=10_000;
  server.timeout=10_000;
  server.keepAliveTimeout=5_000;
  server.listen(port);
  return server;
}

// Only the exact /v1/geofences/ prefix can reach M4; unmatched paths are
// rejected by the original M2 edge. Query/body/header protections still run
// inside the specific M4 or M2 edge on every request.
export function createStagingRouteHandler(locationHandler,geofenceHandler){
  if(typeof locationHandler!=='function'||typeof geofenceHandler!=='function')
    throw Error('staging_handlers_unavailable');
  return (req,res)=>{
    const path=req.url;
    if(typeof path==='string'&&path.startsWith('/v1/geofences/'))
      return geofenceHandler(req,res);
    return locationHandler(req,res);
  };
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
