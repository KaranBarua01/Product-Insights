/** Private GitHub Issues job protocol. An Issue is NOT an arbitrary shell command. */
export const JOB_SCHEMA='pi-local-agent/job-v1';
export const RESULT_SCHEMA='pi-local-agent/result-v1';
export const QUEUE_LABEL='pi-local-agent-job';
export const ALLOWED_ACTIONS=Object.freeze(['health','run_tests','taxonomy_1up','taxonomy_cross','benchmark_10','depth_7','products_7']);
const MAX_JOB_AGE_MS=15*60*1000;

export function parseQueueRepo(value){
  const repo=String(value||'').trim();
  if(!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)||repo.includes('..'))
    throw Error('PI_AGENT_QUEUE_REPO must be a GitHub owner/repository name');
  if(repo.toLowerCase()==='karanbarua01/product-insights')throw Error('Never use the public Product-Insights repo as a queue');
  return repo;
}
export function parseJob(issue,{owner,nowMs=Date.now()}={}){
  if(typeof owner!=='string'||!owner.trim())throw Error('Job owner must be configured');
  if(!issue||issue.pull_request||!Number.isSafeInteger(issue.number)||issue.number<1)
    throw Error('Expected a GitHub Issue');
  if(issue.user?.login?.toLowerCase()!==owner.toLowerCase())throw Error('Issue author is not authorized');
  if(!(issue.labels||[]).some(x=>(typeof x==='string'?x:x?.name)===QUEUE_LABEL))
    throw Error('Issue is not in local-agent queue');
  const raw=String(issue.body||'').trim();
  if(raw.length<20||raw.length>2500)throw Error('Job body invalid or too large');
  let job;
  try{job=JSON.parse(raw);}catch{throw Error('Job must be a JSON object');}
  if(!job||Array.isArray(job)||typeof job!=='object')throw Error('Job must be an object');
  const allowed=['schemaVersion','jobId','action','issuedAt','expiresAt'];
  if(Object.keys(job).some(k=>!allowed.includes(k))||allowed.some(k=>!Object.hasOwn(job,k)))
    throw Error('Job fields must exactly match the documented protocol; no command, path or args accepted');
  if(job.schemaVersion!==JOB_SCHEMA||!ALLOWED_ACTIONS.includes(job.action))
    throw Error('Unknown job version or action');
  if(typeof job.jobId!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(job.jobId))
    throw Error('Invalid jobId');
  if(typeof job.issuedAt!=='string'||typeof job.expiresAt!=='string'||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(job.issuedAt)||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(job.expiresAt))
    throw Error('Jobs require UTC ISO 8601 times');
  const start=Date.parse(job.issuedAt),end=Date.parse(job.expiresAt);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||
    end-start>MAX_JOB_AGE_MS||start>nowMs+60_000||nowMs>=end||nowMs-start>MAX_JOB_AGE_MS)
    throw Error('Job expired, future-dated or outside the 15-minute window');
  return {schemaVersion:JOB_SCHEMA,jobId:job.jobId,action:job.action,issueNumber:issue.number};
}
export function sanitizeOutput(value,{secret='',maxChars=5000}={}){
  let text=String(value||'');
  if(secret)text=text.split(secret).join('[REDACTED]');
  text=text.replace(/(?:github_pat_|ghp_|gho_|ghu_|ghs_|ghr_)[A-Za-z0-9_]{8,}/g,'[REDACTED_GITHUB_TOKEN]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi,'Bearer [REDACTED]')
    .replace(/sk-(?:proj-)?[A-Za-z0-9_-]{10,}/g,'[REDACTED_KEY]');
  return text.length>maxChars?text.slice(0,maxChars)+'...[truncated]':text;
}
