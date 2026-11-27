// Isolated benchmark transport. No browser, credentials, proxy or automatic redirect.
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request} from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
export function publicAddress(ip){
  if(isIP(ip)===4){
    const [a,b,c]=ip.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||
      a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||
      a===192&&b===0&&(c===0||c===2)||a===192&&b===88&&c===99||
      a===198&&(b===18||b===19)||a===198&&b===51&&c===100||a===203&&b===0&&c===113);
  }
  if(isIP(ip)!==6||ip.includes('.')||ip.includes('%'))return false;
  const [a,b]=ip.toLowerCase().split(':').map(x=>parseInt(x||'0',16));
  return a>=0x2000&&a<0x4000&&!(a===0x2001&&(b<0x0200||b===0x0db8))&&a!==0x2002&&a!==0x3fff;
}
export function approvedUrl(raw,host){
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.hostname!==host||isIP(u.hostname)||u.username||u.password||u.port||u.hash)
    throw Error('Unapproved HTTPS origin or URL');
  return u;
}
export function selectPinnedAddress(addresses){
  if(!Array.isArray(addresses)||!addresses.length||addresses.some(x=>!publicAddress(x.address)||isIP(x.address)!==x.family))
    throw Error('DNS/public-network policy: unsafe, invalid or absent DNS answers');
  return addresses.find(x=>x.family===4)||addresses[0];
}
async function abortable(promise,signal){
  signal.throwIfAborted();let listener;
  try{return await Promise.race([promise,new Promise((_,reject)=>{listener=()=>reject(signal.reason);signal.addEventListener('abort',listener,{once:true});})]);}
  finally{if(listener)signal.removeEventListener('abort',listener);}
}
// Pull-based Web stream bridge: the response may be cancelled while a Node
// socket still has buffered data. Keep one terminal state and never enqueue
// after close/cancel/error. No Readable.toWeb or Transform adapter is used.
export function responseBody(res,accountBytes){
  let terminal=false;
  res.pause();
  return new ReadableStream({
    start(controller){
      const fail=error=>{
        if(terminal)return;
        terminal=true;
        controller.error(error instanceof Error?error:new Error(String(error)));
        res.destroy();
      };
      res.on('data',chunk=>{
        if(terminal)return;
        res.pause();
        try{accountBytes(chunk.byteLength,chunk);controller.enqueue(chunk);}
        catch(error){fail(error);}
      });
      res.on('end',()=>{
        if(terminal)return;
        terminal=true;controller.close();
      });
      res.on('error',fail);
      res.on('aborted',()=>fail(new Error('Response aborted')));
      res.on('close',()=>fail(new Error('Response closed before completion')));
    },
    pull(){if(!terminal)res.resume();},
    cancel(){if(terminal)return;terminal=true;res.pause();res.destroy();}
  },{highWaterMark:0});
}
export function createPinnedFetcher(host,{maxRequests=360,maxBytes=67108864,deadline=Date.now()+720000,lookupFn=lookup,onResponse=()=>undefined}={}){
  let requests=0,bytes=0,lastStart=0,halt='';
  const check=()=>{if(halt)throw Error(halt);if(Date.now()>=deadline){halt='site_deadline';throw Error(halt)}if(requests>=maxRequests){halt='network_request_budget';throw Error(halt)}if(bytes>=maxBytes){halt='network_byte_budget';throw Error(halt)}};
  const stats=()=>({requests,bytes,halt});
  const fetcher=async(raw,init={})=>{
    const u=approvedUrl(typeof raw==='string'?raw:raw.url,host);
    if((init.method||'GET').toUpperCase()!=='GET'||init.body||init.redirect!=='manual')throw Error('Only guarded manual-redirect GET is allowed');
    check();
    const signal=AbortSignal.any([init.signal||AbortSignal.timeout(9000),AbortSignal.timeout(Math.max(1,deadline-Date.now()))]);
    await delay(Math.max(0,350-(Date.now()-lastStart)),undefined,{signal});check();requests++;
    const pinned=selectPinnedAddress(await abortable(lookupFn(host,{all:true,verbatim:true}),signal));
    signal.throwIfAborted();lastStart=Date.now();
    const requested=new Headers(init.headers);
    const headers={'User-Agent':requested.get('user-agent')||'InsideJobScrappersPrototype/0.2','Accept':requested.get('accept')||'*/*','Accept-Encoding':'identity'};
    return new Promise((resolve,reject)=>{
      const req=request(u,{method:'GET',headers,signal,agent:false,servername:host,rejectUnauthorized:true,maxHeaderSize:32768,
        family:pinned.family,lookup:(name,options,callback)=>{
          if(name!==host){callback(Error('Unexpected DNS lookup hostname'));return}
          if(options.all)callback(null,[pinned]);else callback(null,pinned.address,pinned.family);
        }},res=>{
        // Keep an error listener on discarded/no-body responses as well.
        res.on('error',()=>{});
        try{
          const status=res.statusCode||500,h=new Headers();
          for(let i=0;i<res.rawHeaders.length;i+=2)h.append(res.rawHeaders[i],res.rawHeaders[i+1]);
          if([204,205,304].includes(status)){res.destroy();resolve(new Response(null,{status,headers:h}));return}
          if(!['','identity'].includes((h.get('content-encoding')||'').toLowerCase())){
            res.destroy();reject(Error('Unsupported encoded response under identity-only transport'));return;
          }
          const observer=onResponse({url:u.href,status,type:h.get('content-type')||'',headers:h});
          const body=responseBody(res,(n,chunk)=>{
            bytes+=n;
            if(bytes>maxBytes){halt='network_byte_budget';throw Error(halt);}
            observer?.(chunk);
          });
          resolve(new Response(body,{status,headers:h}));
        }catch(e){res.destroy();reject(e)}
      });req.on('error',reject);req.end();
    });
  };
  return {fetcher,stats,canContinue:()=>!halt&&requests<maxRequests&&bytes<maxBytes&&Date.now()<deadline,
    stopReason:()=>halt||(Date.now()>=deadline?'site_deadline':requests>=maxRequests?'network_request_budget':bytes>=maxBytes?'network_byte_budget':'')};
}
