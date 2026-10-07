import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('app.js',root),'utf8');
const html=fs.readFileSync(new URL('index.html',root),'utf8');
const savedSession=new Map();
function boot(session=savedSession){
 const dom=new Map(),timers=new Map(),intervals=new Map(),swHandlers=new Map(),windowHandlers=new Map(),clients=[];let seq=0,reloads=0,now=Date.now();
 class ClockDate extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 function node(){return {value:'',innerHTML:'',textContent:'',open:false,disabled:false,checked:false,dataset:{},handlers:new Map(),classList:{add(){},remove(){},toggle(){}},addEventListener(e,f){this.handlers.set(e,f);},insertAdjacentElement(_p,c){addIds(c.innerHTML);},showModal(){this.open=true;},close(){this.open=false;this.handlers.get('close')?.();},focus(){},reset(){},setAttribute(){}};}
 function addIds(markup){for(const m of markup.matchAll(/\bid="([^"]+)"/g)){if(!dom.has(m[1]))dom.set(m[1],node());}}
 addIds(html);const footer=[node(),node()],local=new Map();
 const ctx={console:{error(){},warn(){},log(){}},Date:ClockDate,Intl,Map,Set,Math,Number,JSON,URL,Promise,
  document:{body:{appendChild:c=>addIds(c.innerHTML)},getElementById:id=>dom.get(id)||null,createElement:()=>node(),querySelectorAll:()=>footer,addEventListener(){},visibilityState:'visible'},
  window:{addEventListener:(e,f)=>windowHandlers.set(e,f),location:{reload(){++reloads;}},confirm:()=>true},
  navigator:{serviceWorker:{controller:{},addEventListener:(e,f)=>swHandlers.set(e,f),register:async()=>({update:async()=>{}})}},
  localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v)},
  sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},
  setTimeout:(f,ms)=>{timers.set(++seq,{f,ms});return seq;},clearTimeout:id=>timers.delete(id),setInterval:(f,ms)=>{intervals.set(++seq,{f,ms});return seq;},clearInterval:id=>intervals.delete(id),
  mqtt:{connect(url,settings){const handlers=new Map();const c={url,settings,connected:false,published:[],subscribe(_t,_o,cb){cb(null,[{qos:0},{qos:128}]);},on:(e,f)=>handlers.set(e,f),emit(e,...args){if(e==='connect')c.connected=true;handlers.get(e)?.(...args);},publish(t,p,o,cb){if(c.throwId&&t.includes('/'+c.throwId+'/'))throw new Error('one device publish failed');c.published.push({t,p});cb?.(null);},end(){c.connected=false;handlers.get('close')?.();}};clients.push(c);return c;}}
 };
 vm.createContext(ctx);
 vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.testApp={devices,connect,disconnect,renderAll,requestAll,requestUpdate,readMqttSession,setOtaSession:v=>otaSession=v};})();'),ctx);
 return {ctx,dom,timers,intervals,swHandlers,clients,app:ctx.testApp,
   advance(ms){now+=ms;},fire(id){const timer=timers.get(id);assert(timer,`Missing timer ${id}`);timers.delete(id);timer.f();},get reloads(){return reloads;}};
}
let b=boot();const settings={host:'broker.example',port:'8884',path:'/mqtt',username:'esp-meter',password:'test-only-secret'};
b.app.connect(settings);let c=b.clients.at(-1);c.emit('connect');assert(b.intervals.size>0,'partial subscribe failure must not stop remaining devices');
const message=(id,suffix,payload,retain=false)=>c.emit('message',`home/energy/${id}/${suffix}`,{toString:()=>typeof payload==='string'?payload:JSON.stringify(payload)},{retain});
const dds1='DDS-18FE34000001',dds2='DDS-18FE34000002',jsy='jsy_house-18FE34000003';
const health=(meter,ok)=>({meter,firmware:'5.01',meter_ok:ok,read_attempted:true,has_sample:ok,dual_zone:false,rssi:-50,chip_id:1,error:ok?'':'modbus_read_failed'});
message(dds1,'status','online');message(dds1,'health',health('DDS238',false));
message(dds2,'status','online');message(dds2,'health',health('DDS238',true));message(dds2,'state',{meter:'DDS238',firmware:'5.01',voltage:230,current:1,power:230,pf:1,frequency:50});
message(jsy,'status','online');message(jsy,'health',health('JSY-MK-333',true));message(jsy,'state',{meter:'JSY-MK-333',firmware:'5.01',v1:230,v2:230,v3:230,i1:1,i2:1,i3:1,p1:230,p2:230,p3:230,power_total:690});
let rendered=b.dom.get('devicesGrid').innerHTML;
assert(rendered.includes('Σφάλμα μετρητή DDS238'));assert(rendered.includes(dds1)&&rendered.includes(dds2)&&rendered.includes(jsy));assert.equal(b.dom.get('metersStatus').textContent,'3');
message(dds1,'state','null');assert(b.dom.get('devicesGrid').innerHTML.includes(jsy));assert.equal(b.app.devices.get(jsy).state.power_total,690);
message(dds1,'state','{bad-json');assert.equal(b.app.devices.size,3);
// Repeated polling keeps one interval and preserves a pending response deadline.
const refreshIntervals=b.intervals.size;
b.app.requestAll(false);const pending=b.app.devices.get(dds2).responseTimer;
const sentBefore=c.published.length;b.app.requestAll(false);
assert.equal(b.app.devices.get(dds2).responseTimer,pending);
assert.equal(c.published.length,sentBefore);assert.equal(b.intervals.size,refreshIntervals);
message(dds2,'state',{meter:'DDS238',firmware:'5.56',power:230});
message(jsy,'state',{meter:'JSY-MK-333',firmware:'5.56',power_total:690});
message(dds1,'health',health('DDS238',false));
// A failed request and a slow response affect only that device.
c.throwId=dds1;b.app.requestAll(false);assert(c.published.some(p=>p.t.includes('/'+dds2+'/request')));assert(c.published.some(p=>p.t.includes('/'+jsy+'/request')));c.throwId=null;
b.advance(60000);b.app.requestUpdate(dds1,false);let timeout=b.app.devices.get(dds1).responseTimer;
b.advance(10000);b.fire(timeout);assert(!b.app.devices.get(dds1).responseTimedOut,'One missed reply must retry first');
b.advance(10000);b.fire(b.app.devices.get(dds1).responseTimer);assert(b.app.devices.get(dds1).responseTimedOut);assert(!b.app.devices.get(jsy).responseTimedOut);
message(dds1,'health',health('DDS238',false));assert(!b.app.devices.get(dds1).responseTimedOut);
message(dds1,'state',{meter:'DDS238',firmware:'5.01',voltage:231,current:2,power:462,pf:1,frequency:50});assert(b.app.devices.get(dds1).health.meter_ok);
// Retained health must not override an observed LWT offline state.
message(dds2,'status','offline');message(dds2,'health',health('DDS238',true),true);assert(!b.app.devices.get(dds2).online);message(dds2,'health',health('DDS238',true),false);assert(b.app.devices.get(dds2).online);
// An unexpected rendering exception stays within one card.
b.app.devices.get(dds1).lastReceived={};b.app.renderAll();assert(b.dom.get('devicesGrid').innerHTML.includes('Οι υπόλοιπες συνεχίζουν'));assert(b.dom.get('devicesGrid').innerHTML.includes(jsy));
// OTA can finish from health even when the physical sensor remains absent.
b.app.setOtaSession({id:jsy,targetVersion:'5.01',fromVersion:'5.00',manifest:{meter:'JSY',oled:'SSD1309'}});
message(jsy,'health',health('JSY-MK-333',false));assert(b.dom.get('otaProgressStatus').textContent.includes('ενεργό'));
// A pre-existing device cannot be mistaken for a legacy-ID transition.
b.app.setOtaSession({id:'DDS',targetVersion:'5.01',fromVersion:'5.00',manifest:{meter:'DDS238'},knownDeviceIds:new Set([dds1,dds2])});
message(dds2,'health',health('DDS238',true));
assert(!b.dom.get('otaProgressStatus').textContent.includes('εντοπίστηκε'));
const migrated='DDS-18FE34000004';message(migrated,'health',health('DDS238',false));assert(b.dom.get('otaProgressStatus').textContent.includes(migrated));
assert.equal(b.app.readMqttSession().password,settings.password);b.swHandlers.get('controllerchange')();assert.equal(b.reloads,0);
let restored=boot(savedSession);assert.equal(restored.clients.length,1);assert.equal(restored.clients[0].settings.password,settings.password);restored.app.disconnect(true);assert.equal(savedSession.size,0);
let rejected=boot(new Map());rejected.app.connect(settings);rejected.clients[0].emit('error',new Error('Connection refused: Not authorized'));assert(rejected.dom.get('settingsDialog').open);assert(!rejected.clients[0].connected);
assert(source.includes('OTA_TOTAL_TIMEOUT_MS = 180000'));assert(source.includes('μέσα σε 3 λεπτά'));assert(html.includes('section-mqtt current-password'));assert(!fs.readFileSync(new URL('sw.js',root),'utf8').includes('client.navigate('));
console.log('Two sites/same firmware, missing DDS + healthy DDS/JSY, malformed frames, isolated timeout/render failures, recovery, LWT, partial subscribe, tab-session reload and non-disruptive app updates PASS');

// Reproduce the screenshot: retired retained profile ID plus the live MAC ID.
const probeBoot=boot(new Map());probeBoot.app.connect(settings);const probeClient=probeBoot.clients.at(-1);probeClient.emit('connect');
const frame=(id,suffix,payload,retain=false)=>probeClient.emit('message',`home/energy/${id}/${suffix}`,{toString:()=>typeof payload==='string'?payload:JSON.stringify(payload)},{retain});
const old='jsy_house',live='jsy_house-84F3EB041E89',liveDds='DDS-5CCF7FF0904F';
frame(old,'status','online',true);
frame(live,'status','online',true);frame(liveDds,'status','online',true);
assert.equal(probeBoot.dom.get('metersStatus').textContent,'0','Retained online is unconfirmed');
probeBoot.fire(probeBoot.app.devices.get(old).probeTimer);
const retiredDeadline=probeBoot.app.devices.get(old).responseTimer;
frame(old,'health',health('JSY-MK-333',true),true);
frame(old,'state',{meter:'JSY-MK-333',firmware:'5.00',power_total:999},true);
assert.equal(probeBoot.app.devices.get(old).responseTimer,retiredDeadline,'Retained packets cannot satisfy a probe');
assert.equal(probeBoot.app.devices.get(old).lastReceived,null,'Cached state cannot get a current timestamp');
frame(live,'health',health('JSY-MK-333',true));frame(live,'state',{meter:'JSY-MK-333',firmware:'5.55',power_total:253});
frame(liveDds,'state',{meter:'DDS238',firmware:'5.55',power:23,voltage:236});
probeBoot.advance(10000);probeBoot.fire(retiredDeadline);
probeBoot.advance(10000);probeBoot.fire(probeBoot.app.devices.get(old).responseTimer);
assert.equal(probeBoot.dom.get('metersStatus').textContent,'2');
assert(!probeBoot.dom.get('devicesGrid').innerHTML.includes('data-device="jsy_house"'),'Retired profile cannot produce a permanent error card');
assert(!probeBoot.dom.get('devicesGrid').innerHTML.includes('ESP δεν απάντησε'));
assert.equal(probeBoot.app.devices.get(live).state.power_total,253);
// A genuine older ESP using that profile at another site still appears on reply.
frame(old,'state',{meter:'JSY-MK-333',firmware:'5.00',power_total:123});
assert.equal(probeBoot.dom.get('metersStatus').textContent,'3');
frame(old,'status','offline');assert.equal(probeBoot.dom.get('metersStatus').textContent,'2');
// Transient loss / the old firmware's 1.5-second request limiter: retry recovers.
probeBoot.app.requestUpdate(liveDds,false);const first=probeBoot.app.devices.get(liveDds).responseTimer;
const sent=probeClient.published.length;probeBoot.app.requestUpdate(liveDds,true);
assert.equal(probeClient.published.length,sent,'Rapid manual refresh cannot flood/reset the request');
probeBoot.advance(10000);probeBoot.fire(first);
assert.equal(probeClient.published.length,sent+1);assert(!probeBoot.app.devices.get(liveDds).responseTimedOut);
const retryTimer=probeBoot.app.devices.get(liveDds).responseTimer;
frame(liveDds,'state',{meter:'DDS238',firmware:'5.55',power:25});
assert.equal(probeBoot.app.devices.get(liveDds).responseTimer,null);assert(!probeBoot.timers.has(retryTimer));
assert(!probeBoot.app.devices.get(liveDds).updateDelayed);
// Heartbeat confirms only connectivity. Delayed samples remain explicitly old.
probeBoot.app.requestUpdate(liveDds,false);
probeBoot.advance(10000);probeBoot.fire(probeBoot.app.devices.get(liveDds).responseTimer);
const second=probeBoot.app.devices.get(liveDds).responseTimer,previousSample=probeBoot.app.devices.get(liveDds).lastReceived;
frame(liveDds,'health',health('DDS238',true));
assert.equal(probeBoot.app.devices.get(liveDds).responseTimer,second,'Healthy heartbeat is not a measurement');
probeBoot.advance(10000);probeBoot.fire(second);
assert(!probeBoot.app.devices.get(liveDds).responseTimedOut);assert(probeBoot.app.devices.get(liveDds).updateDelayed);
assert.equal(probeBoot.app.devices.get(liveDds).state.power,25);
assert.equal(probeBoot.app.devices.get(liveDds).lastReceived,previousSample);
assert(probeBoot.dom.get('devicesGrid').innerHTML.includes('Εμφανίζεται η προηγούμενη μέτρηση'));
frame(liveDds,'health',health('DDS238',false));assert(probeBoot.dom.get('devicesGrid').innerHTML.includes('Σφάλμα μετρητή DDS238'));
frame(liveDds,'state',{meter:'DDS238',firmware:'5.56',power:27});assert(!probeBoot.app.devices.get(liveDds).updateDelayed);
// If all live evidence stops, a real failure is still reported after both tries.
probeBoot.advance(60000);probeBoot.app.requestUpdate(liveDds,false);
probeBoot.advance(10000);probeBoot.fire(probeBoot.app.devices.get(liveDds).responseTimer);
probeBoot.advance(10000);probeBoot.fire(probeBoot.app.devices.get(liveDds).responseTimer);
assert(probeBoot.app.devices.get(liveDds).responseTimedOut);
assert(probeBoot.dom.get('devicesGrid').innerHTML.includes('δύο αιτήματα'));
assert(!probeBoot.app.devices.get(live).responseTimedOut);
// Reconnect must obtain new live proof, and callbacks from an old session do nothing.
probeBoot.app.requestUpdate(live,false);const orphan=probeBoot.timers.get(probeBoot.app.devices.get(live).responseTimer).f;
probeClient.connected=false;probeClient.emit('close');assert.equal(probeBoot.dom.get('metersStatus').textContent,'0');
orphan();assert(!probeBoot.app.devices.get(live).responseTimedOut);
probeClient.emit('connect');frame(live,'status','online',true);frame(live,'health',health('JSY-MK-333',true),true);
assert.equal(probeBoot.dom.get('metersStatus').textContent,'0');
frame(live,'state',{meter:'JSY-MK-333',firmware:'5.56',power_total:254});
assert.equal(probeBoot.dom.get('metersStatus').textContent,'1');
probeBoot.app.disconnect(false);orphan();assert.equal(probeBoot.app.devices.size,0);
console.log('Retained ghost + MAC ID, live legacy site, cached snapshots, retry, heartbeat vs fresh sample, real failures, reconnect and orphan timers PASS');
