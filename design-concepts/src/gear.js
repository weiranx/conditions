// hours needed: indices into the 7 AM–6 PM day; kind colors the bar by the reason
const G=[
 {n:'Rain shell',ic:'s-jacket',r:'80% rain at 12 PM',h:[4,5,6,7,8],k:'cold',done:1},
 {n:'Warm layer',ic:'s-layer',r:'25°F at 2 PM',h:[5,6,7,8],k:'cold'},
 {n:'Gloves and hat',ic:'s-gloves',r:'Feels like 16°F at 2 PM',h:[6,7,8],k:'cold'},
 {n:'Traction',ic:'s-spikes',r:'Wet rock freezes after 2 PM',h:[7,8,9],k:'cau'},
 {n:'Sun protection',ic:'s-sunscreen',r:'UV 5 before the clouds',h:[1,2,3,4],k:'soft'},
 {n:'3 L of water',ic:'s-water',r:'12 hours, up to 64°F',h:[0,1,2,3,4,5,6,7,8,9,10,11],k:'soft'},
 {n:'Headlamp',ic:'s-lamp',r:'Only 30 min of daylight spare',h:[11],k:'soft'},
 {n:'Map and GPX on phone',ic:'s-map',r:'Visibility 1 mi at 1 PM',h:[5,6,7],k:'cau'},
];
const host=document.getElementById('gt');
host.innerHTML=G.map((g,i)=>`<label class="gi ${g.done?'done':''}"><input type="checkbox" ${g.done?'checked':''} aria-label="${g.n}: ${g.r}"><span class="who"><span class="box"><svg class="sym"><use href="#s-check"/></svg></span><span class="ic"><svg class="sym"><use href="#${g.ic}"/></svg></span><span><div class="nm">${g.n}</div><div class="rs">${g.r}</div></span></span><span class="lane" aria-hidden="true">${H.map((_,j)=>`<i class="${g.h.includes(j)?'on '+g.k:''}"></i>`).join('')}</span></label>`).join('');
const sub=document.getElementById('packsub');
const upd=()=>{const n=host.querySelectorAll('input:checked').length;sub.textContent=`${n} of ${G.length} packed · 3 things to settle before you leave`};
host.querySelectorAll('input').forEach(i=>i.addEventListener('change',()=>{i.closest('.gi').classList.toggle('done',i.checked);upd()}));upd();
