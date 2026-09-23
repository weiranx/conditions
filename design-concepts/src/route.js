// Out-and-back profile: [mile, elevation ft, hours after 7 AM]
const P=[[0,6950,0],[1.5,7900,1],[2.9,8900,2],[4.6,10100,3.5],[5.9,10738,5],[7.2,10100,7],[8.9,8900,9],[10.3,7900,10.5],[11.8,6950,12]];
const CP=[{n:'Trailhead',i:0},{n:'Treeline',i:2},{n:'Ridge',i:3},{n:'Objective',i:4},{n:'Ridge',i:5},{n:'Treeline',i:6},{n:'Trailhead',i:8}];
const hourAt=t=>Math.min(N-1,Math.max(0,Math.floor(t)));
const tm=t=>{const m=Math.round((t+7)*60),h=Math.floor(m/60);return `${h%12||12}:${String(m%60).padStart(2,'0')} ${h<12?'AM':'PM'}`};
const tempAt=(e,t)=>Math.round(H[hourAt(t)].t+(10738-e)/1000*3.5);
const svg=document.getElementById('prof');
function draw(){
 const W=Math.max(320,svg.clientWidth||800),narrow=W<560,Hh=narrow?230:260,pl=narrow?34:44,pr=10,pt=46,pb=34,E0=6500,E1=11200;
 const X=m=>pl+m/11.8*(W-pl-pr),Y=e=>pt+(1-(e-E0)/(E1-E0))*(Hh-pt-pb);
 let s=`<defs><pattern id="rh" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><rect width="7" height="7" style="fill:var(--caution-fill)"/><line x1="0" y1="0" x2="0" y2="7" style="stroke:var(--caution)" stroke-width="1.6" stroke-opacity=".6"/></pattern></defs>`;
 [8000,10000].forEach(e=>s+=`<line x1="${pl}" x2="${W-pr}" y1="${Y(e)}" y2="${Y(e)}" class="secS" stroke-opacity=".18"/><text x="${pl-6}" y="${Y(e)+4}" text-anchor="end">${e/1000}k</text>`);
 // fine segments colored by hour you're there
 const seg=[];for(let k=0;k<P.length-1;k++){const [m0,e0,t0]=P[k],[m1,e1,t1]=P[k+1];for(let j=0;j<8;j++){const a=j/8,b=(j+1)/8;seg.push([m0+(m1-m0)*a,e0+(e1-e0)*a,t0+(t1-t0)*a,m0+(m1-m0)*b,e0+(e1-e0)*b])}}
 seg.forEach(([ma,ea,ta,mb,eb])=>{const over=!H[hourAt(ta)].ok;s+=`<path d="M${X(ma)} ${Y(ea)} L${X(mb)} ${Y(eb)} L${X(mb)} ${Hh-pb} L${X(ma)} ${Hh-pb}Z" fill="${over?'url(#rh)':'var(--ok-fill)'}" ${over?'':'opacity=".7"'}/>`});
 s+=`<polyline points="${P.map(p=>X(p[0])+','+Y(p[1])).join(' ')}" fill="none" class="inks" stroke-width="2.5" stroke-linejoin="round"/>`;
 seg.forEach(([ma,ea,ta,mb,eb])=>{if(!H[hourAt(ta)].ok)s+=`<line x1="${X(ma)}" y1="${Y(ea)}" x2="${X(mb)}" y2="${Y(eb)}" class="cauS" stroke-width="4" stroke-linecap="round"/>`});
 CP.forEach((c,k)=>{const [m,e,t]=P[c.i],over=!H[hourAt(t)].ok,up=k<3||k===3;const lx=X(m),ly=Y(e);
  s+=`<circle cx="${lx}" cy="${ly}" r="11" class="${over?'cau':'ink'}"/><text x="${lx}" y="${ly+4}" text-anchor="middle" style="fill:var(--bg);font-weight:700;font-size:11px">${k+1}</text>`;
  if(!narrow||k%2===0||k===3)s+=`<text x="${lx}" y="${ly-18}" text-anchor="middle" class="${over?'cau':'ink'}" style="font-weight:600">${tm(t).replace(':00','')}</text>`;});
 [0,2.9,5.9,8.9,11.8].forEach(m=>s+=`<text x="${X(m)}" y="${Hh-12}" text-anchor="middle">${m} mi</text>`);
 s+=`<text x="${X(7.4)}" y="${Hh-pb-10}" text-anchor="middle" class="cau" style="font-weight:700">in the storm</text>`;
 svg.setAttribute('viewBox',`0 0 ${W} ${Hh}`);svg.innerHTML=s;
 svg.setAttribute('aria-label','Elevation profile, 11.8 miles out and back. '+CP.map((c,k)=>{const [m,e,t]=P[c.i];return `${k+1}. ${c.n}, mile ${m}, ${e.toLocaleString()} feet, ${tm(t)}${H[hourAt(t)].ok?'':', over your limits'}`}).join('. '));
}
draw();addEventListener('resize',draw);
// checkpoint table
document.getElementById('cps').innerHTML='<thead><tr><th>Checkpoint</th><th>Mile</th><th class="hide-m">Elev.</th><th>Arrive</th><th>Temp</th><th>Gust</th></tr></thead><tbody>'+CP.map((c,k)=>{const [m,e,t]=P[c.i],h=H[hourAt(t)],te=tempAt(e,t);return `<tr class="${h.ok?'':'over'}"><td><span class="num-dot" style="${h.ok?'':'background:var(--caution)'}">${k+1}</span>${c.n}</td><td>${m}</td><td class="hide-m">${e.toLocaleString()} ft</td><td><b>${tm(t)}</b></td><td class="${te<32?'cold-v':''}">${te}°</td><td class="${h.g>LIM.g?'over-v':''}">${h.g}</td></tr>`}).join('')+'</tbody>';
// stylized topo map with route
(function(){const el=document.getElementById('map');let s=`<rect width="400" height="300" style="fill:var(--fill)"/>`;
 for(let r=1;r<=14;r++)s+=`<ellipse cx="300" cy="80" rx="${r*26}" ry="${r*19}" transform="rotate(-24 300 80)" fill="none" class="secS" stroke-opacity="${r%5?0.16:0.32}"/>`;
 const pts=[[40,260],[95,222],[150,190],[215,140],[268,98]];
 s+=`<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" style="stroke:var(--surface)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;
 s+=`<polyline points="${pts.slice(0,4).map(p=>p.join(',')).join(' ')}" fill="none" class="inks" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
 s+=`<polyline points="${pts.slice(3).map(p=>p.join(',')).join(' ')}" fill="none" class="cauS" stroke-width="5" stroke-linecap="round"/>`;
 [[0,1],[2,2],[3,3],[4,4]].forEach(([pi,n])=>{const [x,y]=pts[pi];s+=`<circle cx="${x}" cy="${y}" r="11" class="${n===4?'cau':'ink'}"/><text x="${x}" y="${y+4}" text-anchor="middle" style="fill:var(--bg);font-weight:700;font-size:11px">${n}</text>`});
 s+=`<text x="54" y="286" class="ink" style="font-weight:600">Trailhead 6,950 ft</text><text x="286" y="70" class="cau" style="font-weight:700">Objective</text><text x="370" y="290" text-anchor="end">1 mi ⟷</text>`;el.innerHTML=s;})();
