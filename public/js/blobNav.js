'use strict';

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
let nav, svg, pathEl;
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
let raf = null;

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
const KP = 0.5522847498;

/** Slightly irregular circle for resting blob. */
function circD(cx, cy, r) {
  const a = KP * 1.014, b = KP * 0.990, c = KP * 1.008, d = KP * 0.988;
  return `M${cx},${cy-r}`
    + ` C${cx+r*a},${cy-r} ${cx+r},${cy-r*b} ${cx+r},${cy}`
    + ` C${cx+r},${cy+r*c} ${cx+r*d},${cy+r} ${cx},${cy+r}`
    + ` C${cx-r*a},${cy+r} ${cx-r},${cy+r*b} ${cx-r},${cy}`
    + ` C${cx-r},${cy-r*c} ${cx-r*d},${cy-r} ${cx},${cy-r}Z`;
}

/**
 * Two-lobe blob connected by an organic neck.
 * The neck narrows proportionally to the span between lobes.
 */
function blobD(ax, bx, cy, ar, br) {
  let lx, rx, lr, rr;
  if (ax <= bx) { lx = ax; rx = bx; lr = ar; rr = br; }
  else           { lx = bx; rx = ax; lr = br; rr = ar; }

  const span = rx - lx;
  if (span < 0.5) return circD((lx + rx) / 2, cy, (lr + rr) / 2);

  const maxR = Math.max(lr, rr);
  const nk   = Math.max(1.5, maxR * Math.max(0.10, 1 - span / (maxR * 5)));

  const mid = (lx + rx) / 2;
  const cp  = (span / 2) * 0.38;

  return `M${lx},${cy-lr}`
    + ` C${lx+cp},${cy-lr} ${mid-cp},${cy-nk} ${mid},${cy-nk}`
    + ` C${mid+cp},${cy-nk} ${rx-cp},${cy-rr} ${rx},${cy-rr}`
    + ` C${rx+rr*KP},${cy-rr} ${rx+rr},${cy-rr*KP} ${rx+rr},${cy}`
    + ` C${rx+rr},${cy+rr*KP} ${rx+rr*KP},${cy+rr} ${rx},${cy+rr}`
    + ` C${rx-cp},${cy+rr} ${mid+cp},${cy+nk} ${mid},${cy+nk}`
    + ` C${mid-cp},${cy+nk} ${lx+cp},${cy+lr} ${lx},${cy+lr}`
    + ` C${lx-lr*KP},${cy+lr} ${lx-lr},${cy+lr*KP} ${lx-lr},${cy}`
    + ` C${lx-lr},${cy-lr*KP} ${lx-lr*KP},${cy-lr} ${lx},${cy-lr}Z`;
}

/** Derive lobe radii from spring velocities (velocity-dependent squash). */
function geom() {
  const vel = Math.abs(tip.vel) + Math.abs(anchor.vel);
  const sq  = Math.min(vel * 0.00025, 0.12);
  return {
    tr: ACTIVE_R * (1 - sq * 0.5),
    ar: ACTIVE_R * (1 + sq * 0.12),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export function initBlobNav(onNavigate) {
  _onNav = onNavigate;
  nav = document.getElementById('site-nav');
  if (!nav) return;

  links = Array.from(nav.querySelectorAll('a.blob-link'));
  if (!links.length) return;

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
  nav.appendChild(svg);

  reflow();

  const cx = ctr[active]?.x ?? 0;
  tip    = new Spring(cx, SP_TIP.k,    SP_TIP.d);
  anchor = new Spring(cx, SP_ANCHOR.k, SP_ANCHOR.d);

  bindPointer();
  bindKeys();
  bindHover();

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
  pathEl.setAttribute('d', blobD(anchor.v, tip.v, cy0, ar, tr));
  dots.forEach((c, i) => { c.style.opacity = i === active ? '0' : '1'; });
}

// ── Animation loop ─────────────────────────────────────────────────────────
function go() { if (!raf) raf = requestAnimationFrame(tick); }

function tick() {
  const dt = 1 / 60;

  if (!dragging) { tip.step(dt); anchor.step(dt); }
  else           { anchor.step(dt); }

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

  if (mIn && !dragging) proximity();
  render();

  const settled = tip.ok() && anchor.ok() && !dragging;
  if (settled && !mIn) { tActive = false; raf = null; }
  else                 { raf = requestAnimationFrame(tick); }
}

// ── Pointer events ─────────────────────────────────────────────────────────
function bindPointer() {
  // Capture-phase click handler: prevent default link behaviour
  nav.addEventListener('click', e => {
    if (e.target.closest('a.blob-link')) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  nav.addEventListener('pointerdown', e => {
    if (!e.isPrimary) return;
    const a = e.target.closest('a.blob-link');
    if (!a) return;
    const idx = +a.dataset.navIndex;
    if (isNaN(idx)) return;
    e.preventDefault();
    nav.setPointerCapture?.(e.pointerId);
    dragPtrId = e.pointerId;

    if (idx === active) {
      dragging = true;
      dragOrigin = ctr[active].x;
      const nr = nav.getBoundingClientRect();
      tip.v = e.clientX - nr.left; tip.vel = 0;
      anchor.t = dragOrigin;
      anchor.k = SP_ANCHOR.k; anchor.d = SP_ANCHOR.d;
      go();
    } else {
      navTo(idx);
    }
  });

  nav.addEventListener('pointermove', e => {
    if (!dragging || e.pointerId !== dragPtrId) return;
    const nr = nav.getBoundingClientRect();
    const minX = (ctr[0]?.x ?? 0) - 30;
    const maxX = (ctr[ctr.length - 1]?.x ?? 100) + 30;
    let lx = Math.max(minX, Math.min(maxX, e.clientX - nr.left));

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
      navTo(best);
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
  setTimeout(() => {
    anchor.k = SP_ANCHOR.k; anchor.d = SP_ANCHOR.d; anchor.t = tx;
  }, 65);
  go();
}

function navTo(idx) {
  if (idx === active && !tActive) return;
  if (idx < 0 || idx >= links.length) return;

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
  nav.addEventListener('pointerenter', () => { mIn = true; go(); }, { passive: true });
  nav.addEventListener('pointerleave', () => {
    mIn = false;
    dots.forEach((c, i) => {
      const p = ctr[i]; const q = Q[i] || { dr: 0, dy: 0 };
      c.setAttribute('cx', p.x);
      c.setAttribute('cy', p.y + q.dy);
      c.setAttribute('r',  DOT_R + q.dr);
    });
  }, { passive: true });
  nav.addEventListener('pointermove', e => {
    if (dragging) return;
    const nr = nav.getBoundingClientRect();
    mx = e.clientX - nr.left; my = e.clientY - nr.top;
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
