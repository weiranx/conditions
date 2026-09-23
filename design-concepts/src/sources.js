// age in hours; state: ok | stale | failed | none
const SRC=[
 {n:'NOAA/NWS forecast',a:.7,st:'ok'},{n:'Open-Meteo',a:1,st:'ok'},{n:'NWS alerts',a:0,st:'failed',note:'no response'},
 {n:'AirNow air quality',a:2,st:'ok'},{n:'SNOTEL station',a:6,st:'ok'},{n:'NOHRSC snow model',a:18,st:'stale',note:'18 h old'},
 {n:'Avalanche.org',a:0,st:'none',note:'not issued'},{n:'sunrisesunset.io',a:.1,st:'ok'}];
const ago=a=>a<1?`${Math.round(a*60)} min ago`:`${Math.round(a)} h ago`;
const svg=document.getElementById('fresh');
function draw(){
 const W=Math.max(320,svg.clientWidth||800),narrow=W<560,lw=narrow?130:190,rw=narrow?0:120,rh=34,pt=26,Hh=pt+SRC.length*rh+22;
 const X=a=>W-rw-10-(a/24)*(W-rw-10-lw);
 let s=`<rect x="${X(24)}" y="${pt-8}" width="${X(12)-X(24)}" height="${SRC.length*rh}" style="fill:var(--fill)" opacity=".7"/>`;
 s+=`<line x1="${X(12)}" x2="${X(12)}" y1="${pt-14}" y2="${pt+SRC.length*rh-8}" class="secS" stroke-dasharray="3 3"/><text x="${X(12)}" y="${pt-16}" text-anchor="middle">older than 12 h</text>`;
 s+=`<text x="${X(0)}" y="${pt-16}" text-anchor="end" class="ink" style="font-weight:600">now</text>`;
 SRC.forEach((r,i)=>{const cy=pt+i*rh+rh/2-8,x=X(r.a);
  s+=`<line x1="${lw}" x2="${X(0)}" y1="${cy}" y2="${cy}" class="secS" stroke-opacity=".15"/>`;
  s+=`<text x="0" y="${cy+4}" class="${r.st==='failed'||r.st==='none'?'':'ink'}" style="font-size:${narrow?12:14}px;font-weight:${r.st==='ok'?500:600}">${r.n}</text>`;
  if(r.st==='ok')s+=`<line x1="${x}" x2="${X(0)}" y1="${cy}" y2="${cy}" class="inks" stroke-width="3" stroke-linecap="round"/><circle cx="${x}" cy="${cy}" r="7" class="ink"/>`;
  if(r.st==='stale')s+=`<line x1="${x}" x2="${X(0)}" y1="${cy}" y2="${cy}" class="secS" stroke-width="3" stroke-dasharray="1 5" stroke-linecap="round"/><circle cx="${x}" cy="${cy}" r="7" class="surf" style="stroke:var(--secondary);stroke-width:2.5"/>`;
  if(r.st==='failed')s+=`<circle cx="${X(0)}" cy="${cy}" r="9" fill="none" style="stroke:var(--missing)" stroke-width="2" stroke-dasharray="3 3"/><path d="M${X(0)-4} ${cy-4}l8 8M${X(0)+4} ${cy-4}l-8 8" style="stroke:var(--missing)" stroke-width="2" stroke-linecap="round"/>`;
  if(r.st==='none')s+=`<line x1="${X(0)-14}" x2="${X(0)}" y1="${cy}" y2="${cy}" class="secS" stroke-width="3" stroke-linecap="round"/>`;
  if(!narrow)s+=`<text x="${W-rw+4}" y="${cy+4}" class="${r.st==='failed'?'':r.st==='stale'?'':'ink'}" style="font-weight:${r.st==='ok'?400:600}">${r.note||ago(r.a)}</text>`;
  else if(r.note)s+=`<text x="${X(0)-18}" y="${r.st==='stale'?cy-8:cy+4}" text-anchor="end" style="font-weight:600;font-size:11px">${r.note}</text>`;
 });
 [24,18,12,6].forEach(a=>s+=`<text x="${X(a)}" y="${Hh-4}" text-anchor="middle">${a} h</text>`);
 svg.setAttribute('viewBox',`0 0 ${W} ${Hh}`);svg.innerHTML=s;
 svg.setAttribute('aria-label','Source freshness. '+SRC.map(r=>`${r.n}: ${r.note||ago(r.a)}`).join('. '));
}
draw();addEventListener('resize',draw);
// what changed: from → to, with a tiny slope
const CH=[['Rain chance at noon','60%','80%',1],['Peak gust','25 mph','31 mph',1],['Low temperature','29°F','25°F',-1],['Trip decision','Go','Caution',1]];
document.getElementById('changes').innerHTML=CH.map(([k,a,b,d])=>`<div class="chg num"><span>${k}</span><span class="v"><s>${a}</s> → <span style="color:${k==='Low temperature'?'var(--cold)':'var(--caution)'}">${b}</span></span><svg viewBox="0 0 64 24" aria-hidden="true"><line x1="6" y1="${d>0?18:6}" x2="58" y2="${d>0?6:18}" style="stroke:${k==='Low temperature'?'var(--cold)':'var(--caution)'}" stroke-width="2.5" stroke-linecap="round"/><circle cx="6" cy="${d>0?18:6}" r="3.5" style="fill:var(--secondary)"/><circle cx="58" cy="${d>0?6:18}" r="4" style="fill:${k==='Low temperature'?'var(--cold)':'var(--caution)'}"/></svg></div>`).join('');
