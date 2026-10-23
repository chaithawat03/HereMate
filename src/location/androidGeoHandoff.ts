/**
 * Android external map handoff formatter only.
 * Caller MUST obtain a fresh, server-authorized friend fix and explicit
 * opt-in confirmation before using this URI with Linking.openURL.
 * No URLs/coordinates are logged or retained.
 */
export function androidGeoUri(latitude:unknown,longitude:unknown):string|null{
 if(typeof latitude!=='number'||!Number.isFinite(latitude)||
    latitude<-90||latitude>90||
    typeof longitude!=='number'||!Number.isFinite(longitude)||
    longitude<-180||longitude>180)return null;
 const lat=latitude.toFixed(6),lon=longitude.toFixed(6);
 // Android geo: opens the phone's registered mapping app, not a hardcoded
 // third-party URL. Coordinates leave HereMate ONLY after the user agrees.
 return `geo:${lat},${lon}?q=${lat},${lon}`;
}
