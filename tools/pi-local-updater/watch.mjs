/**
 * Non-blocking periodic update discovery. Downloads only reviewed stable-channel
 * source blobs. Never modifies live application code or local databases.
 */
import {check,stage} from './core.mjs';
export function startUpdateWatcher(root,{intervalMs=15*60*1000,checkFn=check,stageFn=stage,logger=console}={}){
 if(!Number.isInteger(intervalMs)||intervalMs<1000)throw Error('Invalid poll interval');
 let stopped=false,running=false,consecutiveErrors=0;
 async function poll(){
  if(stopped||running)return;running=true;
  try{
   const next=await checkFn(root);
   if(next.available&&!next.staged){
    const result=await stageFn(root);
    if(result.status==='staged')logger.log('PI update '+result.releaseId+' verified and staged; activates on next restart.');
   }
   consecutiveErrors=0;
  }catch(e){
   consecutiveErrors++;
   if(consecutiveErrors===1||consecutiveErrors%24===0)logger.warn('PI update check unavailable; current installation remains unchanged: '+String(e?.message||e).slice(0,140));
  }finally{running=false}
 }
 const timer=setInterval(()=>{void poll()},intervalMs);
 timer.unref?.();
 // Do not interfere with application startup.
 setTimeout(()=>{void poll()},10_000).unref?.();
 return {stop(){stopped=true;clearInterval(timer)},poll,status:()=>({stopped,running,consecutiveErrors})};
}
