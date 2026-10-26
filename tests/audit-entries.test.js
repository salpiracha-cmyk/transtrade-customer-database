import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewEntries,applyEntries} from '../lib/audit-entries.js';
test('audited updates preserve unrelated fields and reject conflicts and duplicate matches',()=>{
 const c={id:'one',company:'Test',person:'Buyer',sourceId:'CARD-1',country:'',phone:'0123456789',notes:'newer unrelated note',email:'buyer@example.com'};
 const e={snapshot_row:4,expected_snapshot:{Company:'Test',Person:'Buyer','Source ID':'CARD-1',Country:'',Phone:'0123456789'},proposed_fields:{Country:'Pakistan',Phone:'+92123456789'},review_action:'Keep in Review',remaining_reasons:['Identity check'],notes_to_append:'Prior fields retained'};
 let p=previewEntries([c],[e]);assert.equal(p.ready,1);applyEntries([c],p.decisions);assert.equal(c.country,'Pakistan');assert.equal(c.reviewStatus,'pending');assert.equal(c.email,'buyer@example.com');assert.match(c.notes,/newer unrelated note/);assert.equal(previewEntries([c],[e]).decisions[0].status,'already-applied');
 assert.equal(previewEntries([{...c,phone:'different'}],[e]).decisions[0].status,'field-conflict');
 assert.equal(previewEntries([c,{...c,id:'two'}],[e]).decisions[0].status,'ambiguous');
 assert.throws(()=>previewEntries([c],[{...e,proposed_fields:{password:'bad'}}]),/Invalid fields/);
});
