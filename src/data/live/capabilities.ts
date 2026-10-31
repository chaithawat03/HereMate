// Decides which Live features the deployed Staging backend actually serves.
// An unauthenticated POST to a deployed route is rejected with 401/403 by the
// server's bearer check; an undeployed route returns 404. No token is sent.
import type { Capabilities } from '../types.ts';

export const PROBE_TIMEOUT_MS = 3000;

type ProbePorts = {
  fetchImpl: (url: string, init: { method: string; headers?: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{ status: number }>;
  baseUrl: string;
  timeoutMs: number;
};

async function routeDeployed(p: ProbePorts, path: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), p.timeoutMs);
  try {
    const res = await p.fetchImpl(p.baseUrl + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: controller.signal,
    });
    return res.status === 401 || res.status === 403;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeCapabilities(p: ProbePorts): Promise<Capabilities> {
  const [geofences, backgroundSharing] = await Promise.all([
    routeDeployed(p, '/v1/geofences/review'),
    routeDeployed(p, '/v1/locations/background/start'),
  ]);
  // No phone-login route and no wave route exist on the Staging backend.
  return { phoneLogin: false, geofences, backgroundSharing, wave: false };
}
