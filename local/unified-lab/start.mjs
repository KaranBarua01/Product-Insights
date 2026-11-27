import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createLab} from './app/server.mjs';
import {createQueueAgent} from './app/queue-agent.mjs';
import {fileURLToPath} from 'node:url';
import {startUpdateWatcher} from './updater/watch.mjs';
// Remove the credential from the process environment before starting any child.
const queueToken=process.env.PI_AGENT_GITHUB_TOKEN||'';
delete process.env.PI_AGENT_GITHUB_TOKEN;
const root=fileURLToPath(new URL('./',import.meta.url));
import {ollamaHealth,MODEL} from './app/intelligence.mjs';
const port=Number(process.env.PI_LAB_PORT||8791);let ownedOllama=null,lab=null,queueAgent=null,updateWatcher=null,closing=false;
function stop(code=0){if(closing)return;closing=true;updateWatcher?.stop();queueAgent?.stop();if(ownedOllama){try{ownedOllama.kill()}catch{}}if(lab){lab.close().catch(()=>{});}setTimeout(()=>process.exit(code),900);}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
async function ensureOllama(){
 let h=await ollamaHealth();if(h.reachable){console.log('Ollama is already running. '+(h.model_ready?MODEL+' available.':'Required model not found.'));return;}
 if(process.env.PI_START_OLLAMA!=='1'){console.log('Ollama is not running. Deterministic / ChatGPT-packet mode remains available; start Ollama manually if needed.');return;}
 console.log('Starting Ollama locally (if installed)...');
 const child=spawn('ollama',['serve'],{stdio:['ignore','ignore','inherit'],env:{...process.env,OLLAMA_HOST:'127.0.0.1:11434'},windowsHide:true});ownedOllama=child;let failed=false;child.on('error',e=>{failed=true;ownedOllama=null;console.warn('Ollama could not be started:',e.message)});child.on('exit',()=>{ownedOllama=null});
 for(let i=0;i<15&&!closing&&!failed;i++){await delay(1000);h=await ollamaHealth();if(h.reachable){console.log('Ollama server reachable. '+(h.model_ready?MODEL+' available.':'Required model missing.'));return;}}
 console.warn('Ollama not confirmed. Lab is available; use Check AI or Retry AI after Ollama is ready.');
}
try{lab=createLab({port});await lab.listen();const url=`http://127.0.0.1:${port}/`;console.log('\nLOCAL RESEARCH LAB READY: '+url+'\nKeep this terminal open. Press Ctrl+C to stop the lab.\n');if(process.platform==='win32'){const browser=spawn('cmd.exe',['/d','/c','start','',''+url],{stdio:'ignore',windowsHide:true});browser.on('error',()=>console.log('Open '+url+' in your browser.'));browser.unref();}await ensureOllama();if(!closing){queueAgent=createQueueAgent({root,lab,token:queueToken});lab.setQueueAgent(queueAgent);queueAgent.start();updateWatcher=startUpdateWatcher(root);console.log(queueToken?"GitHub Local Agent: connecting to private PI-Agent-Queue; only fixed jobs allowed.":"GitHub Local Agent: not configured (Research Lab remains available). Use START_WITH_AGENT.bat only after stopping the old queue agent.");}}catch(e){console.error('Startup error:',e.message);stop(1);}
