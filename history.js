/* Energy history: signed net kWh, with no third-party chart library. */
window.EnergyHistory = (() => {
  'use strict';
  const DAY = 86400000;
  const dateFormat = new Intl.DateTimeFormat('el-GR', {
    timeZone:'Europe/Athens', year:'numeric', month:'numeric', day:'numeric',
    hour:'numeric', minute:'numeric', second:'numeric'
  });
  const dayFormat = new Intl.DateTimeFormat('el-GR', {timeZone:'UTC', day:'2-digit', month:'2-digit'});
  const timeFormat = new Intl.DateTimeFormat('el-GR', {timeZone:'Europe/Athens', hour:'2-digit', minute:'2-digit'});
  const numberFormat = new Intl.NumberFormat('el-GR', {maximumFractionDigits:3});
  const local = epoch => dateFormat.format(new Date(epoch * 1000));
  const dayLabel = day => dayFormat.format(new Date(day * DAY));
  const number = n => numberFormat.format(Number(n));
  const zoneNames = ['Ζ1','Ζ2 μεσημεριού','Ζ2 νύχτας'];
  const colors = ['#548ae8','#16a58a','#9066d8'];
  const xml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

  function daily(rows, days, today) {
    const byDay = new Map(rows.map(r => [r.day, r]));
    return Array.from({length:days}, (_, i) => {
      const day = today - days + 1 + i, row = byDay.get(day);
      return {label:dayLabel(day), values:row ? [0,4,2].map(j => (row.wh[j]-row.wh[j+1])/1000) : null,
        flags:row?.flags ?? 32, detail:row ? `${local(row.first)} έως ${local(row.last)} · ${Math.round(row.covered/60)} λεπτά καταγραφής` : 'Δεν υπάρχει καταγραφή'};
    });
  }

  function intervals(rows) {
    const points = [...new Map(rows.map(r => [r.epoch,r])).values()].sort((a,b)=>a.epoch-b.epoch);
    return points.slice(1).map((p,i) => {
      const a=points[i], span=p.epoch-a.epoch;
      const valid=span>0 && span<=7200 && a.generation===p.generation && p.import>=a.import && p.export>=a.export;
      return {label:timeFormat.format(new Date(p.epoch*1000)),
        values:valid ? [(p.import-a.import-p.export+a.export)/1000] : null,
        flags:valid ? (span>2100 ? 2 : 0) : 32,
        detail:`${local(a.epoch)} → ${local(p.epoch)} · ${Math.round(span/60)} λεπτά`};
    });
  }

  function svg(groups, dual) {
    // Sum/format each displayed bar once. Label width determines spacing so
    // seven/thirty-day and dense hourly charts remain readable when scrolled.
    const bars = groups.map(g => g.values
      ? (dual ? g.values : [g.values.reduce((a,b)=>a+b,0)]).map(value => ({value, label:number(value)}))
      : null);
    let max=0, min=0, slot=44;
    for (const group of bars) for (const bar of group || []) {
      max=Math.max(max,bar.value); min=Math.min(min,bar.value);
      slot=Math.max(slot,bar.label.length*6.5+12);
    }
    const width=Math.max(650,groups.length*(dual?3:1)*slot+80), height=300, top=28, bottom=250;
    const range=max-min || 1, y=n=>bottom-(n-min)/range*(bottom-top);
    const zero=y(0), step=(width-80)/Math.max(1,groups.length);
    let out=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Ισοζύγιο ενέργειας σε kWh" style="min-width:${width}px">`;
    for (const value of new Set([max,0,min])) out+=`<line x1="55" x2="${width-15}" y1="${y(value)}" y2="${y(value)}" stroke="#b9c9d4"/><text x="50" y="${y(value)+4}" text-anchor="end" fill="#526576" font-size="11">${number(value)}</text>`;
    groups.forEach((g,i)=>{
      const x=55+i*step, group=bars[i];
      if (!group) out+=`<text x="${x+step/2}" y="${zero-5}" text-anchor="middle" fill="#7a8b95" font-size="13">×</text>`;
      else group.forEach(({value,label},j)=>{
        const bw=(step-5)/group.length, yy=y(value), barTop=value>=0 ? yy : zero;
        const bx=x+j*bw+2, barWidth=Math.max(1,bw-1), bh=Math.max(value===0?1:2,Math.abs(yy-zero));
        out+=`<rect x="${bx}" y="${barTop}" width="${barWidth}" height="${bh}" fill="${colors[j]}" opacity="${g.flags?'.55':'1'}"><title>${xml(g.label)} · ${dual?zoneNames[j]:'Ζ'}: ${label} kWh</title></rect>`;
        out+=`<text class="bar-value" x="${bx+barWidth/2}" y="${barTop-6}" text-anchor="middle" fill="#263d4b" font-size="11" font-weight="600">${label}</text>`;
      });
      if (groups.length<=30 || i%4===0) out+=`<text x="${x+step/2}" y="275" text-anchor="middle" fill="#526576" font-size="10">${xml(g.label)}</text>`;
    });
    return out+'</svg>';
  }
  return {daily,intervals,svg,local,number};
})();
