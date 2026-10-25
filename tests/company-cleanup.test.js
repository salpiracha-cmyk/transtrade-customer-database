import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { consolidateFields, companyGroups } from '../lib/company-records.js';

test('consolidation preserves all routes, people, images and field variants', () => {
  const a={id:'a',company:'Acme Ltd',country:'Kenya',person:'Ann',email:'sales@acme.test',mobile:'+254 111',sourcePhoto:'card_images/a.jpeg'};
  const b={id:'b',company:'Acme Ltd',country:'Kenya',person:'Ben',email:'SALES@acme.test, ben@acme.test',mobile:'+254 222',phone:'12345678',sourcePhoto:'uploads/cards/b.jpeg'};
  const result=consolidateFields(a,[a,b]);
  assert.equal(result.email,'sales@acme.test; ben@acme.test');
  assert.equal(result.mobile,'+254 111; +254 222');
  assert.equal(result.contactPeople.length,2);
  assert.deepEqual(result.sourcePhotos,['card_images/a.jpeg','uploads/cards/b.jpeg']);
  assert.ok(result.mergeDetails.some(s=>s.includes('Ben')));
  const c={...a,...result};
  assert.equal(consolidateFields(c,[c]).contactPeople.length,2);
});

test('company identity spans people but excludes different countries, placeholders and archived rows', () => {
  const rows=[{id:'1',company:'Acme Ltd.',country:'Kenya',person:'Ann'},{id:'2',company:'ACME LTD',country:'Kenya',person:'Ben'},{id:'3',company:'Acme Ltd',country:'Uganda'},{id:'4',company:'Unknown',country:'Kenya'},{id:'5',company:'Unknown',country:'Kenya'},{id:'6',company:'Acme Ltd',country:'Kenya',archivedAt:'today'}];
  assert.deepEqual(companyGroups(rows).map(g=>g.ids),[['1','2']]);
});

test('HTTP merge backs up data, rejects stale plans, preserves remarks and serves source cards', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tti-company-test-'));
  let child;
  try {
    for(const item of ['server.js','package.json','lib','public']) await fs.cp(new URL(`../${item}`,import.meta.url),path.join(root,item),{recursive:true});
    await fs.symlink(new URL('../node_modules',import.meta.url).pathname,path.join(root,'node_modules'),'dir');
    await fs.mkdir(path.join(root,'data'));
    await fs.mkdir(path.join(root,'uploads/cards'),{recursive:true});
    const customers=[{id:'a',company:'Acme Ltd',country:'Kenya',person:'Ann',email:'ann@acme.test',sourcePhoto:'card_images/one card.png',sourceType:'card_master',sourceTrust:60,notes:'Old: bad@acme.test'},{id:'b',company:'Acme Ltd',country:'Kenya',person:'Ben',email:'ben@acme.test',sourcePhoto:'uploads/cards/two.png',sourceType:'manual',sourceTrust:90,manualCategory:'trader',notes:'Second remark'}];
    await fs.writeFile(path.join(root,'uploads/cards/one card.png'),'fixture-image');
    await fs.writeFile(path.join(root,'data/database.json'),JSON.stringify({customers,imports:[],events:[],settings:{},suppressions:[],campaigns:[]}));
    child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:'0',HOST:'127.0.0.1',APP_PASSWORD:'',OUTREACH_SEND_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
    const startup=await new Promise((resolve,reject)=>{child.stdout.on('data',d=>resolve(String(d)));child.once('error',reject);child.once('exit',c=>reject(new Error(`server exited ${c}`)));});
    const port=Number(startup.match(/:(\d+)\s*$/)?.[1]);
    assert.ok(port>0,startup);
    const base=`http://127.0.0.1:${port}`;
    const plan=await (await fetch(base+'/api/company-cleanup')).json();
    assert.equal(plan.duplicateRecords,1);
    const post=body=>fetch(base+'/api/company-cleanup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post({fingerprint:'stale',keys:[plan.groups[0].key]})).status,409);
    const response=await post({fingerprint:plan.fingerprint,keys:[plan.groups[0].key]});
    assert.equal(response.status,200);
    const result=await response.json();
    const backup=JSON.parse(await fs.readFile(path.join(root,'data',result.backup),'utf8'));
    assert.equal(backup.customers.filter(c=>!c.archivedAt).length,2);
    const db=JSON.parse(await fs.readFile(path.join(root,'data/database.json'),'utf8'));
    const active=db.customers.filter(c=>!c.archivedAt);
    assert.equal(active.length,1);
    assert.ok(active[0].email.includes('ann@acme.test')&&active[0].email.includes('ben@acme.test'));
    assert.ok(active[0].notes.includes('Old: bad@acme.test')&&active[0].notes.includes('Second remark'));
    assert.equal(active[0].manualCategory,'trader');
    const detail=await (await fetch(base+'/api/customers/'+active[0].id)).json();
    assert.equal(detail.photos.length,2);
    assert.equal(detail.photos.filter(p=>p.available).length,1);
    assert.equal(await (await fetch(base+detail.photos.find(p=>p.available).url)).text(),'fixture-image');
    assert.equal((await (await fetch(base+'/api/data-audit')).json()).uniqueEmails,2);
  } finally {
    if(child&&child.exitCode===null){child.kill();await once(child,'exit');}
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('subsequent merges retain nested cards without reviving removed contact routes', () => {
  const a={id:'a', company:'Acme', email:'main@acme.test', contactPeople:[{person:'Older contact',email:'old@acme.test',phone:'12345',sourcePhoto:'legacy.png'}]};
  const b={id:'b', company:'Acme', email:'second@acme.test'};
  const result=consolidateFields(a,[a,b]);
  assert.equal(result.email,'main@acme.test; second@acme.test');
  assert.equal(result.phone,'');
  assert.ok(result.sourcePhotos.includes('legacy.png'));
});


test('placeholder labels do not merge unrelated people', () => {
  for (const company of ['Unknown','Independent contact','Handwritten note','General Trading LLC','S.R.L.','Kenya']) {
    assert.equal(companyGroups([{id:'a',company,country:'Kenya'},{id:'b',company,country:'Kenya'}]).length,0);
  }
});


test('company review includes punctuation and spacing variants without crossing countries', () => {
  const rows=[{id:'1',company:'Sun Shine General Trading L.L.C.',country:'UAE'},{id:'2',company:'Sunshine General Trading LLC',country:'UAE'},{id:'3',company:'Sunshine General Trading LLC',country:'Oman'}];
  assert.deepEqual(companyGroups(rows).map(g=>g.ids),[['1','2']]);
});
