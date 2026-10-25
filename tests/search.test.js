import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('search ignores late results and clears results after a failed request', async () => {
  const source=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const start=source.indexOf('let dashboardSearchVersion = 0;');
  const end=source.indexOf('\nfunction renderCustomers',start);
  const input={value:'old'}, summary={textContent:''}, requests=[], renders=[];
  const context=vm.createContext({URLSearchParams, state:{}, document:{getElementById:id=>id==='dashboardSearchInput'?input:summary},
    api:()=>new Promise((resolve,reject)=>requests.push({resolve,reject})),
    renderCustomerRows:rows=>renders.push(rows), toast:()=>{}});
  vm.runInContext(source.slice(start,end),context);
  const old=context.loadDashboardSearch();
  input.value='new';
  const fresh=context.loadDashboardSearch();
  requests[1].resolve({total:1,customers:[{company:'New'}]}); await fresh;
  requests[0].resolve({total:1,customers:[{company:'Old'}]}); await old;
  assert.equal(renders.at(-1)[0].company,'New');
  input.value='failure';
  const failed=context.loadDashboardSearch();
  assert.equal(renders.at(-1).length,0);
  requests[2].reject(new Error('Network unavailable')); await failed;
  assert.equal(renders.at(-1).length,0);
  assert.match(summary.textContent,/Search failed/);
  input.value='in-flight';
  const pending=context.loadDashboardSearch();
  input.value='changed before debounce';
  requests[3].resolve({total:1,customers:[{company:'Stale'}]}); await pending;
  assert.equal(renders.at(-1).length,0);
});
