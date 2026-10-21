import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decideGoogleAction,runGoogleIdentityFlow,safeGoogleFailure} from '../src/auth/googleAccountFlow.ts';
const read=x=>readFileSync(new URL('../'+x,import.meta.url),'utf8');
const TOKEN='synthetic-test-id-token-NEVER-REAL';
const guest={uid:'guest-uid-01',isAnonymous:true,providerIds:[]};
const linked={uid:'guest-uid-01',isAnonymous:false,providerIds:['google.com']};
const google={uid:'google-uid-02',isAnonymous:false,providerIds:['google.com']};
const ports=(current,link,signIn)=>({current:()=>current,linkAnonymous:link,signIn});
test('policy differentiates guest link, signed-out login and other providers',()=>{
  assert.equal(decideGoogleAction(null),'sign-in');
  assert.equal(decideGoogleAction(guest),'link');
  assert.equal(decideGoogleAction(linked),'already');
  assert.equal(decideGoogleAction({...google,providerIds:['password']}),'block');
});
test('guest upgrading with a Google ID token retains original UID',async()=>{
  let signCalls=0,linkCalls=0;
  const result=await runGoogleIdentityFlow(
    ports(guest,async(uid,token)=>{linkCalls++;assert.equal(uid,guest.uid);assert.equal(token,TOKEN);return linked;},async()=>{signCalls++;return google;}),
    async()=>TOKEN);
  assert.deepEqual(result,{kind:'linked',uid:guest.uid});
  assert.equal(linkCalls,1);assert.equal(signCalls,0);
});
test('Google credential already linked elsewhere fails closed without signing in',async()=>{
  let fallback=false;
  const result=await runGoogleIdentityFlow(
    ports(guest,async()=>{throw {code:'auth/credential-already-in-use'};},async()=>{fallback=true;return google;}),
    async()=>TOKEN);
  assert.deepEqual(result,{kind:'collision'});assert.equal(fallback,false);
});
test('signed-out Google login explicitly signs in, but never silently links',async()=>{
  let links=0;
  const result=await runGoogleIdentityFlow(
    ports(null,async()=>{links++;return linked;},async token=>{assert.equal(token,TOKEN);return google;}),
    async()=>TOKEN);
  assert.deepEqual(result,{kind:'signed-in',uid:google.uid});assert.equal(links,0);
});
test('linked accounts do not start a second Google flow and other providers are blocked',async()=>{
  let called=false;
  const p=ports(linked,async()=>{throw Error('unexpected');},async()=>{throw Error('unexpected');});
  assert.deepEqual(await runGoogleIdentityFlow(p,async()=>{called=true;return TOKEN;}),{kind:'already-google',uid:guest.uid});
  assert.equal(called,false);
  assert.deepEqual(await runGoogleIdentityFlow(
    ports({...google,providerIds:['password']},async()=>linked,async()=>google),async()=>{called=true;return TOKEN;}),
    {kind:'different-provider'});
  assert.equal(called,false);
});
test('cancellation, malformed token and session changes never mutate auth',async()=>{
  let writes=0;
  const noop=ports(guest,async()=>{writes++;return linked;},async()=>{writes++;return google;});
  assert.deepEqual(await runGoogleIdentityFlow(noop,async()=>null),{kind:'cancelled'});
  assert.deepEqual(await runGoogleIdentityFlow(noop,async()=>''),{kind:'unavailable'});
  assert.deepEqual(await runGoogleIdentityFlow(noop,async()=>{throw {code:'SIGN_IN_CANCELLED'};}),{kind:'cancelled'});
  let count=0;
  const changed={current:()=>++count===1 ? guest : google,linkAnonymous:async()=>{writes++;return linked;},signIn:async()=>{writes++;return google;}};
  assert.deepEqual(await runGoogleIdentityFlow(changed,async()=>TOKEN),{kind:'session-changed'});
  assert.equal(writes,0);
});
test('never return credentials, tokens or raw Firebase error messages',()=>{
  for(const code of ['auth/credential-already-in-use','auth/email-already-in-use','auth/account-exists-with-different-credential'])
    assert.deepEqual(safeGoogleFailure({code,token:TOKEN}),{kind:'collision'});
  assert.deepEqual(safeGoogleFailure(new Error('Google ID token='+TOKEN)),{kind:'unavailable'});
  const bridge=read('src/auth/googleAccountFirebase.ts');
  assert.match(bridge,/linkWithCredential\(user,GoogleAuthProvider\.credential\(idToken\)\)/);
  assert.match(bridge,/signInWithCredential\(auth,GoogleAuthProvider\.credential\(idToken\)\)/);
  assert.match(bridge,/getStagingGuestAuth\(\)/);
  assert.doesNotMatch(bridge,/console\.|AsyncStorage|setDoc|updateDoc|fetch\(|https?:\/\/|signOut\(/);
  assert.doesNotMatch(read('src/auth/GuestAuthGate.tsx'),/GoogleSignin|continueStagingGoogleWithNativeToken/);
});

test('Google sign-in remains disabled until the native OAuth provider is configured',()=>{
  const config=JSON.parse(read('app.json'));
  const eas=JSON.parse(read('eas.json'));
  const gate=read('src/auth/GuestAuthGate.tsx');
  assert.equal(eas.build['android-guest-staging'].env.EXPO_PUBLIC_ENABLE_GOOGLE_SIGNIN,undefined);
  assert.ok(!config.expo.plugins.some(p=>(Array.isArray(p)?p[0]:p)==='@react-native-google-signin/google-signin'));
  assert.doesNotMatch(gate,/onPress=\{googleLogin\}|GoogleSignin\.signIn\(/);
});
