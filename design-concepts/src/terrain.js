const FZ=[14200,14100,13900,13400,12800,12000,11200,10500,10600,11800,12900,13500], OBJ=10738, SNOW=12000, TREE=8900;
const PROF=[[0,6300],[.08,6950],[.24,7900],[.4,8900],[.52,10100],[.62,OBJ],[.72,11800],[.82,13100],[.9,14179],[1,12900]];
const svg=document.getElementById('xsec'),hrs=document.getElementById('hrs');let sel=7;
hrs.innerHTML=H.map((h,i)=>`<button role="radio" class="${h.ok?'':'over'}" aria-checked="${i===sel}" data-i="${i}">${h.h}</button>`).join('');
hrs.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;sel=+b.dataset.i;[...hrs.children].forEach((c,i)=>c.setAttribute('aria-checked',i===sel));draw()});
function draw(){
 const W=Math.max(320,svg.clientWidth||800),narrow=W<560,Hh=narrow?300:340,pr=narrow?64:110,E0=6000,E1=14800;
 const X=f=>f*(W-pr),Y=e=>Hh-(e-E0)/(E1-E0)*(Hh-20);
 const h=H[sel],tAt=e=>Math.round(h.t+(OBJ-e)/1000*3.5),fz=FZ[sel];
 const pts=PROF.map(([f,e])=>`${X(f).toFixed(1)},${Y(e).toFixed(1)}`).join(' L');
 let s=`<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SKY[sel][0]}"/><stop offset="1" stop-color="${SKY[sel][1]}"/></linearGradient>
 <clipPath id="above"><rect x="0" y="0" width="${W}" height="${Y(SNOW)}"/></clipPath>
 <marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#fff"/></marker></defs>`;
 s+=`<rect width="${W}" height="${Hh}" fill="url(#bg)"/>`;
 if(h.p>=45)for(let k=0;k<Math.round(W/22);k++){const rx=k*22+8;s+=`<line x1="${rx}" y1="8" x2="${rx-8}" y2="${Hh}" stroke="#dfeaf5" stroke-opacity="${h.p/260}" stroke-width="1.2"/>`}
 s+=`<path d="M${pts} L${X(1)},${Hh} L0,${Hh}Z" fill="#2e3f37"/>`;
 s+=`<path d="M${pts} L${X(1)},${Hh} L0,${Hh}Z" fill="#f4f7fa" clip-path="url(#above)"/>`;
 s+=`<rect x="${W-pr}" y="0" width="${pr}" height="${Hh}" fill="rgba(8,20,32,.42)"/>`;
 // treeline + snow line labels
 s+=`<line x1="0" x2="${W-pr}" y1="${Y(TREE)}" y2="${Y(TREE)}" stroke="#fff" stroke-opacity=".35" stroke-dasharray="2 5"/><text x="8" y="${Y(TREE)-6}" style="fill:#fff;opacity:.8">treeline ~8,900 ft</text>`;
 s+=`<line x1="0" x2="${W-pr}" y1="${Y(SNOW)}" y2="${Y(SNOW)}" stroke="#fff" stroke-opacity=".55" stroke-dasharray="2 4"/><text x="8" y="${Y(SNOW)-6}" style="fill:#fff;opacity:.85">snow line ~12,000 ft</text>`;
 // freezing level
 s+=`<line x1="0" x2="${W}" y1="${Y(fz)}" y2="${Y(fz)}" stroke="#9fd0ff" stroke-width="2.2" stroke-dasharray="6 5"/>`;
 s+=`<rect x="8" y="${Y(fz)-26}" width="${narrow?150:176}" height="20" rx="10" fill="rgba(8,20,32,.55)"/><text x="18" y="${Y(fz)-12}" style="fill:#cfe7ff;font-weight:600">freezing level ${fz.toLocaleString()} ft</text>`;
 // objective
 const ox=X(.62),oy=Y(OBJ),below=fz<OBJ;
 s+=`<circle cx="${ox}" cy="${oy}" r="7" fill="#fff" stroke="#17221d" stroke-width="3"/>`;
 s+=`<rect x="${ox-(narrow?58:66)}" y="${oy+14}" width="${narrow?116:132}" height="38" rx="10" fill="rgba(8,20,32,.62)"/><text x="${ox}" y="${oy+30}" text-anchor="middle" style="fill:#fff;font-weight:600">Objective · ${tAt(OBJ)}°F</text><text x="${ox}" y="${oy+45}" text-anchor="middle" style="fill:${below?'#9fd0ff':'#fff'};opacity:.9">${below?'below freezing level':'above freezing'}</text>`;
 // wind arrows (from SW, blowing to NE = up-right)
 const wind=(x0,y0,g)=>`<line x1="${x0-22}" y1="${y0+10}" x2="${x0+8}" y2="${y0-6}" stroke="#fff" stroke-width="2.5" marker-end="url(#ar)"/><text x="${x0+14}" y="${y0-6}" style="fill:${g>LIM.g?'#FFB27A':'#fff'};font-weight:700">${g} mph</text>`;
 s+=wind(ox+46,oy-8,h.g)+wind(X(.84),Y(13300)-30,Math.round(h.g*1.25));
 // elevation axis with temperatures at this hour
 [7000,9000,11000,13000].forEach(e=>{const t=tAt(e);s+=`<line x1="${W-pr}" x2="${W-pr+6}" y1="${Y(e)}" y2="${Y(e)}" stroke="#fff" stroke-opacity=".7"/><text x="${W-pr+10}" y="${Y(e)+4}" style="fill:#fff;font-weight:600">${(e/1000)}k ft</text><text x="${W-pr+(narrow?10:52)}" y="${Y(e)+(narrow?18:4)}" style="fill:${t<32?'#9fd0ff':'#fff'};opacity:.95">${t}°F</text>`});
 s+=`<text x="${W-8}" y="18" text-anchor="end" style="fill:#fff;font-weight:600;font-size:13px">${FULL[sel]}</text>`;
 svg.setAttribute('viewBox',`0 0 ${W} ${Hh}`);svg.innerHTML=s;
 svg.setAttribute('aria-label',`${FULL[sel]}: freezing level ${fz} feet, ${below?'below':'above'} your objective. At the objective ${tAt(OBJ)} degrees, gusts ${h.g} miles per hour. At 13,000 feet ${tAt(13000)} degrees.`);
}
draw();addEventListener('resize',draw);
// wind-loading rose: 8 aspects, leeward NE strongest
(function(){const el=document.getElementById('rose'),c=60,asp=['N','NE','E','SE','S','SW','W','NW'],load={NE:2,N:1,E:1};let s='';
 asp.forEach((a,i)=>{const a0=(i*45-22.5-90)*Math.PI/180,a1=(i*45+22.5-90)*Math.PI/180,r=46,l=load[a]||0;
  s+=`<path d="M${c} ${c} L${c+r*Math.cos(a0)} ${c+r*Math.sin(a0)} A${r} ${r} 0 0 1 ${c+r*Math.cos(a1)} ${c+r*Math.sin(a1)}Z" class="${l===2?'cau':l===1?'cau':'fillc'}" style="${l===1?'opacity:.4':''};stroke:var(--surface);stroke-width:2"/>`;
  const lx=c+56*Math.cos((i*45-90)*Math.PI/180),ly=c+56*Math.sin((i*45-90)*Math.PI/180)+4;s+=`<text x="${lx}" y="${ly}" text-anchor="middle" class="${l?'ink':''}" style="font-size:10px;font-weight:${l?700:400}">${a}</text>`});
 s+=`<circle cx="${c}" cy="${c}" r="14" class="surf"/><path d="M${c-9} ${c+9} L${c+6} ${c-6}" class="inks" stroke-width="2.2"/><path d="M${c+8} ${c-8} l-8 1 l7 7z" class="ink"/>`;el.innerHTML=s;})();
