const CLOUD=[5,8,15,35,60,90,95,95,85,40,20,10];
const FEELS=H.map(h=>Math.round(h.t-h.g*.35));
const M={
 temp:{label:'Temperature',unit:'°F',v:H.map(h=>h.t),line:true,ref:32,refLbl:'freezing 32°F',refCls:'cold',min:10,max:70,note:'Below freezing 2–3 PM on your objective.'},
 feels:{label:'Feels like',unit:'°F',v:FEELS,line:true,ref:32,refLbl:'freezing 32°F',refCls:'cold',min:10,max:70,note:`Wind makes it feel like ${Math.min(...FEELS)}°F at the coldest hour.`},
 gust:{label:'Gust',unit:' mph',v:H.map(h=>h.g),ref:LIM.g,refLbl:'your limit 25 mph',refCls:'cau',min:0,max:40,limit:LIM.g,note:'Gusts cross your 25 mph limit from 12 to 3 PM.'},
 rain:{label:'Rain chance',unit:'%',v:H.map(h=>h.p),ref:LIM.p,refLbl:'your limit 60%',refCls:'cau',min:0,max:100,limit:LIM.p-1,note:'Rain chance is at or above your 60% limit from 12 to 3 PM.'},
 cloud:{label:'Cloud cover',unit:'%',v:CLOUD,min:0,max:100,note:'Clear morning; the mountain clouds over from 11 AM.'},
};
const chart=document.getElementById('chart');
function draw(k){
 const m=M[k],W=Math.max(320,chart.clientWidth||700),Hc=W<500?200:230,pl=W<500?30:40,pr=8,pt=26,pb=28,cw=(W-pl-pr)/N,x=i=>pl+cw*(i+.5),y=v=>pt+(1-(v-m.min)/(m.max-m.min))*(Hc-pt-pb);
 let s='';
 H.forEach((h,i)=>{s+=`<rect x="${pl+cw*i}" y="${pt-8}" width="${cw}" height="${Hc-pt-pb+8}" fill="${SKY[i][1]}" opacity=".22"/>`;if(!h.ok)s+=`<rect x="${pl+cw*i}" y="${pt-8}" width="${cw}" height="${Hc-pt-pb+8}" fill="url(#wh)"/>`});
 [m.min,(m.min+m.max)/2,m.max].forEach(v=>s+=`<text x="${pl-6}" y="${y(v)+4}" text-anchor="end">${Math.round(v)}</text>`);
 if(m.ref!=null)s+=`<line x1="${pl}" x2="${W-pr}" y1="${y(m.ref)}" y2="${y(m.ref)}" class="${m.refCls}S" stroke-width="1.5" stroke-dasharray="4 4"/><text x="${W-pr}" y="${y(m.ref)-6}" text-anchor="end" class="${m.refCls}">${m.refLbl}</text>`;
 if(m.line){s+=`<polyline points="${m.v.map((v,i)=>x(i)+','+y(v)).join(' ')}" fill="none" class="inks" stroke-width="2.5" stroke-linejoin="round"/>`;
  m.v.forEach((v,i)=>{const c=v<32?'cold':'ink';s+=`<circle cx="${x(i)}" cy="${y(v)}" r="4" class="${c==='cold'?'cold':'surf'}" style="stroke:var(--${c==='cold'?'cold':'label'});stroke-width:2"/><text x="${x(i)}" y="${v<32?y(v)+18:y(v)-10}" text-anchor="middle" class="${c}" style="font-weight:600">${v}°</text>`})}
 else m.v.forEach((v,i)=>{const bw=Math.min(cw*.6,30),bh=Math.max(2,(v-m.min)/(m.max-m.min)*(Hc-pt-pb)),over=m.limit!=null&&v>m.limit;s+=`<rect x="${x(i)-bw/2}" y="${y(m.min)-bh}" width="${bw}" height="${bh}" rx="4" class="${over?'cau':(k==='cloud'?'sec':'ok')}" ${k==='cloud'?'opacity=".45"':''}/><text x="${x(i)}" y="${y(m.min)-bh-5}" text-anchor="middle" class="${over?'cau':''}">${v}</text>`});
 H.forEach((h,i)=>s+=`<text x="${x(i)}" y="${Hc-8}" text-anchor="middle" class="${h.ok?'':'cau'}">${h.h}</text>`);
 chart.setAttribute('viewBox',`0 0 ${W} ${Hc}`);
 chart.innerHTML=`<defs><pattern id="wh" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="7" style="stroke:var(--caution)" stroke-opacity=".35" stroke-width="1.5"/></pattern></defs>`+s;
 chart.setAttribute('aria-label',`${m.label} by hour, 7 AM to 6 PM: `+m.v.map((v,i)=>`${FULL[i]} ${v}${m.unit}`).join(', '));
 document.getElementById('note').textContent=m.note;
}
let cur='temp';
document.querySelectorAll('#metric button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('#metric button').forEach(x=>x.setAttribute('aria-pressed',x===b));cur=b.dataset.m;draw(cur)}));
addEventListener('resize',()=>draw(cur));draw(cur);
// hourly table
const glyph=(h,i)=>h.p>=45?'<svg class="sym rain"><use href="#s-rain"/></svg>':CLOUD[i]>=40?'<svg class="sym"><use href="#s-cloud"/></svg>':CLOUD[i]>=15?'<svg class="sym"><use href="#s-partly"/></svg>':'<svg class="sym"><use href="#s-clear"/></svg>';
document.getElementById('hours').innerHTML='<thead><tr><th>Hour</th><th>Sky</th><th>Temp</th><th class="hide-m">Feels</th><th>Gust</th><th>Rain</th><th>Limits</th></tr></thead><tbody>'+H.map((h,i)=>`<tr class="${h.ok?'':'over'}"><td><b>${FULL[i]}</b></td><td class="glyph">${glyph(h,i)}</td><td class="${h.t<32?'cold-v':''}">${h.t}°</td><td class="hide-m ${FEELS[i]<32?'cold-v':''}">${FEELS[i]}°</td><td class="${h.g>LIM.g?'over-v':''}">${h.g} mph</td><td class="${h.p>=LIM.p?'over-v':''}">${h.p}%</td><td>${h.ok?'<span class="st ok"><svg class="sym"><use href="#s-check"/></svg><span class="t">Within</span></span>':'<span class="st over"><svg class="sym"><use href="#s-tri"/></svg><span class="t">Over</span></span>'}</td></tr>`).join('')+'</tbody>';
// mini charts
function mini(id,vals,{min,max,ref,refLbl,refCls,fmt,bars,cls}){const el=document.getElementById(id),W=240,Hc=110,pt=18,pb=18,cw=W/N,x=i=>cw*(i+.5),y=v=>pt+(1-(v-min)/(max-min))*(Hc-pt-pb);let s='';
 if(ref!=null)s+=`<line x1="0" x2="${W}" y1="${y(ref)}" y2="${y(ref)}" class="${refCls}S" stroke-dasharray="3 3"/><text x="${W}" y="${y(ref)+13}" text-anchor="end" class="${refCls}">${refLbl}</text>`;
 if(bars)vals.forEach((v,i)=>{const bh=Math.max(2,(v-min)/(max-min)*(Hc-pt-pb));s+=`<rect x="${x(i)-cw*.3}" y="${Hc-pb-bh}" width="${cw*.6}" height="${bh}" rx="3" class="${cls(v)}"/>`});
 else{s+=`<polyline points="${vals.map((v,i)=>x(i)+','+y(v)).join(' ')}" fill="none" class="coldS" stroke-width="2.5"/>`;vals.forEach((v,i)=>{if(v<10738)s+=`<circle cx="${x(i)}" cy="${y(v)}" r="3.5" class="cold"/>`})}
 [0,4,8,11].forEach(i=>s+=`<text x="${x(i)}" y="${Hc-4}" text-anchor="middle">${H[i].h}</text>`);el.innerHTML=s;}
mini('fz',[14200,14100,13900,13400,12800,12000,11200,10500,10600,11800,12900,13500],{min:9500,max:14500,ref:10738,refLbl:'your objective 10,738 ft',refCls:'ink'});
mini('uv',[1,2,4,5,4,2,2,1,1,2,1,0],{min:0,max:8,bars:1,cls:v=>v>=5?'cau':'sec'});
mini('vis',[10,10,10,8,5,1.5,1,2,3,8,10,10],{min:0,max:10,bars:1,cls:v=>v<3?'cau':'ok'});
