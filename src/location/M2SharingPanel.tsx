/**
 * M2.2 foreground-only controls, deliberately UNMOUNTED until an independently
 * reviewed backend transport and Staging deployment exist. Do not import in App
 * or assign a no-op transport: the status must never pretend GPS is shared.
 */
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AppState,Platform,Pressable,StyleSheet,Text,View} from 'react-native';
import * as Location from 'expo-location';
import {onAuthStateChanged} from 'firebase/auth';
import {getStagingGuestAuth} from '../auth/firebaseGuest';
import {listOwnRequests} from '../friends/firestoreFriends';
import {otherParticipant,type FriendRequest} from '../friends/friendModel';
import {usePreferences} from '../ui/PreferencesProvider';
import type {Palette} from '../ui/preferencesModel';
import {
  createForegroundSharingController,isEligibleToStart,
  type ShareFix,type SharingState,type SharePorts, type ShareRelation
} from './m2ForegroundSession';

type Props={transport:SharePorts['transport']&Readonly<{
  emergencyStop?:(peerUid:string)=>Promise<{enabled:false}>;
}>;backendReviewedAndEnabled:boolean};
const initial:SharingState={phase:'off',peerUid:null,expiresAtMs:null,error:null};
function toRelation(r:FriendRequest):ShareRelation {
  return {senderUid:r.senderUid,recipientUid:r.recipientUid,status:r.status,
    senderConsent:r.senderConsent,recipientConsent:r.recipientConsent};
}
export function M2SharingPanel({transport,backendReviewedAndEnabled}:Props){
  const {colors:c,t,language}=usePreferences();
  const s=useMemo(()=>styles(c),[c]);
  const [session,setSession]=useState<SharingState>(initial);
  const [friends,setFriends]=useState<FriendRequest[]>([]);
  const [selectedUid,setSelectedUid]=useState<string|null>(null);
  const [loadError,setLoadError]=useState(false);
  const [authRevision,setAuthRevision]=useState(0);
  const [emergencyState,setEmergencyState]=useState<{
    peerUid:string;status:'running'|'confirmed'|'failed';
  }|null>(null);
  const emergencyLock=useRef(false);
  const controller=useRef<ReturnType<typeof createForegroundSharingController>|null>(null);
  const account=useRef<string|null>(null);

  useEffect(()=>{
    if(!backendReviewedAndEnabled)return;
    let live=true;
    const auth=getStagingGuestAuth();
    account.current=auth.currentUser?.uid??null;
    const ctrl=createForegroundSharingController({
      ownerUid:()=>account.current,
      isForeground:()=>AppState.currentState==='active',
      now:Date.now,
      schedule:(f,ms)=>setTimeout(f,ms),
      cancel:h=>clearTimeout(h as ReturnType<typeof setTimeout>),
      onState:value=>{if(live)setSession(value);},
      transport,
      askForegroundPermission:async()=>{
        if(!await Location.hasServicesEnabledAsync())return false;
        const result=await Location.requestForegroundPermissionsAsync();
        return result.granted===true;
      },
      watchForegroundFix:async(onFix,onError)=>{
        let watching=true;
        const watcher=await Location.watchPositionAsync(
          {accuracy:Location.Accuracy.Balanced,timeInterval:10_000,distanceInterval:20},
          value=>{
            // Recheck the actual Android OS grant for EACH candidate fix.
            // A foreground session or client boolean is never proof of
            // ongoing permission after an OS Settings revocation.
            void (async()=>{
              if(!live||!watching)return;
              if(AppState.currentState!=='active'||
                 !await Location.hasServicesEnabledAsync()||
                 !(await Location.getForegroundPermissionsAsync()).granted){
                onError();return;
              }
              if(!live||!watching||AppState.currentState!=='active')return;
              const coords=value.coords;
              const fix:ShareFix={
                latitude:coords.latitude,longitude:coords.longitude,
                accuracyMeters:coords.accuracy??Infinity,capturedAtMs:value.timestamp,
              };
              onFix(fix);
            })().catch(onError);
          },onError);
        return {remove:()=>{watching=false;watcher.remove();}};
      }
    });
    controller.current=ctrl;
    const app=AppState.addEventListener('change',next=>{
      if(next!=='active'){
        ctrl.interrupted();setEmergencyState(null);
      }
    });
    const authUnsub=onAuthStateChanged(auth,u=>{
      const uid=u?.uid??null;
      if(account.current!==uid){
        account.current=uid;ctrl.accountChanged();setEmergencyState(null);
      }
      if(live)setAuthRevision(x=>x+1);
    },()=>{account.current=null;ctrl.accountChanged();});
    return()=>{
      live=false;
      app.remove();
      authUnsub();
      ctrl.dispose();
      controller.current=null;
      account.current=null;
    };
  },[backendReviewedAndEnabled,transport]);

  const refresh=useCallback(async()=>{
    if(!backendReviewedAndEnabled)return;
    try{
      const entries=await listOwnRequests();
      setFriends(entries);
      setLoadError(false);
      const peer=session.peerUid;
      if(peer){
        const current=entries.find(r=>r.status==='accepted'&&
          (r.senderUid===peer||r.recipientUid===peer));
        controller.current?.consentChanged(current?toRelation(current):null);
      }
    }catch{setLoadError(true);controller.current?.interrupted();}
  },[backendReviewedAndEnabled,session.peerUid,authRevision]);
  useEffect(()=>{if(backendReviewedAndEnabled)void refresh();},[backendReviewedAndEnabled,refresh]);
  const owner=account.current;
  const emergencyAvailable=Platform.OS==='android'&&
    typeof transport.emergencyStop==='function';
  const safeToEmergency=()=>{
    const phase=controller.current?.getState().phase;
    return phase==='off'||phase==='stop-unconfirmed';
  };
  async function emergencyRevoke(peerUid:string){
    const actor=account.current;
    if(!emergencyAvailable||!actor||!backendReviewedAndEnabled||
       emergencyLock.current||AppState.currentState!=='active'||
       !safeToEmergency())return;
    // Restrict the UI action to currently known participant relationships,
    // including removed/declined records. Consent is NOT required for revoke.
    const hasRelationship=friends.some(r=>
      (r.senderUid===actor&&r.recipientUid===peerUid)||
      (r.recipientUid===actor&&r.senderUid===peerUid));
    if(!hasRelationship)return;
    emergencyLock.current=true;
    setEmergencyState({peerUid,status:'running'});
    try{
      const result=await transport.emergencyStop!(peerUid);
      if(result.enabled!==false)throw Error('not_confirmed');
      if(account.current!==actor||AppState.currentState!=='active')return;
      controller.current?.acknowledgeEmergencyStop(peerUid);
      setEmergencyState({peerUid,status:'confirmed'});
    }catch{
      if(account.current===actor&&AppState.currentState==='active')
        setEmergencyState({peerUid,status:'failed'});
    }finally{
      emergencyLock.current=false;
    }
  }
  const accepted=friends.filter(r=>r.status==='accepted'&&owner&&
    (r.senderUid===owner||r.recipientUid===owner));
  const chosen=accepted.find(r=>
    r.senderUid===selectedUid||r.recipientUid===selectedUid);
  const eligible=!!owner&&!!selectedUid&&!!chosen&&
    isEligibleToStart(toRelation(chosen),owner,selectedUid);

  if(!backendReviewedAndEnabled){
    return <View style={s.panel}><Text style={s.title}>{t('m2ShareTitle')}</Text>
      <Text style={s.note}>{t('m2Unavailable')}</Text></View>;
  }
  return <View style={s.panel}>
    <Text style={s.title}>{t('m2ShareTitle')}</Text>
    <Text style={s.note}>{t('m2ShareWarning')}</Text>
    <Text accessibilityRole="alert" style={[s.status,
      session.phase==='sharing'&&s.live]}>{t(
       session.phase==='sharing'?'m2SharingOn':
       session.phase==='starting'?'m2SharingStarting':
       session.phase==='stopping'?'m2SharingStopping':
       session.phase==='stop-unconfirmed'?'m2StopUnconfirmed':
       session.phase==='error'?'m2SharingError':'m2SharingOff'
    )}</Text>
    <Pressable accessibilityRole="button" style={s.secondary}
      onPress={()=>void refresh()}><Text style={s.secondaryText}>{t('m2RefreshFriends')}</Text></Pressable>
    {loadError?<Text style={s.error}>{t('m2RefreshFailed')}</Text>:null}
    {accepted.map(r=>{
      const peer=otherParticipant(r,owner??'');
      const on=selectedUid===peer.uid;
      return <Pressable key={r.id} accessibilityRole="button" disabled={session.phase!=='off'}
        accessibilityState={{selected:on}} onPress={()=>setSelectedUid(peer.uid)}
        style={[s.option,on&&s.chosen]}>
        <Text style={s.optionText}>{peer.displayName}</Text>
        <Text style={s.note}>{t(
          r.senderConsent&&r.recipientConsent?'m2MutualConsent':'m2ConsentRequired'
        )}</Text>
      </Pressable>;
    })}
    {session.phase==='off'?<Pressable accessibilityRole="button"
      disabled={!eligible||emergencyState?.status==='running'}
      style={[s.button,(!eligible||emergencyState?.status==='running')&&s.disabled]}
      onPress={()=>{
        // A racing START must never reactivate a lease while the owner is
        // trying to revoke it on another handset.
        if(emergencyLock.current)return;
        setEmergencyState(null);
        if(chosen&&selectedUid)
          void controller.current?.start(selectedUid,toRelation(chosen));
      }}><Text style={s.buttonText}>{t('m2StartSharing')}</Text></Pressable>:
      <Pressable accessibilityRole="button" style={s.stop}
        disabled={session.phase==='stopping'}
        onPress={()=>void (session.phase==='stop-unconfirmed'?
          controller.current?.retryStop():controller.current?.stop())}>
        <Text style={s.stopText}>{t(session.phase==='stop-unconfirmed'?
          'm2RetryStop':'m2StopSharing')}</Text>
      </Pressable>}
    {session.error==='permission'?<Text style={s.error}>{t('m2PermissionDenied')}</Text>:null}
    {session.error==='backend'?<Text style={s.error}>{t('m2BackendError')}</Text>:null}
    {session.error==='ineligible'?<Text style={s.error}>{t('m2ConsentRequired')}</Text>:null}
    {emergencyAvailable&&friends.length>0?<View style={s.emergencyArea}>
      <Text style={s.optionText}>{language==='th'
        ?'หยุดแชร์จากอุปกรณ์ทุกเครื่อง (บัญชีของฉัน)'
        :'Emergency stop sharing from all my devices'}</Text>
      <Text style={s.note}>{language==='th'
        ?'ใช้เมื่อโทรศัพท์อีกเครื่องยังแชร์อยู่หรือปุ่มหยุดปกติไม่สำเร็จ คำสั่งหยุดจะยืนยันกับเซิร์ฟเวอร์ และไม่กระทบการแชร์ให้เพื่อนคนอื่น'
        :'Use if another phone is sharing or normal Stop failed. Server confirmation is required; other friends are unaffected.'}</Text>
      {friends.filter(r=>owner&&
        (r.senderUid===owner||r.recipientUid===owner)).map(r=>{
        const peer=otherParticipant(r,owner??'');
        const current=emergencyState?.peerUid===peer.uid?emergencyState:null;
        return <View key={'emergency-'+r.id} style={s.emergencyRow}>
          <Text style={s.optionText}>{peer.displayName}</Text>
          <Pressable accessibilityRole="button"
            disabled={emergencyState?.status==='running'||!safeToEmergency()}
            style={[s.stop,(emergencyState?.status==='running'||!safeToEmergency())&&s.disabled]}
            onPress={()=>void emergencyRevoke(peer.uid)}>
            <Text style={s.stopText}>{language==='th'
              ?'ยืนยันหยุดแชร์ให้คนนี้จากทุกเครื่อง'
              :'Confirm stop sharing to this person from all devices'}</Text>
          </Pressable>
          {current?.status==='confirmed'?<Text accessibilityRole="alert" style={s.note}>
            {language==='th'?'เซิร์ฟเวอร์ยืนยันว่าหยุดแล้ว':'Server confirmed sharing stopped'}
          </Text>:null}
          {current?.status==='failed'?<Text accessibilityRole="alert" style={s.error}>
            {language==='th'?'ยังยืนยันการหยุดไม่ได้ โปรดลองใหม่':'Stop not confirmed. Retry.'}
          </Text>:null}
        </View>;
      })}
    </View>:null}
    <Text style={s.note}>{t('m2LimitNote')}</Text>
  </View>;
}
const styles=(c:Palette)=>StyleSheet.create({
  panel:{backgroundColor:c.surface,borderColor:c.line,borderWidth:1,borderRadius:15,padding:16,gap:12},
  title:{color:c.accent,fontWeight:'800',fontSize:17},
  note:{color:c.muted,fontSize:12,lineHeight:19},
  status:{fontWeight:'800',fontSize:13,color:c.text,padding:10,backgroundColor:c.surfaceAlt,borderRadius:9},
  live:{color:c.positive,backgroundColor:c.accentSoft},
  secondary:{alignSelf:'flex-start',borderWidth:1,borderColor:c.line,borderRadius:9,padding:10},
  secondaryText:{color:c.text,fontWeight:'700',fontSize:13},
  option:{borderColor:c.line,borderWidth:1,borderRadius:11,padding:12,gap:5},
  chosen:{borderColor:c.accent,borderWidth:2},
  optionText:{color:c.text,fontWeight:'700',fontSize:13},
  button:{backgroundColor:c.accent,alignSelf:'flex-start',padding:12,borderRadius:10},
  disabled:{opacity:.45},
  buttonText:{fontWeight:'800',color:c.accentOn},
  stop:{backgroundColor:c.dangerButton,alignSelf:'flex-start',padding:12,borderRadius:10},
  stopText:{fontWeight:'800',color:'#FFFFFF'},
  emergencyArea:{padding:12,borderWidth:1,borderColor:c.line,borderRadius:11,gap:10},
  emergencyRow:{padding:10,borderRadius:9,backgroundColor:c.surfaceAlt,gap:8},
  error:{color:c.error,fontSize:12,fontWeight:'700'},
});
