import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import JSZip from 'jszip';
import vm from 'node:vm';
import {reviewFields,previewReviewPlan} from '../lib/review.js';
const expected=c=>Object.fromEntries(reviewFields.map(k=>[k,String(c[k]||'')]));
const planFor=c=>({schema:'tti-review-plan-v1',entries:[{row:7,expected:expected(c),reason:'Original card association unresolved'}]});

test('Review plan refuses stale, ambiguous, resolved and excluded contacts',()=>{
 const c={id:'a',company:'Acme',country:'Kenya',email:'a@acme.test'};
 assert.equal(previewReviewPlan([c],planFor(c)).ready,1);
 for(const changed of [{...c,email:'new@acme.test'},{...c,notes:'New evidence'},{...c,archivedAt:'today'},{...c,reviewStatus:'resolved'}]) assert.equal(previewReviewPlan([changed],planFor(c)).ready,0);
 assert.equal(previewReviewPlan([c,{...c,id:'b'}],planFor(c)).decisions[0].status,'ambiguous');
 assert.equal(previewReviewPlan([c],planFor(c),()=>true).ready,0);
 assert.equal(previewReviewPlan([{...c,reviewStatus:'pending'}],planFor(c)).decisions[0].status,'already-in-review');
 assert.throws(()=>previewReviewPlan([c],{schema:'tti-review-plan-v1',entries:[{expected:{company:'Acme'},reason:'Name only'}]}));
});

test('HTTP Review moves preserve data, back up, exclude country/export/outreach, and release explicitly',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tti-review-'));let child;
 try{
  for(const item of ['server.js','package.json','lib','public'])await fs.cp(new URL(`../${item}`,import.meta.url),path.join(root,item),{recursive:true});
  await fs.symlink(new URL('../node_modules',import.meta.url).pathname,path.join(root,'node_modules'),'dir');
  await fs.mkdir(path.join(root,'data'));
  const a={id:'a',company:'Held Contact',person:'Ann',country:'Kenya',email:'ann@held.test',notes:'Keep evidence',sourcePhoto:'original.png',sourceType:'manual',sourceTrust:90};
  const b={id:'b',company:'Retained Contact',country:'Kenya',email:'ben@retained.test',sourceType:'manual',sourceTrust:90};
  await fs.writeFile(path.join(root,'data/database.json'),JSON.stringify({customers:[a,b],imports:[],events:[],settings:{},suppressions:[],campaigns:[]}));
  child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:'0',HOST:'127.0.0.1',APP_PASSWORD:'',RESEND_API_KEY:'',OUTREACH_SEND_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
  const startup=await new Promise((resolve,reject)=>{child.stdout.once('data',d=>resolve(String(d)));child.once('error',reject);child.once('exit',c=>reject(new Error(`Exit ${c}`)));});
  const port=Number(startup.match(/:(\d+)\s*$/)?.[1]);assert.ok(port,startup);
  const base=`http://127.0.0.1:${port}`;
  const get=async route=>(await fetch(base+route)).json();
  const post=body=>fetch(base+'/api/admin/review-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const plan=planFor(a);const preview=await(await post({plan})).json();assert.equal(preview.ready,1);
  assert.equal((await post({plan,apply:true,fingerprint:'stale'})).status,409);
  const applied=await(await post({plan,apply:true,fingerprint:preview.fingerprint})).json();assert.equal(applied.moved,1);
  const backup=JSON.parse(await fs.readFile(path.join(root,'data',applied.backup),'utf8'));assert.equal(backup.customers[0].reviewStatus,undefined);
  const db=JSON.parse(await fs.readFile(path.join(root,'data/database.json'),'utf8'));
  for(const k of Object.keys(a))assert.deepEqual(db.customers[0][k],a[k]);
  assert.equal((await get('/api/customers?country=Kenya')).total,1);
  assert.equal((await get('/api/customers?category=buyer')).total,1);
  const review=await get('/api/customers?category=review');assert.equal(review.total,1);assert.equal(review.customers[0].listCategory,'Review');
  assert.equal((await get('/api/customers?q=Held')).total,1);
  const status=await get('/api/outreach/status');assert.equal(status.totals.reviewExcluded,1);assert.equal(status.totals.buyerEmailRecords,1);
  for(const route of ['/api/export.xlsx?country=Kenya','/api/export.xlsx?category=buyer']){
   const zip=await JSZip.loadAsync(await(await fetch(base+route)).arrayBuffer());
   const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');assert.ok(!xml.includes('Held Contact'));assert.ok(xml.includes('Retained Contact'));
  }
  const zip=await JSZip.loadAsync(await(await fetch(base+'/api/export.xlsx?category=review')).arrayBuffer());assert.ok((await zip.file('xl/worksheets/sheet1.xml').async('string')).includes('Held Contact'));
  const again=await(await post({plan})).json();assert.equal(again.ready,0);
  await fetch(base+'/api/customers/a',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({reviewStatus:'resolved'})});
  assert.equal((await get('/api/customers?category=buyer')).total,2);
  assert.equal((await(await post({plan})).json()).ready,0);
 }finally{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}await fs.rm(root,{recursive:true,force:true});}
});

test('already queued outreach skips a contact moved to Review before sending', async()=>{
 const source=await fs.readFile(new URL('../server.js',import.meta.url),'utf8');
 const start=source.indexOf('async function processOutreachQueue() {');
 const end=source.indexOf('async function sendOutreachEmail(',start);
 const item={status:'queued',customerId:'a',to:'a@example.test',scheduledAt:'2000-01-01'};
 const db={customers:[{id:'a',reviewStatus:'pending'}],campaigns:[{items:[item]}]};let sent=0,written=0;
 const context=vm.createContext({outreachProcessing:false,RESEND_API_KEY:'fixture-only',readDb:async()=>db,writeDb:async()=>{written++},isReview:c=>c.reviewStatus==='pending',isMiscellaneousContact:()=>false,isEmailSuppressed:()=>false,now:()=>new Date().toISOString(),sendOutreachEmail:async()=>{sent++}});
 vm.runInContext(source.slice(start,end),context);await context.processOutreachQueue();
 assert.equal(item.status,'skipped');assert.equal(sent,0);assert.equal(written,1);
});
