import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export function createRecoveryJobs(prepare, options={}) {
  const jobs=new Map();
  const limit=options.limitMs ?? 2*60*60*1000;
  const retention=options.retentionMs ?? 2*60*60*1000;
  const describe=job=>({id:job.id,state:job.state,progress:job.progress,error:job.error,bytes:job.bytes,created:job.created,limitSeconds:limit/1000});
  return {
    start() {
      // Repeated start requests after a network retry share the same active job.
      const active=[...jobs.values()].find(j=>j.state==='preparing');
      if(active)return describe(active);
      const job={id:crypto.randomUUID(),state:'preparing',progress:'Preparing full recovery',created:Date.now()};
      jobs.set(job.id,job);
      job.done=(async()=>{
        let folder;
        try {
          folder=await fs.mkdtemp(path.join(os.tmpdir(),'tti-recovery-job-'));
          job.folder=folder;
          const deadline=job.created+limit;
          job.archive=await prepare(folder, message=>{
            if(Date.now()>deadline)throw Error('Full recovery exceeded the two-hour preparation limit.');
            job.progress=message;
          },deadline);
          if(Date.now()>deadline)throw Error('Full recovery exceeded the two-hour preparation limit.');
          job.bytes=(await fs.stat(job.archive)).size;
          job.state='ready';job.progress='Full recovery ready to download';
        } catch(error) {
          job.state='failed';job.error=error.message;job.progress='Full recovery preparation failed';
        } finally {
          const timer=setTimeout(()=>{jobs.delete(job.id);if(folder)fs.rm(folder,{recursive:true,force:true}).catch(()=>{});},retention);
          timer.unref();
        }
      })();
      return describe(job);
    },
    status(id){const job=jobs.get(id);return job?describe(job):null;},
    file(id){const job=jobs.get(id);return job?.state==='ready'?job.archive:null;},
    async wait(id){await jobs.get(id)?.done;return this.status(id);},
    async close(){await Promise.all([...jobs.values()].map(async job=>{await job.done;if(job.folder)await fs.rm(job.folder,{recursive:true,force:true});}));jobs.clear();}
  };
}
