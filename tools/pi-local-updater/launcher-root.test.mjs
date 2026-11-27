import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const home=dirname(fileURLToPath(import.meta.url));
const mainFile=join(home,'enable-github-updates.ps1');
const repairFile=join(home,'REPAIR_AND_START_GITHUB_AGENT.bat');
const isWin=process.platform==='win32';
test('PowerShell bootstrap generates launchers using current directory instead of quoted trailing slash',async()=>{
 const source=await readFile(mainFile,'utf8');
 const match=source.match(/\$common = @'\r?\n([\s\S]*?)\r?\n'@/);
 assert.ok(match,'missing generated launcher here-string');
 assert.match(match[1],/cd \/d "%~dp0"/);
 assert.match(match[1],/node\.exe "\.\\updater\\cli\.mjs" auto "\."/);
 assert.match(match[1],/node\.exe "\.\\updater\\cli\.mjs" activate-if-staged "\."/);
 assert.doesNotMatch(match[1],/node\.exe.*(?:auto|activate-if-staged) "%~dp0"/);
});
test('repair helper contains no network fetch or code download',async()=>{
 const source=await readFile(repairFile,'utf8');
 assert.match(source,/launcher-backups/);
 assert.match(source,/\/repair-only/);
 assert.doesNotMatch(source,/https?:\/\/|Invoke-WebRequest|curl|wget|git clone/);
});
test('Windows repair from folder containing spaces preserves staged root and original launcher backups',{skip:!isWin},async()=>{
 const root=await mkdtemp(join(tmpdir(),'Product Insights updater path with spaces '));
 try{
  await mkdir(join(root,'updater'));
  await writeFile(join(root,'start.mjs'),'// fixture');
  await writeFile(join(root,'updater','cli.mjs'),[
   "import {appendFileSync} from 'node:fs';",
   "import {resolve} from 'node:path';",
   "const action=process.argv[2];",
   "const root=resolve(process.argv[3]);",
   "if(root!==process.cwd()||root.includes('\"'))process.exit(90);",
   "appendFileSync('calls.txt',action+'\\n');",
  ].join('\n'));
  await writeFile(join(root,'START_WITH_AGENT.bat'),'@echo off\r\necho agent-started>>calls.txt\r\nexit /b 0\r\n');
  await writeFile(join(root,'START_LOCALHOST.bat'),'@echo off\r\necho localhost-started>>calls.txt\r\nexit /b 0\r\n');
  const old=[
    '@echo off',
    'setlocal',
    'cd /d "%~dp0"',
    'node.exe "%~dp0updater\\cli.mjs" auto "%~dp0"',
    'node.exe "%~dp0updater\\cli.mjs" activate-if-staged "%~dp0"',
    'call "%~dp0START_WITH_AGENT.bat"',''
  ].join('\r\n');
  await writeFile(join(root,'START_GITHUB_AGENT.bat'),old);
  await writeFile(join(root,'START_GITHUB_LOCALHOST.bat'),old.replace('START_WITH_AGENT','START_LOCALHOST'));
  await writeFile(join(root,'REPAIR_AND_START_GITHUB_AGENT.bat'),await readFile(repairFile));
  function cmd(args){
   const run=spawnSync('cmd.exe',['/d','/c',...args],{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000});
   assert.equal(run.status,0,JSON.stringify({stdout:run.stdout,stderr:run.stderr,error:run.error?.message}));
  }
  cmd(['.\\REPAIR_AND_START_GITHUB_AGENT.bat','/repair-only']);
  const repaired=await readFile(join(root,'START_GITHUB_AGENT.bat'),'utf8');
  assert.match(repaired,/auto "\."/);
  assert.match(repaired,/activate-if-staged "\."/);
  assert.doesNotMatch(repaired,/auto "%~dp0"/);
  const backups=await readdir(join(root,'local-data','pi-updates','launcher-backups'));
  assert.equal(backups.length,1);
  assert.equal(await readFile(join(root,'local-data','pi-updates','launcher-backups',backups[0],'START_GITHUB_AGENT.bat'),'utf8'),old);
  cmd(['.\\START_GITHUB_AGENT.bat']);
  const calls=(await readFile(join(root,'calls.txt'),'utf8')).trim().split(/\r?\n/);
  assert.deepEqual(calls,['auto','activate-if-staged','agent-started']);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('repair aborts in wrong application folder',{skip:!isWin},async()=>{
 const root=await mkdtemp(join(tmpdir(),'pi-wrong-folder-'));
 try{
  await writeFile(join(root,'REPAIR_AND_START_GITHUB_AGENT.bat'),await readFile(repairFile));
  const run=spawnSync('cmd.exe',['/d','/c','.\\REPAIR_AND_START_GITHUB_AGENT.bat','/repair-only'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000});
  assert.notEqual(run.status,0);
 }finally{await rm(root,{recursive:true,force:true})}
});
