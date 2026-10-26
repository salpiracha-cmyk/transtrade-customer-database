import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {stageRecovery} from '../lib/recovery-export.js';
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'tti-portable-test-'));
try {
 const app=path.join(temp,'app'); const persistent=path.join(temp,'buyer-data');
 await fs.mkdir(app);await fs.mkdir(persistent);
 for(const name of ['imports','data','uploads']) {
  await fs.mkdir(path.join(persistent,name));
  await fs.writeFile(path.join(persistent,name,'sample.txt'),name+' preserved');
  await fs.symlink(path.join(persistent,name),path.join(app,name),'dir');
 }
 await fs.writeFile(path.join(app,'server.js'),'// software');
 await fs.mkdir(path.join(app,'node_modules'));await fs.writeFile(path.join(app,'node_modules','dependency'),'not included');
 await fs.symlink(path.join(temp,'missing-env'),path.join(app,'.env'));
 const out=path.join(temp,'snapshot');await stageRecovery(app,out);
 for(const name of ['imports','data','uploads']) {
  assert.equal(await fs.readFile(path.join(out,name,'sample.txt'),'utf8'),name+' preserved');
  assert.equal((await fs.lstat(path.join(out,name))).isSymbolicLink(),false);
 }
 await assert.rejects(fs.stat(path.join(out,'node_modules')));
 await fs.writeFile(path.join(temp,'unrelated-secret'),'private');
 await fs.symlink(path.join(temp,'unrelated-secret'),path.join(persistent,'imports','escape'));
 await assert.rejects(stageRecovery(app,path.join(temp,'bad')),/outside application storage/);
 await fs.unlink(path.join(persistent,'imports','escape'));
 await fs.symlink(path.join(persistent,'imports'),path.join(persistent,'imports','loop'),'dir');
 await assert.rejects(stageRecovery(app,path.join(temp,'loop')),/Circular/);
 console.log('PASS: external persistent data/imports/uploads copied, no links retained, dependencies excluded, unrelated external links and cycles rejected.');
} finally { await fs.rm(temp,{recursive:true,force:true}); }
