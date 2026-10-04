import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const source=readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../app.js'),'utf8');
function fn(name){
 const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);
 const end=source.indexOf('\n  function ',start+1);return source.slice(start,end<0?source.length:end);
}
const ctx=vm.createContext({MIN_DEVIATION_KWH:0.01,utilityHistoryRows:[],firmwareAtLeast:()=>true,formatNumber:(x,n)=>x.toFixed(n)});
vm.runInContext(['utilitySortTime','parseUtilityHistoryRows','utilityDeviation','deviationText','utilityCanDelete','utilityActionButtons'].map(fn).join('\n'),ctx);
const call=(name,...args)=>ctx[name](...args);
const rows=call('parseUtilityHistoryRows',[
 'ID,Date,Mode,Kind,Z,Z1,Z2,TimeToken,Mapped,Anchor,AnchorZ1,AnchorZ2,EKFlags,PredictedWh,ActualWh,CanDelete',
 '1,2026-10-04,mono,tk,100,0,0,10:00,1,10.000,0,0,0,0,0,1',
 '2,2026-10-04,mono,ek,101.50,0,0,11:00,1,12.000,0,0,7,2000,1500,0',
 '3,2026-10-04,mono,ek,103.00,0,0,11:10,1,13.000,0,0,7,1000,1500,1'
]);assert.equal(rows.length,3);ctx.utilityHistoryRows=rows;
assert(Math.abs(call('utilityDeviation',rows[0],rows[1])-33.333333)<0.00001);
assert(Math.abs(call('utilityDeviation',rows[1],rows[2])+33.333333)<0.00001);
// Frozen snapshot is used even with missing/edited/deleted previous rows.
assert.equal(call('utilityDeviation',null,rows[1]),call('utilityDeviation',{z:999},rows[1]));
assert.equal(call('utilityDeviation',null,{...rows[1],ekFlags:5}),null);
assert.equal(call('utilityDeviation',null,{...rows[1],actualWh:0}),null);
assert.equal(call('utilityDeviation',null,{...rows[1],predictedWh:NaN}),null);
assert.equal(call('utilityCanDelete',rows[0]),true);
assert.equal(call('utilityCanDelete',rows[1]),false);
assert.equal(call('utilityCanDelete',rows[2]),true);
assert.match(call('utilityActionButtons',rows[1],'mono','3.14'),/disabled title=/);
assert(!call('utilityActionButtons',rows[2],'mono','3.14').includes('disabled'));
// Backdated latest E.K. is identified by ID (creation order), not table position.
ctx.utilityHistoryRows=[...rows,{...rows[1],id:4,date:'2026-10-03',canDelete:true}];
assert(!call('utilityCanDelete',rows[2]));assert(call('utilityCanDelete',ctx.utilityHistoryRows[3]));
const legacy=call('parseUtilityHistoryRows',['1,2026-10-04,mono,tk,100,0,0,10:00,1,10,0,0','2,2026-10-04,mono,ek,101.5,0,0,11:00,1,12,0,0']);
assert(Math.abs(call('utilityDeviation',legacy[0],legacy[1])-33.333333)<0.00001);
const old=call('parseUtilityHistoryRows',['1,2026-10-04,mono,100,0,0,window']);assert.equal(old[0].kind,'tk');assert(!old[0].mapped);
console.log('App CSV compatibility, immutable deviation and latest-E.K. actions PASS');
