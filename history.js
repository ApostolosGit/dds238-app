/* V5 history presentation. No third-party chart library or ESP-side buffers. */
window.EnergyHistory = (() => {
  'use strict';
  const DAY = 86400000;
  const local = epoch => new Date(epoch * 1000).toLocaleString('el-GR', {timeZone:'Europe/Athens'});
  const dayLabel = day => new Date(day * DAY).toLocaleDateString('el-GR', {timeZone:'UTC',day:'2-digit',month:'2-digit'});
  const number = n => Number(n).toLocaleString('el-GR',{maximumFractionDigits:3});
  function daily(rows, days, today) {
    const byDay = new Map(rows.map(r => [r.day, r]));
    return Array.from({length:days}, (_, i) => {
      const day = today - days + 1 + i, row = byDay.get(day);
      return {label:dayLabel(day), values:row ? [0,2,4].map(j => (row.wh[j]-row.wh[j+1])/1000) : null,
        flags:row?.flags ?? 32, detail:row ? `${local(row.first)} έως ${local(row.last)} · ${Math.round(row.covered/60)} λεπτά καταγραφής` : 'Δεν υπάρχει καταγραφή'};
    });
  }
  function intervals(rows) {
    const points = [...new Map(rows.map(r => [r.epoch,r])).values()].sort((a,b)=>a.epoch-b.epoch);
    return points.slice(1).map((p,i) => {
      const a=points[i], span=p.epoch-a.epoch;
      const valid=span>0 && span<=7200 && a.generation===p.generation && p.import>=a.import && p.export>=a.export;
      return {label:new Date(p.epoch*1000).toLocaleTimeString('el-GR',{timeZone:'Europe/Athens',hour:'2-digit',minute:'2-digit'}),
        values:valid ? [(p.import-a.import-p.export+a.export)/1000] : null,
        flags:valid ? (span>2100 ? 2 : 0) : 32,
        detail:`${local(a.epoch)} → ${local(p.epoch)} · ${Math.round(span/60)} λεπτά`};
    });
  }
  function svg(groups, dual) {
    const colors=dual ? ['#548ae8','#9066d8','#16a58a'] : ['#548ae8'];
    const width=Math.max(650,groups.length*(dual?38:18)+80), height=300, top=25, bottom=250;
    const values=groups.flatMap(g=>g.values ? (dual ? g.values : [g.values.reduce((a,b)=>a+b,0)]) : []);
    const max=Math.max(0,...values), min=Math.min(0,...values), range=max-min || 1;
    const y=n=>bottom-(n-min)/range*(bottom-top), zero=y(0), plot=width-80, step=plot/Math.max(1,groups.length);
    let out=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Ισοζύγιο ενέργειας σε kWh" style="min-width:${width}px">`;
    for(const value of [max,0,min]) out+=`<line x1="55" x2="${width-15}" y1="${y(value)}" y2="${y(value)}" stroke="#b9c9d4"/><text x="50" y="${y(value)+4}" text-anchor="end" fill="#526576" font-size="11">${number(value)}</text>`;
    groups.forEach((g,i)=>{
      const x=55+i*step, vs=g.values ? (dual ? g.values : [g.values.reduce((a,b)=>a+b,0)]) : null;
      if(!vs) out+=`<text x="${x+step/2}" y="${zero-5}" text-anchor="middle" fill="#7a8b95" font-size="13">×</text>`;
      else vs.forEach((v,j)=>{
        const bw=(step-5)/vs.length, yy=y(v), bh=Math.max(v===0?1:2,Math.abs(yy-zero));
        out+=`<rect x="${x+j*bw+2}" y="${v>=0 ? yy : zero}" width="${Math.max(1,bw-1)}" height="${bh}" fill="${colors[j]}" opacity="${g.flags?'.55':'1'}"><title>${g.label} · ${dual?['Ζ1','Ζ2 νύχτας','Ζ2 μεσημεριού'][j]:'Ζ'}: ${number(v)} kWh</title></rect>`;
      });
      if(groups.length<=30 || i%4===0) out+=`<text x="${x+step/2}" y="275" text-anchor="middle" fill="#526576" font-size="10">${g.label}</text>`;
    });
    return out+'</svg>';
  }
  return {daily,intervals,svg,local,number};
})();
