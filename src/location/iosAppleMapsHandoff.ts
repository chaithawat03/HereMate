/**
 * M3 iOS external Apple Maps handoff formatter only.
 * Caller MUST first obtain the viewer's explicit confirmation, then re-read
 * the selected peer through the authenticated/ACL-enforced Staging transport
 * and validate a still-fresh fix. Never log or persist these coordinates.
 *
 * Apple documents HTTPS maps.apple.com Map Links for opening Maps on iOS.
 * This fixed HTTPS host has no caller-controlled query keys or redirects here.
 */
export function iosAppleMapsUri(latitude:unknown,longitude:unknown):string|null {
  if(typeof latitude!=='number'||!Number.isFinite(latitude)||
     latitude<-90||latitude>90||
     typeof longitude!=='number'||!Number.isFinite(longitude)||
     longitude<-180||longitude>180)return null;
  const lat=latitude.toFixed(6),lon=longitude.toFixed(6);
  return `https://maps.apple.com/?ll=${lat},${lon}`;
}
