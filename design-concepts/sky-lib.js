// Shared helpers for the Sky pages. All visuals are drawn from window.HOURS (shared.js).
const H = window.HOURS, N = H.length, LIM = { g: 25, p: 60 };
const FULL = ['7 AM','8 AM','9 AM','10 AM','11 AM','12 PM','1 PM','2 PM','3 PM','4 PM','5 PM','6 PM'];
const SUNRISE_T = -0.13, SUNSET_T = 12.5; // hours after 7 AM: 6:52 AM, 7:30 PM
const SKY = [['#4f7fbf','#f2c49c'],['#3f7fc8','#c9dcee'],['#357fd0','#d3e5f5'],['#3a78bf','#c5d6e4'],['#4a6f94','#aebcc7'],
 ['#3c4753','#7e8a95'],['#3a4450','#78848f'],['#39434f','#7a8691'],['#415061','#8d99a4'],['#3d77bd','#cadced'],['#3c6fb4','#f0d3aa'],['#3f5f9f','#f3a86f']];
(function smooth(){const hx=c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)),mix=(a,b,c)=>'#'+a.map((v,i)=>Math.round((v+2*b[i]+c[i])/4).toString(16).padStart(2,'0')).join('');
 for(let p=0;p<2;p++)for(const k of[0,1]){const s=SKY.map(r=>hx(r[k]));SKY.forEach((r,i)=>r[k]=mix(s[Math.max(0,i-1)],s[i],s[Math.min(s.length-1,i+1)]))}})();
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const overIdx = H.map((h,i)=>h.ok?-1:i).filter(i=>i>=0), FIRST = overIdx[0], LAST = overIdx[overIdx.length-1];
// Compact day strip: the Brief's sky, one tile per hour, over-limit hours hatched.
function dayStrip(host, sel){
  host.innerHTML = H.map((h,i)=>`<i class="${h.ok?'':'over'} ${i===sel?'sel':''}" style="--z:${SKY[i][0]};--h:${SKY[i][1]}" title="${FULL[i]}"></i>`).join('')
   + `<span class="lbl">7 AM</span><span class="lbl r">6 PM</span>`;
  host.setAttribute('role','img');
  host.setAttribute('aria-label',`Your day, 7 AM to 6 PM. Over your limits ${FULL[FIRST]} to ${FULL[LAST]}.`);
}
document.querySelectorAll('[data-daystrip]').forEach(el=>dayStrip(el, +el.dataset.daystrip));
// Toolbar hairline once content scrolls under it.
(()=>{const tb=document.querySelector('.toolbar');if(!tb)return;const f=()=>tb.classList.toggle('scrolled',scrollY>4);addEventListener('scroll',f,{passive:true});f();})();
