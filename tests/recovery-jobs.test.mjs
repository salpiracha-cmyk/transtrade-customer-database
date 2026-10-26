import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRecoveryJobs} from '../lib/recovery-jobs.js';
let release;
const gate=new Promise(resolve=>{release=resolve;});
const jobs=createRecoveryJobs(async(folder,progress,deadline)=>{
 assert(deadline>Date.now());progress('Copying persistent files');await gate;
 const file=path.join(folder,'backup.tar.gz');await fs.writeFile(file,'verified bytes');return file;
});
const first=jobs.start();assert.equal(first.state,'preparing');assert.equal(jobs.start().id,first.id);assert.equal(jobs.file(first.id),null);
release();const ready=await jobs.wait(first.id);assert.equal(ready.state,'ready');assert.equal(ready.bytes,14);assert.equal(ready.limitSeconds,7200);assert.equal(await fs.readFile(jobs.file(first.id),'utf8'),'verified bytes');await jobs.close();
const failed=createRecoveryJobs(async()=>{throw Error('fixture error');});const bad=failed.start();assert.equal((await failed.wait(bad.id)).state,'failed');assert.equal(failed.file(bad.id),null);await failed.close();
const timed=createRecoveryJobs(async(folder,progress)=>{await new Promise(r=>setTimeout(r,15));progress('late');},{limitMs:1});const timeout=timed.start();assert.equal((await timed.wait(timeout.id)).state,'failed');await timed.close();
console.log('PASS: immediate job acknowledgement, duplicate starts share work, ready download, failure propagation and deadline enforcement.');
