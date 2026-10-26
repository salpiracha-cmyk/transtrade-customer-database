import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {UserStore} from '../lib/users.js';
const basic=(u,p)=>'Basic '+Buffer.from(`${u}:${p}`).toString('base64');
test('persistent users: unique IDs, roles, password rotation, disable, no bootstrap fallback',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tti-users-'));
 try {
  const file=path.join(dir,'users.json'); const s=new UserStore(file);
  await s.init('tti','initial-test-password');
  const admin=await s.authenticate(basic('tti','initial-test-password')); assert.equal(admin.role,'admin');
  const user=await s.update(admin,null,{username:'staff',password:'staff-test-password'});
  assert.equal(user.role,'user'); assert.equal(user.hash,undefined);
  await assert.rejects(s.update(admin,null,{username:'STAFF',password:'another-password'}),/already/);
  await assert.rejects(s.update(user,null,{username:'hacker',password:'another-password'}),/Administrator/);
  await assert.rejects(s.update(user,user.id,{password:'new-test-password',currentPassword:'wrong'}),/incorrect/);
  await s.update(user,user.id,{username:'staff2',password:'new-test-password',currentPassword:'staff-test-password',role:'admin'});
  assert.equal(await s.authenticate(basic('staff','staff-test-password')),null);
  assert.equal((await s.authenticate(basic('staff2','new-test-password'))).role,'user');
  await s.update(admin,user.id,{disabled:true});
  assert.equal(await s.authenticate(basic('staff2','new-test-password')),null);
  await assert.rejects(s.update(admin,admin.id,{currentPassword:'initial-test-password',disabled:true}),/cannot disable/);
  await s.update(admin,admin.id,{username:'owner',password:'replacement-test-password',currentPassword:'initial-test-password'});
  const restart=new UserStore(file); await restart.init('tti','initial-test-password');
  assert.equal(await restart.authenticate(basic('tti','initial-test-password')),null);
  assert.equal((await restart.authenticate(basic('owner','replacement-test-password'))).role,'admin');
  const disk=await fs.readFile(file,'utf8'); assert.ok(!disk.includes('test-password'));
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('HTTP account permissions and cross-site protection',async()=>{
 const {spawn}=await import('node:child_process'); const {once}=await import('node:events');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tti-auth-http-')); let child;
 try {
  for(const item of ['server.js','package.json','lib','public']) await fs.cp(new URL(`../${item}`,import.meta.url),path.join(dir,item),{recursive:true});
  await fs.symlink(new URL('../node_modules',import.meta.url).pathname,path.join(dir,'node_modules'),'dir');
  child=spawn(process.execPath,['server.js'],{cwd:dir,env:{...process.env,PORT:'0',HOST:'127.0.0.1',APP_USER:'tti',APP_PASSWORD:'initial-test-password',OUTREACH_SEND_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
  const startup=await new Promise((resolve,reject)=>{child.stdout.once('data',d=>resolve(String(d)));child.once('error',reject);child.once('exit',()=>reject(new Error('Startup failed')));});
  const base='http://127.0.0.1:'+startup.match(/:(\d+)\s*$/)[1];
  const call=(url,auth,body,method)=>fetch(base+url,{method:method||(body?'POST':'GET'),headers:{authorization:auth,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await fetch(base+'/api/users')).status,401);
  const admin=basic('tti','initial-test-password');
  assert.equal((await call('/api/users',admin,{username:'staff',password:'staff-test-password'})).status,200);
  const staff=basic('staff','staff-test-password');
  assert.equal((await call('/api/users',staff)).status,403);
  assert.equal((await call('/api/settings',staff)).status,403);
  assert.equal((await call('/api/admin/restore-database',staff,{})).status,403);
  assert.equal((await call('/api/customers',staff)).status,200);
  assert.equal((await fetch(base+'/api/users',{method:'POST',headers:{authorization:admin,origin:'https://untrusted.example','content-type':'application/json'},body:'{}'})).status,403);
  assert.equal((await call('/api/account',staff,{currentPassword:'staff-test-password',password:'replacement-test-password'},'PATCH')).status,200);
  assert.equal((await call('/api/customers',staff)).status,401);
  assert.equal((await call('/api/customers',basic('staff','replacement-test-password'))).status,200);
 }finally{if(child&&child.exitCode===null){child.kill();await once(child,'exit');}await fs.rm(dir,{recursive:true,force:true});}
});


test('permanent user deletion revokes access and persists',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tti-delete-users-'));
 try {
  const file=path.join(dir,'users.json');const s=new UserStore(file);
  await s.init('owner','owner-test-password');
  const owner=await s.authenticate(basic('owner','owner-test-password'));
  const staff=await s.update(owner,null,{username:'staff',password:'staff-test-password'});
  await assert.rejects(s.delete(staff,owner.id),/Administrator/);
  await assert.rejects(s.delete(owner,owner.id),/own signed-in/);
  await s.delete(owner,staff.id);
  assert.equal(await s.authenticate(basic('staff','staff-test-password')),null);
  const restart=new UserStore(file);await restart.init('unused','unused-password');
  assert.equal(restart.list().some(u=>u.id===staff.id),false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
