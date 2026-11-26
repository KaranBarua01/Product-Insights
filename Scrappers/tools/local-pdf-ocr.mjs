/** Optional local OCR for already downloaded, policy-approved PDFs.
 * No network, shell, remote-selected executables, or inferred engineering claims.
 * Requires operator-installed Poppler (pdftoppm) and Tesseract English data.
 * Process timeouts and byte limits are not an OS sandbox.
 */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const execute=promisify(execFile);
const MAX_BYTES=12_000_000,MAX_PAGES=3,TOTAL_MS=45_000;
function env(){
 const out={};
 for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','TESSDATA_PREFIX'])
   if(process.env[key])out[key]=process.env[key];
 return out;
}
export function createLocalPdfOcr({run=execute}={}){
 return async function recognize(bytes,pageNumbers){
   if(!(bytes instanceof Uint8Array)||bytes.byteLength>MAX_BYTES||bytes.byteLength<5||
       String.fromCharCode(...bytes.slice(0,5))!=='%PDF-')throw Error('OCR requires a bounded PDF byte buffer');
   if(!Array.isArray(pageNumbers)||pageNumbers.length>MAX_PAGES||
       pageNumbers.some(p=>!Number.isInteger(p)||p<1||p>1_000_000)||new Set(pageNumbers).size!==pageNumbers.length)
     throw Error('OCR accepts at most three distinct PDF page numbers');
   const dir=await mkdtemp(join(tmpdir(),'pi-ocr-')),pdf=join(dir,'input.pdf'),start=Date.now(),out=[];
   const invoke=async(exe,args)=>{
     const remaining=TOTAL_MS-(Date.now()-start);
     if(remaining<=0)throw Error('OCR time budget exhausted');
     return run(exe,args,{cwd:dir,env:env(),shell:false,windowsHide:true,timeout:Math.min(15_000,remaining),maxBuffer:256_000,encoding:'utf8'});
   };
   try{
     await writeFile(pdf,bytes,{flag:'wx'});
     for(const n of pageNumbers){
       if(Date.now()-start>=TOTAL_MS)break;
       try{
         const prefix=join(dir,'page-'+n),image=prefix+'.png';
         await invoke('pdftoppm',['-f',String(n),'-l',String(n),'-r','150','-scale-to','1800','-png','-singlefile',pdf,prefix]);
         const info=await stat(image);
         if(!info.isFile()||info.size===0||info.size>MAX_BYTES)continue;
         const result=await invoke('tesseract',[image,'stdout','-l','eng','--psm','3']);
         const text=String(result.stdout??'').trim().slice(0,6000);
         if(text)out.push({page:n,text});
       }catch{/* page remains failed/unavailable, no diagnostic leaks or fabricated text */}
     }
     return out;
   }finally{await rm(dir,{recursive:true,force:true});}
 };
}
