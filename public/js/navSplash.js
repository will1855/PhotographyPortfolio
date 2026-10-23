const clamp = n => Math.max(0, Math.min(1, n));

// Rounded droplets released at destination contact. All variation is chosen at release; nothing jitters between frames.
export class NavSplash {
  drops = [];
  impact = { x: 0, y: 0 };
  constructor(random = Math.random) { this.random = random; }
  get active() { return this.drops.length > 0; }
  clear() { this.drops = []; }
  start({ distance, spacing, speed, x, y, direction }) {
    const rand = this.random;
    this.impact = { x, y };
    const energy = clamp((distance / spacing - .65) / 2.35)
      * (.6 + .4 * clamp(speed / 450));
    this.clear();
    if (energy < .075) return;
    const count = energy < .28 ? 1 : energy < .65 ? 2 : 2 + Math.floor(rand() * 2);
    this.drops = Array.from({ length: count }, (_, i) => {
      // Choose irregular directions at impact, mostly lateral, without an
      // upward preference or a fixed radial formation. Emit from that edge.
      const lateral=rand()<.65;
      const angle=lateral ? (rand()<.5?0:Math.PI)+(rand()-.5)*1.0 : rand()*Math.PI*2;
      const launch=(32+rand()*28)*(.45+energy*.55);
      const edge=9+rand()*2;
      return {
        x: x + Math.cos(angle)*edge,
        y: y + Math.sin(angle)*edge,
        vx: Math.cos(angle)*launch+direction*7*energy,
        vy: Math.sin(angle)*launch,
        r: 1.2 + energy * (1.65 + rand() * 1.1),
        age: -(i * .02 + rand() * .03),
        life: .32 + rand() * .1,
        phase: rand() * Math.PI * 2,
      };
    });
  }
  step(dt) {
    // Impact is fixed in nav space. The particles never chase the travelling
    // active blob, including during a rapid subsequent selection.

    const steps = Math.max(1, Math.ceil(dt * 120));
    for (let i = 0; i < steps; i++) {
      const h = dt / steps;
      for (const drop of this.drops) {
        drop.age += h;
        if (drop.age < 0) continue;
        // Outward flight with mild gravity and air resistance, never attraction.
        drop.vx -= drop.vx * 1.5 * h;
        drop.vy += (65 - drop.vy * 1.5) * h;
        drop.x += drop.vx * h; drop.y += drop.vy * h;
      }
      this.drops = this.drops.filter(drop => drop.age < drop.life);
    }
  }
  shapes() {
    return this.drops.filter(drop => drop.age >= 0).map(drop => {
      const progress=drop.age/drop.life;
      // Hold a solid bead briefly, then contract continuously to a point.
      // Keep its colour throughout: surface tension, rather than dissolution.
      const contraction=clamp((progress-.12)/.88);
      const radius=drop.r*(1-contraction*contraction*(3-2*contraction));
      const opacity=1;
      const squash=1+Math.sin(drop.age*12+drop.phase)*.075*Math.exp(-drop.age*4);
      const points=Array.from({length:12},(_,i)=>{
        const a=i*Math.PI/6;
        const r=radius*(1+.035*Math.sin(a*3+drop.phase));
        return [drop.x+Math.cos(a)*r*squash,drop.y+Math.sin(a)*r/squash];
      });
      const point=p=>p.map(v=>v.toFixed(2)).join(',');
      let d='M'+point(points[0]);
      for(let i=0;i<12;i++){
        const a=points[(i+11)%12],b=points[i],c=points[(i+1)%12],e=points[(i+2)%12];
        d+='C'+point([b[0]+(c[0]-a[0])/6,b[1]+(c[1]-a[1])/6])+' '
          +point([c[0]-(e[0]-b[0])/6,c[1]-(e[1]-b[1])/6])+' '+point(c);
      }
      return {d:d+'Z',opacity};
    });
  }
  path() { return this.shapes().map(shape=>shape.d).join(''); }
}
