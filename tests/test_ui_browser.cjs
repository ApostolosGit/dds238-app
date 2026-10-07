const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright' : 'playwright');
const root=path.resolve(__dirname,'..');
const artifacts=path.join(root,'tests/ui-artifacts');fs.mkdirSync(artifacts,{recursive:true});
const previewTmp=path.join(artifacts,'tmp');fs.mkdirSync(previewTmp,{recursive:true});process.env.TMPDIR=previewTmp;
const server=http.createServer((req,res)=>{
 const file=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
 const full=path.join(root,file);
 if(!fs.existsSync(full)){res.writeHead(404);res.end();return;}
 let content=fs.readFileSync(full);
 if(file==='index.html') content=Buffer.from(content.toString().replace(/<script[^>]+src="https:[^>]+><\/script>/g,''));
 if(file==='app.js') content=Buffer.from(content.toString().replace(/\}\)\(\);\s*$/,'window.testApp={devices,renderAll};})();'));
 res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html');res.end(content);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1280,height:850}});
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await page.evaluate(()=>{
  for(const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  testApp.devices.set('jsy_house-18FE34123456',{id:'jsy_house-18FE34123456',online:true,sampleReceived:true,lastReceived:new Date(),state:{meter:'JSY-MK-333',firmware:'5.55',dual_zone:true,rssi:-45,v1:231,v2:232,v3:230,i1:2,i2:1,i3:3,p1:400,p2:-200,p3:600,power_total:800,pf1:.9,pf2:.9,pf3:.9,frequency:50}});
  testApp.renderAll();
 });
 assert.deepEqual(await page.locator('.device-actions button').evaluateAll(bs=>bs.map(b=>b.dataset.action)),['admin','history','refresh']);
 const colors=await page.locator('.device-actions button').evaluateAll(bs=>bs.map(b=>({bg:getComputedStyle(b).backgroundColor,fg:getComputedStyle(b).color})));
 assert.deepEqual(colors[1],colors[2]);assert.notEqual(colors[0].bg,colors[2].bg);
 await page.screenshot({path:path.join(artifacts,'desktop.png')});
 await page.setViewportSize({width:390,height:850});
 await page.screenshot({path:path.join(artifacts,'mobile.png')});
 const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,class:e.className,text:e.textContent.slice(0,70),right:e.getBoundingClientRect().right}))}));
 console.log('Mobile geometry',JSON.stringify(overflow));
 assert(overflow.scroll<=overflow.width,'App must not overflow on mobile');
 await page.setViewportSize({width:1000,height:650});
 await page.evaluate(()=>{
  const dialog=document.querySelector('.energy-history-dialog');dialog.showModal();
  document.getElementById('energyHistoryPlot').innerHTML=EnergyHistory.svg([
   {label:'01/10',values:[5.25,-3.125,0],flags:0},
   {label:'02/10',values:[3.96,-6.94,1.5],flags:1},
   {label:'03/10',values:null,flags:32},
   {label:'04/10',values:[2.075,-1.56,.85],flags:0},
   {label:'05/10',values:[6.71,-8.16,-.76],flags:0},
   {label:'06/10',values:[-1.257,-3.584,1.51],flags:0},
   {label:'07/10',values:[1.08,-.731,.289],flags:16}
  ],true);
 });
 assert.equal(await page.locator('.bar-value').count(),18);
 const geometry=await page.locator('.energy-history-plot svg').evaluate(svg=>{
  const labels=[...svg.querySelectorAll('.bar-value')],rects=[...svg.querySelectorAll('rect')];
  return labels.map((text,i)=>{const box=text.getBBox(),rect=rects[i];return {number:text.textContent,top:box.y,bottom:box.y+box.height,barTop:+rect.getAttribute('y'),left:box.x,right:box.x+box.width,center:+text.getAttribute('x')};});
 });
 for(const label of geometry) assert(label.top>=0&&label.bottom<label.barTop,'Value must fit above its bar: '+label.number);
 for(let i=1;i<geometry.length;i++) assert(geometry[i-1].right<geometry[i].left,'Value labels must not overlap');
 await page.screenshot({path:path.join(artifacts,'chart.png')});
 await browser.close();server.close();console.log('Real-browser desktop/mobile buttons, no mobile overflow, 18 signed bar labels above bars with no clipping/overlap PASS');
})().catch(e=>{console.error(e);server.close();process.exit(1);});
