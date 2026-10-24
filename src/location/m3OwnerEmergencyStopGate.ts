/**
 * Owner-wide emergency STOP is not platform-specific: the authenticated
 * Staging server's v1 STOP revokes an M3 publisher on another device even
 * when this phone does not possess that device's transient capability.
 *
 * Keep the iOS control behind its distinct, explicit M3 foreground Staging
 * build opt-in. This gate never enables background location, permissions,
 * network transport or location collection.
 */
export function canOfferOwnerEmergencyStop(
  platform:string,
  iosM3ForegroundStagingEnabled:boolean,
  emergencyStopTransportAvailable:boolean
):boolean {
  return emergencyStopTransportAvailable&&
    (platform==='android'||
     (platform==='ios'&&iosM3ForegroundStagingEnabled));
}
