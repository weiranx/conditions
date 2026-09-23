// 7-day outlook for the chosen spot (mock): sky colors + status
const DAYS=[['Wed','23','cau','Risky',['#4a6f94','#aebcc7']],['Thu','24','ok','Clear',['#357fd0','#d3e5f5']],['Fri','25','ok','Clear',['#3a7fcb','#cfe1f2']],
 ['Sat','26','cau','Rain',['#3c4753','#7e8a95']],['Sun','27','ok','Cloudy',['#5b7a98','#c3ccd4']],['Mon','28','ok','Clear',['#357fd0','#d8e7f5']],['Tue','29','unk','Unsure',['#999','#ccc']]];
let di=0,start=0,dur=12;
const days=document.getElementById('days');
days.innerHTML=DAYS.map(([d,n,k,l,c],i)=>`<button class="day ${k}" role="radio" aria-checked="${i===di}" data-i="${i}" style=""><span class="dn">${d}</span><span class="dd">${n}</span><span class="sw" style="background:linear-gradient(${c[0]},${c[1]})"></span><span class="gl"><svg class="sym"><use href="#${k==='cau'?'s-tri':k==='ok'?'s-check':'s-q'}"/></svg>${l}</span></button>`).join('');
days.addEventListener('click',e=>{const b=e.target.closest('.day');if(!b)return;di=+b.dataset.i;[...days.children].forEach((c,i)=>c.setAttribute('aria-checked',i===di));upd()});
const ACT=[['Mountain hiking','s-boot'],['Exposed scrambling','s-hand'],['Alpine climbing','s-axe'],['Snow climbing','s-crampon'],['Ski touring','s-ski'],['Trail running','s-run']];
let ai=0;const acts=document.getElementById('acts');
acts.innerHTML=ACT.map(([n,ic],i)=>`<button class="act" role="radio" aria-checked="${i===ai}" data-i="${i}"><svg class="sym"><use href="#${ic}"/></svg><b>${n}</b></button>`).join('');
acts.addEventListener('click',e=>{const b=e.target.closest('.act');if(!b)return;ai=+b.dataset.i;[...acts.children].forEach((c,i)=>c.setAttribute('aria-checked',i===ai));upd()});
const lbl=t=>{const m=Math.round((t+7)*60),h=((Math.floor(m/60))%24+24)%24;return `${h%12||12}:${String(((m%60)+60)%60).padStart(2,'0')} ${h<12?'AM':'PM'}`};
document.querySelectorAll('.stp button').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.d)start=Math.max(-4,Math.min(6,start+ +b.dataset.d));if(b.dataset.u)dur=Math.max(1,Math.min(16,dur+ +b.dataset.u));upd()}));
const svg=document.getElementById('track');
function track(){
 const W=Math.max(300,svg.clientWidth||600),Hh=86,T0=-3,T1=15,X=t=>8+(t-T0)/(T1-T0)*(W-16),y=34;
 const stormy=di===0,ov=stormy?[Math.max(start,FIRST),Math.min(start+dur,LAST+1)]:null;
 let s=`<defs><pattern id="ph" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="6" height="6" style="fill:var(--caution-fill)"/><line x1="0" y1="0" x2="0" y2="6" style="stroke:var(--caution)" stroke-width="1.5"/></pattern></defs>`;
 s+=`<rect x="${X(T0)}" y="${y-14}" width="${X(T1)-X(T0)}" height="28" rx="14" style="fill:var(--fill)"/>`;
 s+=`<rect x="${X(T0)}" y="${y-14}" width="${X(SUNRISE_T)-X(T0)}" height="28" rx="14" fill="#26324f" opacity=".85"/><rect x="${X(SUNSET_T)}" y="${y-14}" width="${X(T1)-X(SUNSET_T)}" height="28" rx="14" fill="#26324f" opacity=".85"/>`;
 if(stormy)s+=`<rect x="${X(FIRST)}" y="${y-14}" width="${X(LAST+1)-X(FIRST)}" height="28" fill="url(#ph)"/>`;
 s+=`<rect x="${X(start)}" y="${y-6}" width="${X(start+dur)-X(start)}" height="12" rx="6" class="ink" opacity=".9"/>`;
 if(ov&&ov[1]>ov[0])s+=`<rect x="${X(ov[0])}" y="${y-6}" width="${X(ov[1])-X(ov[0])}" height="12" class="cau"/>`;
 s+=`<circle cx="${X(start)}" cy="${y}" r="11" class="surf" style="stroke:var(--label);stroke-width:3"/><circle cx="${X(start+dur)}" cy="${y}" r="8" class="surf" style="stroke:var(--label);stroke-width:3"/>`;
 s+=`<text x="${X(SUNRISE_T)}" y="12" text-anchor="middle">sunrise 6:52</text><text x="${X(SUNSET_T)}" y="12" text-anchor="middle">sunset 7:30</text>`;
 if(stormy)s+=`<text x="${(X(FIRST)+X(LAST+1))/2}" y="${y+30}" text-anchor="middle" class="cau">storm 12–4 PM</text>`;
 [-2,1,4,7,10,13].forEach(t=>s+=`<text x="${X(t)}" y="${Hh-2}" text-anchor="middle">${lbl(t).replace(':00','')}</text>`);
 svg.setAttribute('viewBox',`0 0 ${W} ${Hh}`);svg.innerHTML=s;
 svg.setAttribute('aria-label',`Planned hours ${lbl(start)} to ${lbl(start+dur)}. Sunrise 6:52 AM, sunset 7:30 PM.${stormy?' Storm expected 12 to 4 PM.':''}`);
}
function upd(){
 document.getElementById('st').textContent=lbl(start);document.getElementById('du').textContent=`${dur} h`;
 document.getElementById('rng').textContent=`${lbl(start)} → ${lbl(start+dur)}`;
 const [d,n,k]=DAYS[di];document.getElementById('pvt').textContent=`${d}, Sep ${n} · ${lbl(start).replace(':00','')}–${lbl(start+dur).replace(':00','')}`;
 const dark=Math.max(0,SUNRISE_T-start)+Math.max(0,start+dur-SUNSET_T);
 document.getElementById('pvn').innerHTML=(k==='cau'&&di===0?'<b style="color:var(--caution)">A storm is likely 12–4 PM.</b> The brief will check it against your limits.':k==='unk'?'Forecast confidence is low this far out.':'Looks settled so far. The brief will confirm.')+(dark?` <b>${Math.round(dark*60)} min</b> in the dark.`:'')+` ${ACT[ai][0]}.`;
 track();
}
addEventListener('resize',track);upd();
// map preview
(function(){const el=document.getElementById('pmap');let s=`<rect width="400" height="220" style="fill:var(--fill)"/>`;
 for(let r=1;r<=11;r++)s+=`<ellipse cx="250" cy="100" rx="${r*24}" ry="${r*17}" transform="rotate(-20 250 100)" fill="none" class="secS" stroke-opacity="${r%5?0.16:0.34}"/>`;
 s+=`<g transform="translate(250,100)"><circle r="22" class="acc" opacity=".18"/><path d="M0 8s-12-10-12-18a12 12 0 1 1 24 0C12-2 0 8 0 8z" transform="translate(0,-10)" class="acc"/><circle cy="-20" r="4.5" style="fill:var(--on-accent)"/></g>`;
 s+=`<text x="16" y="204" class="ink" style="font-weight:600">10,738 ft</text><text x="384" y="204" text-anchor="end">Tap to adjust the point</text>`;el.innerHTML=s;})();
