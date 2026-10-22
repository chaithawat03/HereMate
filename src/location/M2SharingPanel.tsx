/**
 * M2.2 foreground-only controls, deliberately UNMOUNTED until an independently
 * reviewed backend transport and Staging deployment exist. Do not import in App
 * or assign a no-op transport: the status must never pretend GPS is shared.
 */
import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AppState,Pressable,StyleSheet,Text,View} from 'react-native';
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

type Props={transport:SharePorts['transport'];backendReviewedAndEnabled:boolean};
const initial:SharingState={phase:'off',peerUid:null,expiresAtMs:null,error:null};
function toRelation(r:FriendRequest):ShareRelation {
  return {senderUid:r.senderUid,recipientUid:r.recipientUid,status:r.status,
    senderConsent:r.senderConsent,recipientConsent:r.recipientConsent};
}
export function M2SharingPanel({transport,backendReviewedAndEnabled}:Props){
  const {colors:c,t}=usePreferences();
  const s=useMemo(()=>styles(c),[c]);
  const [session,setSession]=useState<SharingState>(initial);
  const [friends,setFriends]=useState<FriendRequest[]>([]);
  const [selectedUid,setSelectedUid]=useState<string|null>(null);
  const [loadError,setLoadError]=useState(false);
  const [authRevision,setAuthRevision]=useState(0);
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
        const watcher=await Location.watchPositionAsync(
          {accuracy:Location.Accuracy.Balanced,timeInterval:10_000,distanceInterval:20},
          value=>{
            if(!live)return;
            const coords=value.coords;
            const fix:ShareFix={
              latitude:coords.latitude,longitude:coords.longitude,
              accuracyMeters:coords.accuracy??Infinity,capturedAtMs:value.timestamp,
            };
            onFix(fix);
          },onError);
        return {remove:()=>watcher.remove()};
      }
    });
    controller.current=ctrl;
    const app=AppState.addEventListener('change',next=>{
      if(next!=='active')ctrl.interrupted();
    });
    const authUnsub=onAuthStateChanged(auth,u=>{
      const uid=u?.uid??null;
      if(account.current!==uid){account.current=uid;ctrl.accountChanged();}
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
      disabled={!eligible} style={[s.button,!eligible&&s.disabled]}
      onPress={()=>{
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
  error:{color:c.error,fontSize:12,fontWeight:'700'},
});
