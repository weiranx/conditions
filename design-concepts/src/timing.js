// t = hours after 7 AM. Storm window = hours over limits (12–4 PM). Above treeline = objective ± 1.5 h (objective 5 h in).
const STORM=[FIRST,LAST+1], OPTS=[-2,-1,0,1], T0=-3, T1=14;
const lbl=t=>{const m=Math.round((t+7)*60),h=Math.floor(m/60)%24,mm=m%60;return `${h%12||12}${mm?':'+String(mm).padStart(2,'0'):''} ${h<12?'AM':'PM'}`};
const dur=h=>{const m=Math.round(h*60);return m===0?'0 min':(m>=60?`${Math.floor(m/60)} h`:'')+(m%60?` ${m%60} min`:'')};
const ov=(a,b,c,d)=>Math.max(0,Math.min(b,d)-Math.max(a,c));
const rows=OPTS.map(s=>{const ex=[s+3.5,s+6.5];return{s,ex,storm:ov(ex[0],ex[1],STORM[0],STORM[1]),darkS:Math.max(0,SUNRISE_T-s),darkE:Math.max(0,s+12-SUNSET_T)}});
const best=rows.reduce((a,b)=>b.storm<a.storm?b:a);
const svg=document.getElementById('starts');
function draw(){
 const W=Math.max(320,svg.clientWidth||700),narrow=W<560,pl=narrow?74:72,pr=narrow?8:250,top=30,rh=narrow?76:58,Hh=top+rows.length*rh+26;
 const x=t=>pl+(t-T0)/(T1-T0)*(W-pl-pr);
 let s=`<defs><pattern id="sh" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" style="fill:var(--caution-fill)"/><line x1="0" y1="0" x2="0" y2="6" style="stroke:var(--caution)" stroke-width="1.6"/></pattern></defs>`;
 // night + storm backdrop
 s+=`<rect x="${x(T0)}" y="${top-6}" width="${x(SUNRISE_T)-x(T0)}" height="${Hh-top-14}" fill="#26324f" opacity=".12"/><rect x="${x(SUNSET_T)}" y="${top-6}" width="${x(T1)-x(SUNSET_T)}" height="${Hh-top-14}" fill="#26324f" opacity=".12"/>`;
 s+=`<rect x="${x(STORM[0])}" y="${top-6}" width="${x(STORM[1])-x(STORM[0])}" height="${Hh-top-14}" style="fill:var(--caution-fill)" opacity=".7"/>`;
 s+=`<text x="${(x(STORM[0])+x(STORM[1]))/2}" y="${top-12}" text-anchor="middle" class="cau">Storm · 12–4 PM</text>`;
 s+=`<text x="${x(SUNRISE_T)}" y="${top-12}" text-anchor="middle">sunrise</text><text x="${x(SUNSET_T)}" y="${top-12}" text-anchor="middle">sunset</text>`;
 rows.forEach((r,i)=>{const cy=top+i*rh+rh/2-6,cur=r.s===0,isBest=r===best;
  s+=`<text x="0" y="${cy+5}" class="ink" style="font-size:${narrow?13:15}px;font-weight:${cur||isBest?700:500}">${lbl(r.s)}</text>`;
  if(cur)s+=`<text x="0" y="${cy+20}" style="font-size:11px">your plan</text>`;
  if(isBest)s+=`<text x="0" y="${cy+20}" style="font-size:11px;fill:var(--accent);font-weight:600">best margin</text>`;
  s+=`<rect x="${x(r.s)}" y="${cy-7}" width="${x(r.s+12)-x(r.s)}" height="14" rx="7" class="ok"/>`;
  if(r.darkS)s+=`<rect x="${x(r.s)}" y="${cy-7}" width="${x(SUNRISE_T)-x(r.s)}" height="14" rx="7" fill="#26324f"/>`;
  if(r.darkE)s+=`<rect x="${x(SUNSET_T)}" y="${cy-7}" width="${x(r.s+12)-x(SUNSET_T)}" height="14" rx="7" fill="#26324f"/>`;
  s+=`<rect x="${x(r.ex[0])}" y="${cy-4}" width="${x(r.ex[1])-x(r.ex[0])}" height="8" rx="4" class="ink"/>`;
  if(r.storm){const a=Math.max(r.ex[0],STORM[0]),b=Math.min(r.ex[1],STORM[1]);s+=`<rect x="${x(a)}" y="${cy-9}" width="${x(b)-x(a)}" height="18" rx="5" fill="url(#sh)" style="stroke:var(--caution)" stroke-width="1.5"/>`;}
  s+=`<path d="M${x(r.s+5)} ${cy-12} l5 -8 l5 8z" transform="translate(-5,0)" class="ink"/>`;
  if(isBest||cur)s+=`<rect x="${pl-6}" y="${cy-rh/2+4}" width="${W-pl+6-(narrow?0:0)}" height="${rh-8}" rx="12" fill="none" style="stroke:${isBest?'var(--accent)':'var(--separator)'}" stroke-width="${isBest?2:1}"/>`;
  const sum=(r.storm?`${dur(r.storm)} above treeline in the storm`:'Off exposed ground before the storm')+(r.darkS?` · starts ${dur(r.darkS)} before sunrise`:'')+(r.darkE?` · back ${dur(r.darkE)} after sunset`:'');
  if(!narrow)s+=`<text x="${W-pr+14}" y="${cy+4}" class="${r.storm?'cau':'ink'}" style="font-size:12.5px;font-weight:${r.storm?600:500}">${sum.split(' · ')[0]}</text>`+(sum.includes(' · ')?`<text x="${W-pr+14}" y="${cy+20}" style="font-size:12px">${sum.split(' · ').slice(1).join(' · ')}</text>`:'');
  else s+=`<text x="${pl}" y="${cy+28}" class="${r.storm?'cau':'ink'}" style="font-size:11.5px;font-weight:600">${sum.split(' · ')[0]}</text>`;
 });
 [-2,1,4,7,10,13].forEach(t=>s+=`<text x="${x(t)}" y="${Hh-4}" text-anchor="middle">${lbl(t).replace(':00','')}</text>`);
 svg.setAttribute('viewBox',`0 0 ${W} ${Hh}`);svg.innerHTML=s;
 svg.setAttribute('aria-label','Start time comparison. '+rows.map(r=>`${lbl(r.s)} start: ${r.storm?dur(r.storm)+' above treeline during the storm':'off exposed ground before the storm'}${r.darkS?', starts '+dur(r.darkS)+' before sunrise':''}${r.darkE?', returns '+dur(r.darkE)+' after sunset':''}.`).join(' '));
}
draw();addEventListener('resize',draw);
