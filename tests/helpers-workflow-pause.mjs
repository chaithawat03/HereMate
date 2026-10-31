// Owner pause of 2026-10-28: automatic triggers were replaced by workflow_dispatch and a
// "# PAUSED by project owner" header. A paused workflow must have NO automatic trigger.
export function ownerPaused(workflow){
  const paused=/^# PAUSED by project owner \d{4}-\d{2}-\d{2}:/m.test(workflow);
  if(!paused)return false;
  const on=workflow.split(/^on:\n/m)[1]?.split(/^\S/m)[0]??'';
  const triggers=[...on.matchAll(/^  ([a-z_]+):/gm)].map(m=>m[1]);
  if(triggers.join(',')!=='workflow_dispatch')
    throw Error('paused workflow still has automatic triggers: '+triggers.join(','));
  return true;
}
