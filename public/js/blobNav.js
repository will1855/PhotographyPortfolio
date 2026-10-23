'use strict';
import { liquidSurface } from './liquidSurface.js?v=1';
import { NavSplash } from './navSplash.js?v=5';

/**
 * Organic Blob Navigation
 *
 * Renders four small dots beneath the "will" logo. The active page is shown
 * as a larger blob that stretches, bridges, and reforms between positions
 * using spring physics — like a soft biological membrane.
 */

// ── Config ─────────────────────────────────────────────────────────────────
const COLOR    = '#EF3E23';
const ACTIVE_R = 13;          // resting blob radius  (~26 px diameter)
const DOT_R    = 6;           // base inactive radius (~12 px diameter)
const SNAP_PX  = 40;          // drag-release snap threshold
const NAV_FIRE = 0.42;        // fraction of travel to trigger page nav

// Deterministic per-dot quirks (almost subconscious irregularity)
const Q = [
  { dr:  0.5, dy: -0.7 },    // Home
  { dr: -0.6, dy:  0.5 },    // My Work
  { dr:  0.3, dy: -0.4 },    // Archive
  { dr: -0.4, dy:  0.7 },    // About
];

// Spring presets
const SP_TIP    = { k: 220, d: 18 };
const SP_ANCHOR = { k: 140, d: 15 };
const SP_SNAP   = { k: 300, d: 22 };

// ── State ──────────────────────────────────────────────────────────────────
let nav, svg, pathEl, splashPath;
let dots   = [];              // SVG <circle> per dot
let links  = [];              // <a.blob-link> elements
let ctr    = [];              // {x,y} centres in nav-local px
let cy0    = 0;               // shared vertical centre

let active = 0;
let tip, anchor;              // Spring instances (horizontal)

let _onNav = null;            // navigate callback
let _init  = false;

// Drag
let dragging = false, dragOrigin = 0, dragPtrId = -1;

// Transition
let tActive = false, tDone = false, tLink = null, tOriginX = 0;

// Hover
let mIn = false, mx = 0, my = 0;

// Animation
let raf = null, lastTime = 0, anchorDelay = 0, delayedTarget = 0;
const splash = new NavSplash();
let splashIntent = null;

const prefRM = window.matchMedia('(prefers-reduced-motion: reduce)');

// ── Spring ─────────────────────────────────────────────────────────────────
class Spring {
  constructor(v, k, d) { this.v = v; this.t = v; this.vel = 0; this.k = k; this.d = d; }
  set(v) { this.v = v; this.t = v; this.vel = 0; }
  step(dt) {
    const f = (this.t - this.v) * this.k - this.vel * this.d;
    this.vel += f * dt;
    this.v   += this.vel * dt;
  }
  ok(e = 0.4) { return Math.abs(this.v - this.t) < e && Math.abs(this.vel) < e; }
}

// ── SVG path generation ────────────────────────────────────────────────────
/** Derive lobe radii from spring velocities (velocity-dependent squash). */
function geom() {
  const vel = Math.abs(tip.vel) + Math.abs(anchor.vel);
  const sq  = Math.min(vel * 0.00025, 0.12);
  const stretch = Math.min(Math.abs(tip.v - anchor.v) / (ACTIVE_R * 2), 1);
  const tail = 1 - stretch * .62;
  return {
    // Transfer volume into the leading lobe as the sticky tail thins.
    tr: ACTIVE_R * Math.sqrt(1 - tail * tail * stretch) * (1 - sq * .5),
    ar: ACTIVE_R * tail,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export function initBlobNav(onNavigate) {
  _onNav = onNavigate;
  nav = document.getElementById('site-nav');
  if (!nav) return;

  links = Array.from(nav.querySelectorAll('a.blob-link'));
  if (!links.length) return;
  links.forEach(link => { link.draggable = false; });

  if (_init) { reflow(); return; }
  _init = true;

  svg = ns('svg');
  svg.classList.add('blob-svg');
  svg.setAttribute('aria-hidden', 'true');

  links.forEach(() => {
    const c = ns('circle');
    c.setAttribute('fill', COLOR);
    c.classList.add('blob-dot');
    svg.appendChild(c);
    dots.push(c);
  });

  pathEl = ns('path');
  pathEl.setAttribute('fill', COLOR);
  pathEl.classList.add('blob-active');
  svg.appendChild(pathEl);
  splashPath = ns('g'); splashPath.setAttribute('fill', COLOR);
  splashPath.classList.add('blob-splash'); svg.appendChild(splashPath);
  nav.appendChild(svg);

  active = Math.max(0, links.findIndex(l => l.getAttribute('aria-current') === 'page'));
  reflow();

  const cx = ctr[active]?.x ?? 0;
  tip    = new Spring(cx, SP_TIP.k,    SP_TIP.d);
  anchor = new Spring(cx, SP_ANCHOR.k, SP_ANCHOR.d);

  bindPointer();
  bindKeys();
  bindHover();
  render();
  nav.dataset.blobReady = 'true';
  prefRM.addEventListener('change', () => {
    if (!prefRM.matches) return;
    dragging = false; anchorDelay = 0; splash.clear(); splashIntent = null;
    tip.set(ctr[active]?.x ?? 0); anchor.set(tip.v);
    if (tActive && !tDone && tLink) { tDone = true; _onNav?.(tLink); }
    tActive = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null; lastTime = 0; render();
  });

  window.addEventListener('resize', () => {
    reflow();
    if (!dragging && !tActive) {
      const cx = ctr[active]?.x ?? 0;
      tip.set(cx); anchor.set(cx); render();
    }
  });
}

export function updateBlobNavActive(idx, immediate = false) {
  if (idx < 0 || !links.length || idx >= links.length) return;
  if (immediate) {
    active = idx;
    anchorDelay = 0;
    const cx = ctr[idx]?.x ?? 0;
    tip?.set(cx); anchor?.set(cx); render();
    return;
  }
  if (idx === active) return;
  animateTo(idx);
}

export function refreshBlobPositions() {
  reflow();
  if (!dragging && !tActive) {
    const cx = ctr[active]?.x ?? 0;
    tip?.set(cx); anchor?.set(cx); render();
  }
}

// ── Layout ─────────────────────────────────────────────────────────────────
function reflow() {
  if (!nav || !links.length) return;
  const nr = nav.getBoundingClientRect();
  ctr = links.map(l => {
    const r = l.getBoundingClientRect();
    return { x: r.left + r.width / 2 - nr.left, y: r.top + r.height / 2 - nr.top };
  });
  cy0 = ctr[0]?.y ?? 18;

  dots.forEach((c, i) => {
    const p = ctr[i]; if (!p) return;
    const q = Q[i] || { dr: 0, dy: 0 };
    c.setAttribute('cx', p.x);
    c.setAttribute('cy', p.y + q.dy);
    c.setAttribute('r',  DOT_R + q.dr);
  });
}

function ns(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  if (!pathEl || !tip) return;
  const { tr, ar } = geom();
  const lobes = dots.map(c => ({ x: +c.getAttribute('cx'), y: +c.getAttribute('cy'), r: +c.getAttribute('r') }));
  lobes.push({ x: anchor.v, y: cy0, r: ar }, { x: tip.v, y: cy0, r: tr });
  pathEl.setAttribute('d', liquidSurface(lobes, Math.min((Math.abs(tip.vel)+Math.abs(anchor.vel))*.002, .8)));
  dots.forEach(c => { c.style.opacity = '0'; });
  const shapes=splash.shapes();
  while(splashPath.children.length>shapes.length)splashPath.lastElementChild.remove();
  shapes.forEach((shape,i)=>{
    let path=splashPath.children[i];
    if(!path){path=ns('path');splashPath.appendChild(path)}
    path.setAttribute('d',shape.d);path.setAttribute('opacity',shape.opacity.toFixed(3));
  });
  links.forEach((link, i) => {
    if (i === active && !link.hasAttribute('aria-current')) link.setAttribute('aria-current', 'page');
    else if (i !== active && link.hasAttribute('aria-current')) link.removeAttribute('aria-current');
  });
}

// ── Animation loop ─────────────────────────────────────────────────────────
function go() { if (!raf) { lastTime = 0; raf = requestAnimationFrame(tick); } }

function tick(now) {
  const dt = lastTime ? Math.min((now - lastTime) / 1000, .1) : 1 / 60;
  lastTime = now;
  if (anchorDelay) {
    anchorDelay = Math.max(0, anchorDelay - dt);
    if (!anchorDelay) anchor.t = delayedTarget;
  }

  const steps=Math.max(1,Math.ceil(dt*120));
  for(let i=0;i<steps;i++){if(!dragging)tip.step(dt/steps);anchor.step(dt/steps)}
  splash.step(dt);
  if (splashIntent) {
    const destination=ctr[active]?.x;
    // Emit at first contact with the destination, independently of the earlier
    // page-routing callback. Drag transitions never create an impact intent.
    if (destination != null && Math.abs(destination-tip.v) <= ACTIVE_R*.8+DOT_R*.5) {
      splash.start({ ...splashIntent, speed: Math.abs(tip.vel),
        x: destination, y: cy0 });
      splashIntent=null;
    }
  }

  // Fire page nav mid-animation
  if (tActive && !tDone && tLink) {
    const destX = ctr[active]?.x;
    if (destX != null) {
      const total = Math.abs(destX - tOriginX) || 1;
      const prog  = Math.min(Math.abs(tip.v - tOriginX) / total, 1);
      if (prog >= NAV_FIRE || total < 5) {
        tDone = true;
        _onNav?.(tLink);
      }
    }
  }

  render();

  const settled = tip.ok() && anchor.ok() && !dragging;
  if (settled && !anchorDelay && !splash.active) { tActive = false; raf = null; lastTime = 0; }
  else                 { raf = requestAnimationFrame(tick); }
}

// ── Pointer events ─────────────────────────────────────────────────────────
function bindPointer() {
  // Click activation also covers keyboard/assistive-technology generated clicks.
  nav.addEventListener('click', e => {
    const a = e.target.closest('a.blob-link');
    if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (nav.dataset.dragClick === 'true') { delete nav.dataset.dragClick; return; }
    navTo(+a.dataset.navIndex);
  }, true);

  nav.addEventListener('pointerdown', e => {
    delete nav.dataset.dragClick;
    if (!e.isPrimary || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || prefRM.matches) return;
    const a = e.target.closest('a.blob-link');
    if (!a || +a.dataset.navIndex !== active) return;
    splashIntent = null; splash.clear();
    dragging = true; dragPtrId = e.pointerId;
    dragOrigin = ctr[active].x; anchorDelay = 0;
    tip.set(dragOrigin); anchor.t = dragOrigin;
    nav.setPointerCapture?.(e.pointerId);
  });

  nav.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== dragPtrId) return;
    const header = nav.closest('header');
    if (header && (header.classList.contains('hidden-header') || getComputedStyle(header).visibility === 'hidden')) {
      dragging = false; dragPtrId = -1;
      const cx = ctr[active]?.x ?? 0;
      tip.t = cx; anchor.t = cx; go();
      return;
    }
    const nr = nav.getBoundingClientRect();
    const minX = (ctr[0]?.x ?? 0) - 30;
    const maxX = (ctr[ctr.length - 1]?.x ?? 100) + 30;
    let lx = Math.max(minX, Math.min(maxX, e.clientX - nr.left));

    if (Math.abs(lx - dragOrigin) > 5) nav.dataset.dragClick = 'true';
    tip.v = lx; tip.vel = 0;
    anchor.t = dragOrigin + (lx - dragOrigin) * 0.12;

    // Magnetic pull near dots
    for (let i = 0; i < ctr.length; i++) {
      if (i === active) continue;
      const d = Math.abs(lx - ctr[i].x);
      if (d < SNAP_PX) {
        tip.v += (ctr[i].x - lx) * (1 - d / SNAP_PX) * 0.2;
        break;
      }
    }
    go();
  });

  nav.addEventListener('pointerup', e => {
    if (!dragging || e.pointerId !== dragPtrId) return;
    dragging = false; dragPtrId = -1;
    nav.releasePointerCapture?.(e.pointerId);

    const lx = tip.v;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < ctr.length; i++) {
      const d = Math.abs(lx - ctr[i].x);
      if (d < bestD) { bestD = d; best = i; }
    }

    if (best >= 0 && bestD < SNAP_PX && best !== active) {
      navTo(best, 'drag');
    } else {
      // Spring back
      const cx = ctr[active].x;
      tip.k = SP_SNAP.k; tip.d = SP_SNAP.d; tip.t = cx;
      anchor.k = SP_SNAP.k; anchor.d = SP_SNAP.d; anchor.t = cx;
      go();
    }
  });

  nav.addEventListener('pointercancel', () => {
    if (!dragging) return;
    dragging = false; dragPtrId = -1;
    const cx = ctr[active].x;
    tip.t = cx; anchor.t = cx; go();
  });
}

// ── Navigate ───────────────────────────────────────────────────────────────
function animateTo(idx) {
  const tx = ctr[idx]?.x; if (tx == null) return;
  active = idx;

  if (prefRM.matches) { tip.set(tx); anchor.set(tx); render(); return; }

  tip.k = SP_TIP.k; tip.d = SP_TIP.d; tip.t = tx;
  anchor.k = SP_ANCHOR.k; anchor.d = SP_ANCHOR.d;
  delayedTarget = tx; anchorDelay = .065;
  go();
}

function navTo(idx, source = 'click') {
  if (idx === active && !tActive) return;
  if (idx < 0 || idx >= links.length) return;

  splash.clear(); splashIntent = null;
  if (source === 'click' && !prefRM.matches) {
    const destination=ctr[idx]?.x ?? tip.v;
    splashIntent = {
      distance: Math.abs(destination-tip.v),
      spacing: Math.abs((ctr[1]?.x ?? 44)-(ctr[0]?.x ?? 0)) || 44,
      direction: Math.sign(destination-tip.v) || 1,
    };
  }
  if (prefRM.matches) {
    active = idx;
    const tx = ctr[idx]?.x ?? 0;
    tip.set(tx); anchor.set(tx); render();
    _onNav?.(links[idx]);
    return;
  }

  tOriginX = tip.v;
  tLink    = links[idx];
  tActive  = true;
  tDone    = false;
  animateTo(idx);
}

// ── Hover proximity ────────────────────────────────────────────────────────
function bindHover() {
  nav.addEventListener('pointerenter', () => { mIn = true; }, { passive: true });
  nav.addEventListener('pointerleave', () => {
    mIn = false;
    dots.forEach((c, i) => {
      const p = ctr[i]; const q = Q[i] || { dr: 0, dy: 0 };
      c.setAttribute('cx', p.x);
      c.setAttribute('cy', p.y + q.dy);
      c.setAttribute('r',  DOT_R + q.dr);
    });
    render();
  }, { passive: true });
  nav.addEventListener('pointermove', e => {
    if (dragging || prefRM.matches) return;
    const nr = nav.getBoundingClientRect();
    mx = e.clientX - nr.left; my = e.clientY - nr.top;
    proximity(); render();
  }, { passive: true });
}

function proximity() {
  const R = 55;
  dots.forEach((c, i) => {
    if (i === active) return;
    const p = ctr[i]; const q = Q[i] || { dr: 0, dy: 0 };
    const bx = p.x, by = p.y + q.dy, br = DOT_R + q.dr;
    const dx = mx - bx, dy = my - by, dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > R) {
      c.setAttribute('cx', bx); c.setAttribute('cy', by); c.setAttribute('r', br);
      return;
    }
    const t = 1 - dist / R;
    c.setAttribute('r', (br * (1 + t * 0.3)).toFixed(2));
    const pull = t * 1.5;
    const nx = dist > 0 ? dx / dist : 0, ny = dist > 0 ? dy / dist : 0;
    c.setAttribute('cx', (bx + nx * pull).toFixed(2));
    c.setAttribute('cy', (by + ny * pull).toFixed(2));
  });
}

// ── Keyboard ───────────────────────────────────────────────────────────────
function bindKeys() {
  links.forEach((link, i) => {
    link.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault(); links[(i + 1) % links.length].focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault(); links[(i - 1 + links.length) % links.length].focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); navTo(i);
      }
    });
  });
}
