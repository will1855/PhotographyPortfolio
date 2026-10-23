'use strict';
import { glyphs } from './willLetters.js?v=1';

const NS = 'http://www.w3.org/2000/svg';
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
let button, logo, letters = [], frame = null, start = 0;
const smooth = t => t * t * (3 - 2 * t);
// Authored anticipation, launch, landing and recovery. The staggered letters
// have different weight; the i dot has its own extra follow-through.
const poses = [
  [0, 0, 1, 0], [.12, 17, .76, -3], [.27, -120, 1.025, 4],
  [.46, -72, 1.025, 2], [.65, 10, .78, -3], [.82, 0, 1.035, 1],
  [1.05, 1, .99, -.5], [1.22, 0, 1, 0],
];
function pose(t) {
  if(t <= 0 || t >= 1.22) return [0,1,0];
  let i=1; while(poses[i][0]<t)i++;
  const a=poses[i-1],b=poses[i],u=smooth((t-a[0])/(b[0]-a[0]));
  return [1,2,3].map(k=>a[k]+(b[k]-a[k])*u);
}
function outline(points) {
  let d=`M${points[0].join(',')}`;
  for(let i=0;i<points.length;i++) {
    const a=points[(i+points.length-1)%points.length],b=points[i];
    const c=points[(i+1)%points.length],e=points[(i+2)%points.length];
    d+=`C${b[0]+(c[0]-a[0])/6},${b[1]+(c[1]-a[1])/6} ${c[0]-(e[0]-b[0])/6},${c[1]-(e[1]-b[1])/6} ${c.join(',')}`;
  }
  return d+'Z';
}
function render(age=0) {
  letters.forEach(({glyph, paths, cx, base},i)=>{
    // Centre-led, overlapping motion: a shared impulse with individual weight.
    const time=(age-[.024,0,.008,.032][i])/[1.01,1,1,1.005][i];
    const [jump,sy,bend]=pose(time);
    const sx=1/Math.sqrt(sy); // preserve apparent volume through compression
    paths.forEach((path,j)=>{
      const part=glyph.parts[j],dot=glyph.name==='i'&&j===1;
      const [dotJump]=pose(time-.075);
      const points=part.points.map(([x,y])=>{
        const height=(base-y)/480;
        // A small elastic lag preserves individual letter weight without a
        // travelling wave. The dominant motion is a single vertical jump.
        const lag=pose(time-height*.025),localSy=sy+(lag[1]-sy)*height*.3;
        return [cx+(x-cx)*sx+bend*[.78,1,.96,1.12][i]*height*height,
          base+(y-base)*localSy+jump*(.92+i*.04)+(dot?(dotJump-jump)*.5:0)];
      });
      path.setAttribute('d',outline(points));
    });
  });
}
export function initLiquidLogo() {
  if(button)return;
  button=document.querySelector('#site-title button');
  const image=button?.querySelector('img.site-logo');
  if(!button||!image)return;
  logo=document.createElementNS(NS,'svg');
  logo.setAttribute('viewBox','0 0 1099 640');
  logo.setAttribute('width','1099');logo.setAttribute('height','640');
  logo.setAttribute('role','img');logo.setAttribute('aria-label',image.alt);
  logo.classList.add('site-logo','jelly-lettering');
  letters=glyphs.map(glyph=>{
    const group=document.createElementNS(NS,'g');
    group.dataset.letter=glyph.name;
    const paths=glyph.parts.map((part,j)=>{
      const path=document.createElementNS(NS,'path');
      path.dataset.part=glyph.name==='i'&&j===1?'dot':'body';group.appendChild(path);return path;
    });
    logo.appendChild(group);
    const pts=glyph.parts.flatMap(p=>p.points);
    return {glyph,paths,cx:(Math.min(...pts.map(p=>p[0]))+Math.max(...pts.map(p=>p[0])))/2,base:Math.max(...pts.map(p=>p[1]))};
  });
  render();image.replaceWith(logo);
  button.addEventListener('click',()=>{
    stopLiquidLogo();if(motion.matches)return;
    button.classList.add('liquid-playing');start=performance.now();frame=requestAnimationFrame(tick);
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopLiquidLogo()});
  motion.addEventListener('change',stopLiquidLogo);
}
function tick(now) {
  const age=(now-start)/1000;
  if(age>=1.5){stopLiquidLogo();return}
  render(age);frame=requestAnimationFrame(tick);
}
export function stopLiquidLogo() {
  if(frame!==null)cancelAnimationFrame(frame);frame=null;
  button?.classList.remove('liquid-playing');if(letters.length)render();
}
