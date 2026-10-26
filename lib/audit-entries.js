import crypto from 'node:crypto';
const fields={Company:'company',Person:'person',Role:'role',Country:'country',City:'city',Phone:'phone',Mobile:'mobile',Email:'email',Website:'website',Address:'address','Source ID':'sourceId'};
const allowed=new Set(['Country','City','Phone','Mobile','Email','Website','Address']);
export const fingerprint=rows=>crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const text=x=>String(x??'').trim();
export function previewEntries(customers,entries){
 if(!Array.isArray(entries)||entries.length>15000)throw Error('Invalid entry plan');
 const used=new Set();
 const decisions=entries.map(e=>{
  const old=e.expected_snapshot, changes=e.proposed_fields||{};
  if(!old||typeof old.Company!=='string'||Object.keys(changes).some(k=>!allowed.has(k)||typeof changes[k]!=='string'))throw Error('Invalid fields');
  let matches=customers.filter(c=>!c.archivedAt&&text(c.company)===text(old.Company)&&text(c.person)===text(old.Person));
  if(old['Source ID'])matches=matches.filter(c=>text(c.sourceId)===text(old['Source ID']));
  else matches=matches.filter(c=>text(c.email)===text(old.Email));
  if(e.expected_id){matches=customers.filter(c=>!c.archivedAt&&c.id===e.expected_id&&Object.entries(fields).every(([k,v])=>text(c[v])===text(old[k])));}
  const c=matches.length===1?matches[0]:null;
  let status=matches.length===0?'changed-or-absent':matches.length>1?'ambiguous':'ready';
  if(c){
   if(used.has(c.id))status='duplicate-plan-entry';else used.add(c.id);
   const conflicts=Object.entries(changes).filter(([k,v])=>text(c[fields[k]])!==text(old[k])&&text(c[fields[k]])!==text(v));
   if(conflicts.length)status='field-conflict';
   const target=e.review_action==='Keep in Review'?'pending':'resolved';
   if(status==='ready'&&Object.entries(changes).every(([k,v])=>text(c[fields[k]])===text(v))&&c.reviewStatus===target)status='already-applied';
  }
  return {row:e.snapshot_row,id:c?.id,company:old.Company,status,context:status==='ready'||status==='already-applied'?undefined:customers.filter(x=>!x.archivedAt&&((text(old.Company)&&text(x.company).toLowerCase()===text(old.Company).toLowerCase())||(text(old['Source ID'])&&text(x.sourceId)===text(old['Source ID']))||(text(x.company)===text(old.Company)&&text(x.person)===text(old.Person)))).slice(0,150).map(x=>({id:x.id,...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,x[v]||''])),reviewStatus:x.reviewStatus,notes:x.notes})),changes,reviewAction:e.review_action,reasons:e.remaining_reasons||[],note:e.notes_to_append||'',evidence:e.evidence||[]};
 });
 return {fingerprint:fingerprint(customers),ready:decisions.filter(d=>d.status==='ready').length,decisions};
}
export function applyEntries(customers,decisions){
 for(const d of decisions.filter(d=>d.status==='ready')){
  const c=customers.find(c=>c.id===d.id);
  for(const [k,v] of Object.entries(d.changes))c[fields[k]]=v;
  c.reviewStatus=d.reviewAction==='Keep in Review'?'pending':'resolved';
  c.reviewReason=d.reasons.join('; ');
  c.notes=[c.notes,d.note,'Audit entry applied 2026-10-26: '+d.evidence.join(' | ')].filter(Boolean).join('\n');
  c.updatedAt=new Date().toISOString();
 }
}
