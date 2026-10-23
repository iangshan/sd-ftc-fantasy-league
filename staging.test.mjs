import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createStagingWorker, STAGING_HOST, STAGING_SHEET} from './staging-worker.mjs';
import {requireAccount, LEAGUE_OWNER_UID} from './dist/staging-app.mjs';

const env={STAGING_MODE:'owner-only',RESPONSES_SHEET_ID:STAGING_SHEET};
const origin='https://'+STAGING_HOST;
const req=(path,headers={},method='GET')=>new Request(origin+path,{method,headers});
const owner={uid:LEAGUE_OWNER_UID,emailVerified:true};
const cookie={'Cookie':'__Host-ftc-staging=valid.token.value'};
let hits=0;
const application={fetch:async()=>{hits++;return new Response('<html><body>PRIVATE CONTENT</body></html>',{headers:{'Content-Type':'text/html'}});}};

test('anonymous pages redirect and APIs/scripts never expose the app',async()=>{
 hits=0;const worker=createStagingWorker(application,async()=>{throw Error('must not run');});
 for(const path of ['/','/dashboard','/admin'])assert.equal((await worker.fetch(req(path),env)).status,302);
 for(const path of ['/api/draft','/api/auth/config','/api/account','/api/admin','/assets/accounts.js','/assets/admin.js'])assert.equal((await worker.fetch(req(path),env)).status,401);
 assert.equal(hits,0);
});
test('valid non-owner and unverified owner cannot access app',async()=>{
 for(const user of [{uid:'another-real-user',emailVerified:true},{uid:LEAGUE_OWNER_UID,emailVerified:false}]){
  const worker=createStagingWorker(application,async()=>user);
  assert.equal((await worker.fetch(req('/api/draft',cookie),env)).status,403);
 }
});
test('valid owner can access app and sees persistent staging identification',async()=>{
 const result=await createStagingWorker(application,async()=>owner).fetch(req('/',cookie),env);
 assert.equal(result.status,200);assert.match(await result.text(),/Private staging.*PRIVATE CONTENT/s);
 assert.match(result.headers.get('Cache-Control'),/no-store/);assert.match(result.headers.get('X-Robots-Tag'),/noindex/);
});
test('session needs same-origin POST and verified owner; cookie has secure attributes',async()=>{
 const worker=createStagingWorker(application,async()=>owner);
 assert.equal((await worker.fetch(req('/__staging/session',{Authorization:'Bearer valid.token.value'},'POST'),env)).status,403);
 const result=await worker.fetch(req('/__staging/session',{Authorization:'Bearer valid.token.value',Origin:origin},'POST'),env);
 assert.equal(result.status,200);assert.match(result.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict/);
 assert.equal((await worker.fetch(req('/api/submit',{...cookie,Origin:'https://other.example'},'POST'),env)).status,403);
});
test('logout clears cookie and rejects cross-origin requests',async()=>{
 const worker=createStagingWorker(application,async()=>owner);
 assert.equal((await worker.fetch(req('/__staging/logout',{Origin:'https://other.example'},'POST'),env)).status,403);
 assert.match((await worker.fetch(req('/__staging/logout',{Origin:origin},'POST'),env)).headers.get('Set-Cookie'),/Max-Age=0/);
});
test('missing or production configuration and alternate hosts fail closed',async()=>{
 const worker=createStagingWorker(application,async()=>owner);
 for(const badEnv of [{},{...env,STAGING_MODE:''},{...env,RESPONSES_SHEET_ID:'1euojcqzLLZIrhUZZlsphzk5cyjl41Ka7oUD-eJ3pd6E'}])assert.equal((await worker.fetch(req('/',cookie),badEnv)).status,503);
 assert.equal((await worker.fetch(new Request('https://version-'+STAGING_HOST+'/',{headers:cookie}),env)).status,503);
});
test('forged token is rejected by real Firebase verifier, even with owner claims',async()=>{
 const now=Math.floor(Date.now()/1000),claims={aud:'ftc-fantasy-league',iss:'https://securetoken.google.com/ftc-fantasy-league',sub:LEAGUE_OWNER_UID,exp:now+3600,iat:now,auth_time:now};
 const token='header.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.fake';
 const originalFetch=globalThis.fetch;let verified=false;
 globalThis.fetch=async(url)=>{assert.match(url,/^https:\/\/identitytoolkit.googleapis.com\/v1\/accounts:lookup/);verified=true;return new Response('{}',{status:400});};
 try{assert.equal((await createStagingWorker(application,requireAccount).fetch(req('/api/draft',{Authorization:'Bearer '+token}),env)).status,401);assert.equal(verified,true);}finally{globalThis.fetch=originalFetch;}
});
test('database, workbook and deployment target differ from production',()=>{
 const config=JSON.parse(fs.readFileSync(new URL('./wrangler.staging.jsonc',import.meta.url)));
 const production=JSON.parse(fs.readFileSync(new URL('./wrangler.jsonc',import.meta.url)));
 assert.notEqual(config.name,production.name);assert.equal(config.preview_urls,false);
 assert.notEqual(config.d1_databases[0].database_id,production.d1_databases[0].database_id);
 assert.equal(config.vars.RESPONSES_SHEET_ID,STAGING_SHEET);
 const workflow=fs.readFileSync(new URL('./.github/workflows/staging.yml',import.meta.url),'utf8');
 assert.match(workflow,/github.ref == 'refs\/heads\/staging'/);assert.match(workflow,/--config wrangler.staging.jsonc/);
});
