/**
 * M4 opt-in two-party geofence consent UI for a future reviewed Staging API.
 * Unmounted by default in Android/iOS build profiles. GPS observation is
 * optional, explicitly started, foreground-only and capped at 60 seconds.
 * Tracked subject reviews exact proposed circle BEFORE approval and always
 * has an independent revoke control, including after a friendship is removed.
 * Circle and observed event live only in React memory and clear on
 * background, auth change or unmount; no history/local storage/push.
 */
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {
 Alert,AppState,Platform,Pressable,StyleSheet,Text,TextInput,View
} from 'react-native';
import * as Location from 'expo-location';
import {onAuthStateChanged} from 'firebase/auth';
import {getStagingGuestAuth} from '../auth/firebaseGuest';
import {listOwnRequests} from '../friends/firestoreFriends';
import {otherParticipant,type FriendRequest} from '../friends/friendModel';
import {usePreferences} from '../ui/PreferencesProvider';
import type {Palette} from '../ui/preferencesModel';
import type {GeofenceCircle,M4Transport} from './m4StagingTransport';
import {createM4ForegroundZoneWatch,type M4WatchPhase} from './m4ForegroundZoneWatch';
import {evaluateM4OneShotForegroundFix} from './m4OneShotForegroundFix';
import {createAccountScopedFriendRefresh} from '../location/accountScopedFriendRefresh';

type Props=Readonly<{transport:M4Transport;backendReviewedAndEnabled:boolean}>;
export function M4GeofencePanel({transport,backendReviewedAndEnabled}:Props){
 const {colors:c,language}=usePreferences();
 const s=useMemo(()=>styles(c),[c]);
 const label=(th:string,en:string)=>language==='th'?th:en;
 const [friends,setFriends]=useState<FriendRequest[]>([]);
 const [selected,setSelected]=useState<string|null>(null);
 const [lat,setLat]=useState('');
 const [lon,setLon]=useState('');
 const [radius,setRadius]=useState('350');
 const [reviewed,setReviewed]=useState<{
   ownerUid:string;circle:GeofenceCircle;proposalCreatedAtMs:number;
 }|null>(null);
 const [busy,setBusy]=useState(false);
 const [foregroundRevision,setForegroundRevision]=useState(0);
 const [error,setError]=useState(false);
 const [message,setMessage]=useState('');
 const [watchPhase,setWatchPhase]=useState<M4WatchPhase>('off');
 // Session-only Android alert preference: OFF on every launch/revoke/background.
 const [foregroundAlerts,setForegroundAlerts]=useState(false);
 const alertsRef=useRef(false);
 const zoneWatch=useRef<ReturnType<typeof createM4ForegroundZoneWatch>|null>(null);
 const identity=useRef<string|null>(null);
 const friendGate=useRef<ReturnType<typeof createAccountScopedFriendRefresh>|null>(null);
 const seq=useRef(0),alive=useRef(false),processing=useRef(false);
 const clearSensitive=useCallback(()=>{
   zoneWatch.current?.stop();
   friendGate.current?.invalidate();
   alertsRef.current=false;
   ++seq.current;
   processing.current=false;
   if(alive.current){
     setForegroundAlerts(false);
     setFriends([]);setBusy(false);
     setReviewed(null);setMessage('');setError(false);
     setLat('');setLon('');setSelected(null);
   }
 },[]);
 useEffect(()=>{
   if(!backendReviewedAndEnabled)return;
   alive.current=true;
   const auth=getStagingGuestAuth();
   identity.current=auth.currentUser?.uid??null;
   const gate=createAccountScopedFriendRefresh({
     // Consult actual Firebase, not the last asynchronous auth callback.
     currentUid:()=>{
       const actual=auth.currentUser?.uid??null;
       return actual===identity.current?actual:null;
     },
     isForeground:()=>AppState.currentState==='active'
   });
   friendGate.current=gate;
   const sub=onAuthStateChanged(auth,user=>{
     const uid=user?.uid??null;
     if(uid!==identity.current){
       identity.current=uid;
       clearSensitive();
       if(AppState.currentState==='active')
         setForegroundRevision(v=>v+1);
     }
   },()=>{
     identity.current=null;
     clearSensitive();
   });
   const app=AppState.addEventListener('change',status=>{
     if(status!=='active')clearSensitive();
     else setForegroundRevision(v=>v+1);
   });
   return()=>{
     alive.current=false;
     gate.dispose();
     if(friendGate.current===gate)friendGate.current=null;
     seq.current++;sub();app.remove();
     zoneWatch.current?.stop();
     identity.current=null;
   };
 },[backendReviewedAndEnabled,clearSensitive]);
 // This watcher only exists in a separately reviewed, opt-in M4 Staging
 // build. It never registers a background location task or a push token.
 useEffect(()=>{
   if(!backendReviewedAndEnabled)return;
   const controller=createM4ForegroundZoneWatch({
     identity:()=>getStagingGuestAuth().currentUser?.uid??null,
     isForeground:()=>AppState.currentState==='active',
     requestPermission:async()=>{
       if(AppState.currentState!=='active'||
          !(await Location.hasServicesEnabledAsync()))return false;
       const grant=await Location.requestForegroundPermissionsAsync();
       return grant.granted===true&&AppState.currentState==='active';
     },
     hasPermission:async()=>AppState.currentState==='active'&&
       (await Location.hasServicesEnabledAsync())&&
       (await Location.getForegroundPermissionsAsync()).granted===true,
     watch:async(onFix,onError)=>{
       const sub=await Location.watchPositionAsync({
         accuracy:Location.Accuracy.Balanced,timeInterval:10_000,
         distanceInterval:10
       },gps=>onFix({
         latitude:gps.coords.latitude,longitude:gps.coords.longitude,
         accuracyMeters:gps.coords.accuracy??Infinity,
         capturedAtMs:gps.timestamp
       }),onError);
       return {remove:()=>sub.remove()};
     },
     evaluate:async(ownerUid,fix)=>(await transport.evaluate(ownerUid,fix)).event,
     now:Date.now,
     schedule:(fn,ms)=>setTimeout(fn,ms),
     cancel:handle=>clearTimeout(handle as ReturnType<typeof setTimeout>),
     onPhase:phase=>{if(alive.current)setWatchPhase(phase);},
     onEvent:event=>{
       if(!alive.current||AppState.currentState!=='active')return;
       setMessage(event==='enter'?
         (language==='th'?'ยืนยันว่าเข้าสู่พื้นที่':'Confirmed zone entry'):
         (language==='th'?'ยืนยันว่าออกจากพื้นที่':'Confirmed zone exit'));
       // A notification is NEVER generated from a stale/ambiguous fix,
       // only a server-confirmed event returned to the tracked subject.
       // This is a local foreground alert, NOT an OS push subscription.
       if(Platform.OS==='android'&&alertsRef.current){
         Alert.alert(
           language==='th'?'แจ้งเตือนพื้นที่ (HereMate)':'HereMate zone update',
           event==='enter'?
             (language==='th'?'ตรวจพบการเข้าสู่พื้นที่ที่อนุมัติแล้ว':'Entered your approved zone'):
             (language==='th'?'ตรวจพบการออกจากพื้นที่ที่อนุมัติแล้ว':'Exited your approved zone')
         );
       }
     },
     onFailure:()=>{if(alive.current)setError(true);}
   });
   zoneWatch.current=controller;
   return()=>{
     controller.dispose();
     if(zoneWatch.current===controller)zoneWatch.current=null;
   };
 },[backendReviewedAndEnabled,transport,language]);
 const reload=useCallback(async()=>{
   if(!backendReviewedAndEnabled||AppState.currentState!=='active')return;
   await friendGate.current?.run(listOwnRequests,(rows,user)=>{
     if(!alive.current)return;
     setFriends(rows.filter(r=>r.senderUid===user||r.recipientUid===user));
     setError(false);
   },()=>{if(alive.current)setError(true);});
 },[backendReviewedAndEnabled]);
 useEffect(()=>{if(backendReviewedAndEnabled)void reload();},
   [backendReviewedAndEnabled,reload,foregroundRevision]);
 const uid=identity.current;
 const current=friends.find(f=>f.id===selected);
 const peer=current&&uid?otherParticipant(current,uid):null;
 const relationApproved=!!current&&current.status==='accepted'&&
   current.senderConsent===true&&current.recipientConsent===true;
 useEffect(()=>{
   if(!relationApproved)zoneWatch.current?.stop();
 },[relationApproved,selected]);
 const validCircleInput=()=>{
   if(!lat.trim()||!lon.trim()||!radius.trim())return null;
   const latitude=Number(lat),longitude=Number(lon),radiusMeters=Number(radius);
   if(!Number.isFinite(latitude)||latitude< -90||latitude>90||
      !Number.isFinite(longitude)||longitude< -180||longitude>180||
      !Number.isFinite(radiusMeters)||radiusMeters<100||radiusMeters>5000)
      return null;
   return {latitude,longitude,radiusMeters};
 };
 async function run(work:(isCurrent:()=>boolean)=>Promise<string>){
   const actor=identity.current;
   if(processing.current||!actor||AppState.currentState!=='active')return;
   processing.current=true;setBusy(true);setError(false);setMessage('');
   const currentRun=++seq.current;
   const isCurrent=()=>alive.current&&seq.current===currentRun&&
     identity.current===actor&&
     getStagingGuestAuth().currentUser?.uid===actor&&
     AppState.currentState==='active';
   try{
     const success=await work(isCurrent);
     if(isCurrent())setMessage(success);
   }catch{
     if(isCurrent())setError(true);
   }finally{
     // Cancelled requests must not release the mutex of a newer request.
     if(seq.current===currentRun){
       processing.current=false;
       if(alive.current)setBusy(false);
     }
   }
 }
 async function checkCurrentLocation(ownerUid:string,isCurrent:()=>boolean){
   const event=await evaluateM4OneShotForegroundFix({
     // run() captures the exact Firebase UID, foreground state and operation
     // generation. Recheck after EACH async native permission/GPS step before
     // sending a private fix to the geofence API.
     isCurrent,
     servicesEnabled:()=>Location.hasServicesEnabledAsync(),
     requestPermission:async()=>
       (await Location.requestForegroundPermissionsAsync()).granted===true,
     hasPermission:async()=>AppState.currentState==='active'&&
       (await Location.hasServicesEnabledAsync())&&
       (await Location.getForegroundPermissionsAsync()).granted===true,
     getCurrentFix:async()=>{
       const gps=await Location.getCurrentPositionAsync({
         accuracy:Location.Accuracy.Balanced
       });
       return {latitude:gps.coords.latitude,longitude:gps.coords.longitude,
         accuracyMeters:gps.coords.accuracy??Infinity,capturedAtMs:gps.timestamp};
     },
     evaluate:async fix=>(await transport.evaluate(ownerUid,fix)).event,
     now:Date.now,
     monotonicNow:()=>globalThis.performance?.now?.()??NaN
   });
   // No coordinate state, persistence or logging. Never show a stale result.
   return event==='enter'?label('เข้าสู่พื้นที่','Entered zone'):
      event==='exit'?label('ออกจากพื้นที่','Exited zone'):
      label('ไม่มีเหตุการณ์เข้า–ออกที่ยืนยันได้','No confirmed transition');
 }
 if(!backendReviewedAndEnabled)return <View style={s.panel}>
   <Text style={s.title}>M4 Geofence</Text>
   <Text style={s.note}>{label('ยังไม่เปิดใช้งาน','Not available')}</Text>
 </View>;
 return <View style={s.panel}>
   <Text style={s.title}>{label('พื้นที่แจ้งเตือน (M4)','Geofence approvals (M4)')}</Text>
   <Text style={s.note}>{label(
     'แต่ละพื้นที่ต้องได้รับความยินยอมจากผู้ถูกติดตามก่อนเสมอ ไม่มีการเก็บประวัติการเดินทางหรือการติดตามเบื้องหลัง',
     'The tracked person must approve each exact zone. No movement history or background tracking'
   )}</Text>
   <Pressable accessibilityRole="button" disabled={busy} style={s.secondary}
     onPress={()=>void reload()}>
     <Text style={s.secondaryText}>{label('รีเฟรชรายชื่อ','Refresh friends')}</Text>
   </Pressable>
   {friends.map(friend=>{
     const other=uid?otherParticipant(friend,uid):null;
     if(!other)return null;
     const selectedNow=selected===friend.id;
     return <Pressable key={friend.id} accessibilityRole="button"
       disabled={busy} accessibilityState={{selected:selectedNow}}
       onPress={()=>{zoneWatch.current?.stop();setSelected(friend.id);setReviewed(null);setMessage('');setError(false);}}
       style={[s.item,selectedNow&&s.selected]}>
       <Text style={s.itemText}>{other.displayName}</Text>
       <Text style={s.note}>{friend.status==='accepted'&&
         friend.senderConsent&&friend.recipientConsent?
         label('ทั้งคู่เปิดความยินยอม','Both currently consent'):
         label('ไม่พร้อมสำหรับสร้างพื้นที่ใหม่ — ยังเพิกถอนได้',
           'New proposals unavailable; revocation remains possible')}</Text>
     </Pressable>;
   })}
   {peer&&current&&uid?<>
     <Text style={s.note}>{label('เพื่อนที่เลือก: ','Selected friend: ')}{peer.displayName}</Text>
     <Text style={s.note}>{label(
       'เจ้าของพื้นที่สามารถเสนอพิกัดได้ แต่ไม่สามารถกดยินยอมแทนอีกฝ่าย',
       'Zone owner can propose coordinates, but cannot approve for the tracked person'
     )}</Text>
     {relationApproved?<View style={s.subpanel}>
       <Text style={s.label}>{label('เสนอพื้นที่ใหม่ให้เพื่อน','Propose a new zone to friend')}</Text>
       <TextInput style={s.input} value={lat} onChangeText={setLat}
         accessibilityLabel={label('ละติจูด','Latitude')}
         placeholder={label('ละติจูด เช่น 13.75','Latitude e.g. 13.75')}
         placeholderTextColor={c.muted} keyboardType="numbers-and-punctuation"/>
       <TextInput style={s.input} value={lon} onChangeText={setLon}
         accessibilityLabel={label('ลองจิจูด','Longitude')}
         placeholder={label('ลองจิจูด เช่น 100.5','Longitude e.g. 100.5')}
         placeholderTextColor={c.muted} keyboardType="numbers-and-punctuation"/>
       <TextInput style={s.input} value={radius} onChangeText={setRadius}
         accessibilityLabel={label('รัศมีเมตร','Radius meters')}
         placeholder={label('รัศมี 100–5000 เมตร','Radius 100–5000 meters')}
         placeholderTextColor={c.muted} keyboardType="numeric"/>
       <Pressable accessibilityRole="button" disabled={busy||!validCircleInput()}
         style={[s.primary,(busy||!validCircleInput())&&s.disabled]}
         onPress={()=>void run(async()=>{
           const circle=validCircleInput();
           if(!circle)throw Error('invalid circle');
           await transport.propose(peer.uid,circle);
           return label('ส่งคำขอแล้ว ต้องรออีกฝ่ายอนุมัติ','Proposal sent; awaiting subject approval');
         })}>
         <Text style={s.primaryText}>{label('ส่งคำขอเสนอพื้นที่','Propose zone')}</Text>
       </Pressable>
     </View>:null}
     {relationApproved?<View style={s.subpanel}>
       <Text style={s.label}>{label('พื้นที่ที่เพื่อนเสนอให้คุณ','Zone proposed for you')}</Text>
       <Pressable accessibilityRole="button" disabled={busy} style={s.secondary}
         onPress={()=>void run(async isCurrent=>{
           const pending=await transport.review(peer.uid);
           if(isCurrent())setReviewed({ownerUid:peer.uid,
             circle:pending.circle,proposalCreatedAtMs:pending.proposalCreatedAtMs});
           return label('ตรวจพิกัดและรัศมีด้านล่างก่อนตัดสินใจ',
             'Inspect exact coordinates/radius before deciding');
         })}><Text style={s.secondaryText}>{label('ตรวจคำขอที่รออนุมัติ','Review pending proposal')}</Text>
       </Pressable>
       {reviewed?.ownerUid===peer.uid?<View style={s.review}>
         <Text style={s.itemText}>{label('ละติจูด','Latitude')}: {String(reviewed.circle.latitude)}</Text>
         <Text style={s.itemText}>{label('ลองจิจูด','Longitude')}: {String(reviewed.circle.longitude)}</Text>
         <Text style={s.itemText}>{label('รัศมี','Radius')}: {String(reviewed.circle.radiusMeters)} m</Text>
         <Text style={s.note}>{label(
           'การอนุมัติอนุญาตการตรวจเข้า–ออกพื้นที่นี้เท่านั้น ไม่ใช่อนุญาตการบันทึกประวัติ GPS',
           'Approval covers this exact zone only, not GPS history retention'
         )}</Text>
         <View style={s.actions}>
           <Pressable accessibilityRole="button" disabled={busy} style={s.primary}
             onPress={()=>void run(async isCurrent=>{
               await transport.decide(peer.uid,true,reviewed.proposalCreatedAtMs);
               if(isCurrent())setReviewed(null);
               return label('อนุมัติพื้นที่นี้แล้ว','Zone approved');
             })}><Text style={s.primaryText}>{label('อนุมัติ','Approve')}</Text></Pressable>
           <Pressable accessibilityRole="button" disabled={busy} style={s.secondary}
             onPress={()=>void run(async isCurrent=>{
               await transport.decide(peer.uid,false,reviewed.proposalCreatedAtMs);
               if(isCurrent())setReviewed(null);
               return label('ปฏิเสธคำขอแล้ว','Proposal rejected');
             })}><Text style={s.secondaryText}>{label('ปฏิเสธ','Reject')}</Text></Pressable>
         </View>
       </View>:null}
     </View>:null}
     <View style={s.subpanel}>
       <Text style={s.label}>{label('ถอนความยินยอมได้ตลอดเวลา','Revoke either zone at any time')}</Text>
       <Pressable accessibilityRole="button" disabled={busy} style={s.destructive}
         onPress={()=>void run(async isCurrent=>{
           zoneWatch.current?.stop();
           alertsRef.current=false;setForegroundAlerts(false);
           await transport.revoke(peer.uid,uid);
           if(isCurrent())setReviewed(null);
           return label('ถอนอนุญาตที่เพื่อนสร้างให้คุณแล้ว',
             'Revoked zone proposed by your friend');
         })}><Text style={s.destructiveText}>{label(
           'เพิกถอนพื้นที่ที่เพื่อนสร้างให้ฉัน','Revoke a zone tracking me'
         )}</Text></Pressable>
       <Pressable accessibilityRole="button" disabled={busy} style={s.secondary}
         onPress={()=>void run(async()=>{
           zoneWatch.current?.stop();
           alertsRef.current=false;setForegroundAlerts(false);
           await transport.revoke(uid,peer.uid);
           return label('ยกเลิกพื้นที่ที่คุณเสนอแล้ว','Revoked zone you proposed');
         })}><Text style={s.secondaryText}>{label(
           'ยกเลิกพื้นที่ที่ฉันเสนอให้เพื่อน','Revoke my proposed zone'
         )}</Text></Pressable>
     </View>
     {relationApproved?<Pressable accessibilityRole="button"
       disabled={busy||watchPhase!=='off'} style={s.secondary}
       onPress={()=>void run(isCurrent=>checkCurrentLocation(peer.uid,isCurrent))}>
       <Text style={s.secondaryText}>{label(
         'ตรวจเข้า–ออกพื้นที่จาก GPS ตอนนี้ (ต้องแชร์กับเพื่อนอยู่)',
         'Check my current zone (requires active M2 sharing)'
       )}</Text>
     </Pressable>:null}
     {relationApproved?<View style={s.subpanel}>
       <Text style={s.note}>{label(
         'การเฝ้าดูพื้นที่เป็นตัวเลือก: ใช้ GPS เฉพาะตอนเปิดแอป สูงสุด 60 วินาที ต้องมี M2 sharing และพื้นที่ที่อีกฝ่ายอนุมัติแล้ว ไม่มี Push หรือการติดตามเบื้องหลัง',
         'Optional: watch the zone for up to 60 seconds while this app is open. Requires active M2 sharing and subject-approved zone. No push or background tracking'
       )}</Text>
       {Platform.OS==='android'?<Pressable accessibilityRole="button"
         accessibilityState={{checked:foregroundAlerts}}
         disabled={busy} style={s.secondary}
         onPress={()=>{
           const next=!alertsRef.current;
           alertsRef.current=next;setForegroundAlerts(next);
         }}>
         <Text style={s.secondaryText}>{foregroundAlerts?
           label('ปิดแจ้งเตือนเมื่อเปิดแอป','Disable in-app zone alerts'):
           label('เปิดแจ้งเตือนเมื่อเปิดแอป','Enable in-app zone alerts')}</Text>
       </Pressable>:null}
       <Pressable accessibilityRole="button" disabled={busy}
         style={watchPhase==='off'?s.primary:s.destructive}
         onPress={()=>{
           if(watchPhase==='off'){
             setError(false);setMessage('');
             void zoneWatch.current?.start(peer.uid,relationApproved);
           }else zoneWatch.current?.stop();
         }}>
         <Text style={watchPhase==='off'?s.primaryText:s.destructiveText}>
           {watchPhase==='off'?label('เริ่มเฝ้าดู 60 วินาที','Start 60-second zone watch'):
             label('หยุดเฝ้าดูทันที','Stop zone watch')}
         </Text>
       </Pressable>
       {watchPhase==='watching'?<Text style={s.note}>
         {label('กำลังตรวจพื้นที่เฉพาะตอนเปิดแอป','Foreground zone watch active')}
       </Text>:null}
     </View>:null}
   </>:<Text style={s.note}>{label(
     'เลือกเพื่อนที่มีอยู่เพื่อจัดการพื้นที่และเพิกถอนสิทธิ์',
     'Select an existing friend to manage zones and revocation'
   )}</Text>}
   {error?<Text accessibilityRole="alert" style={s.error}>{label(
     'ทำรายการไม่ได้ โปรดตรวจสิทธิ์และลองใหม่',
     'Unavailable; verify permissions and try again'
   )}</Text>:null}
   {message?<Text accessibilityRole="alert" style={s.note}>{message}</Text>:null}
 </View>;
}
const styles=(c:Palette)=>StyleSheet.create({
 panel:{padding:16,backgroundColor:c.surface,borderRadius:15,borderWidth:1,
   borderColor:c.line,gap:12},
 title:{fontSize:17,color:c.accent,fontWeight:'800'},
 note:{fontSize:12,color:c.muted,lineHeight:19},
 label:{fontSize:13,color:c.text,fontWeight:'700'},
 item:{padding:12,borderRadius:10,borderColor:c.line,borderWidth:1,gap:4},
 selected:{borderColor:c.accent,borderWidth:2},
 itemText:{color:c.text,fontSize:13,fontWeight:'700'},
 subpanel:{padding:12,backgroundColor:c.surfaceAlt,borderRadius:10,gap:9},
 input:{padding:11,borderRadius:9,borderWidth:1,borderColor:c.line,
   backgroundColor:c.field,color:c.text,fontSize:13},
 primary:{alignSelf:'flex-start',padding:11,borderRadius:9,backgroundColor:c.accent},
 primaryText:{color:c.accentOn,fontSize:12,fontWeight:'800'},
 secondary:{alignSelf:'flex-start',padding:10,borderRadius:9,
   borderColor:c.line,borderWidth:1,backgroundColor:c.surfaceAlt},
 secondaryText:{color:c.text,fontSize:12,fontWeight:'700'},
 destructive:{alignSelf:'flex-start',padding:11,borderRadius:9,
   backgroundColor:c.dangerButton},
 destructiveText:{color:'#FFFFFF',fontSize:12,fontWeight:'800'},
 actions:{flexDirection:'row',gap:12,flexWrap:'wrap'},
 review:{gap:7,padding:10,borderColor:c.accent,borderWidth:1,borderRadius:9},
 disabled:{opacity:.45},
 error:{fontSize:12,color:c.error,fontWeight:'700'}
});
