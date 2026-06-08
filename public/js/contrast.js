'use strict';

/**
 * Adaptive Contrast — lightweight canvas luminance sampler.
 *
 * Samples the active hero image in three regions that correspond to
 * the UI elements floating above it:
 *   - top-left  → site name  (header h1)
 *   - top-right → nav pill
 *   - bottom-left → hero "View" CTA
 *
 * Based on the luminance found, one of three classes is applied to <header>:
 *   .ui-on-dark  — default; light/transparent styling kept as-is
 *   .ui-on-mid   — slightly darker fill + stronger border/shadow
 *   .ui-on-light — most contrast boost; for washed / near-white backgrounds
 *
 * The class is also applied to the .hero-link element directly so the
 * CTA can be styled independently if needed.
 *
 * Thresholds (perceptual luminance 0–255):
 *   < 80   → dark   (current look is already fine)
 *   80–145 → mid    (subtle contrast boost)
 *   > 145  → light  (stronger boost)
 *
 * The evaluation is deliberately debounced (400 ms after a slide becomes
 * active) so it never fires during the crossfade — avoiding any flicker.
 */

// Reusable 1×1 offscreen canvas for pixel sampling
const _canvas = document.createElement('canvas');
_canvas.width = 1;
_canvas.height = 1;
const _ctx = _canvas.getContext('2d', { willReadFrequently: true });

const DARK_THRESHOLD  = 65;   // below this → dark tier (current style is fine)
const LIGHT_THRESHOLD = 130;  // above this → light tier (strong boost needed)
                               // between    → mid tier (moderate boost)

const UI_CLASSES = ['ui-on-dark', 'ui-on-mid', 'ui-on-light'];

let _debounceTimer = null;

/**
 * Computes the average perceptual luminance (0–255) of a rectangular region
 * within an <img> element, using an offscreen canvas.
 *
 * @param {HTMLImageElement} img   - The source image (must be loaded & same-origin / CORS-ok)
 * @param {number} rx  - Region x as fraction of img naturalWidth  (0–1)
 * @param {number} ry  - Region y as fraction of img naturalHeight (0–1)
 * @param {number} rw  - Region width  as fraction (0–1)
 * @param {number} rh  - Region height as fraction (0–1)
 * @param {number} [samples=6] - Grid sample count per axis
 * @returns {number|null} Luminance 0–255, or null if image not readable
 */
function sampleRegionLuminance(img, rx, ry, rw, rh, samples = 6) {
  if (!img || !img.complete || img.naturalWidth === 0) return null;

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;

  const x0 = Math.round(rx * iw);
  const y0 = Math.round(ry * ih);
  const xEnd = Math.round((rx + rw) * iw);
  const yEnd = Math.round((ry + rh) * ih);

  let totalLum = 0;
  let count = 0;

  const stepX = Math.max(1, (xEnd - x0) / samples);
  const stepY = Math.max(1, (yEnd - y0) / samples);

  try {
    for (let sx = x0; sx < xEnd; sx += stepX) {
      for (let sy = y0; sy < yEnd; sy += stepY) {
        _ctx.clearRect(0, 0, 1, 1);
        _ctx.drawImage(img, Math.round(sx), Math.round(sy), 1, 1, 0, 0, 1, 1);
        const [r, g, b] = _ctx.getImageData(0, 0, 1, 1).data;
        // Rec. 709 perceptual luminance
        totalLum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        count++;
      }
    }
  } catch {
    // Tainted canvas (cross-origin without CORS) — fail silently
    return null;
  }

  return count > 0 ? totalLum / count : null;
}

/**
 * Classifies a luminance value into a UI contrast tier.
 * @param {number} lum
 * @returns {'dark'|'mid'|'light'}
 */
function classifyLuminance(lum) {
  if (lum >= LIGHT_THRESHOLD) return 'light';
  if (lum >= DARK_THRESHOLD)  return 'mid';
  return 'dark';
}

/**
 * Applies the appropriate ui-on-* class to the header and hero-link.
 * Transitions are handled by CSS (opacity/shadow have 400 ms easing).
 * @param {'dark'|'mid'|'light'} tier
 */
function applyTier(tier) {
  const header   = document.getElementById('site-header');
  const heroLink = document.getElementById('hero-link');

  const cls = `ui-on-${tier}`;

  [header, heroLink].forEach(el => {
    if (!el) return;
    if (!el.classList.contains(cls)) {
      el.classList.remove(...UI_CLASSES);
      el.classList.add(cls);
    }
  });
}

/**
 * Finds the currently active hero slide's <img> and samples three regions.
 * Regions approximate the visual zones occupied by:
 *   - top-left:    site name    (x: 0–25%,  y: 0–18%)
 *   - top-right:   nav pill     (x: 55–100%, y: 0–18%)
 *   - bottom-left: hero "View"  (x: 0–30%,  y: 78–100%)
 *
 * The worst-case (highest luminance) across all three regions determines
 * the overall tier applied — this way if ANY region is bright, we boost.
 */
function evaluateActiveSlide() {
  const activeSlide = document.querySelector('.hero-slide.active');
  if (!activeSlide) return;

  const img = activeSlide.querySelector('img');
  if (!img || !img.complete || img.naturalWidth === 0) {
    // Image not yet loaded — retry once it is
    img?.addEventListener('load', () => evaluateActiveSlide(), { once: true });
    return;
  }

  const lumBrand  = sampleRegionLuminance(img, 0.00, 0.00, 0.28, 0.20);
  const lumNav    = sampleRegionLuminance(img, 0.52, 0.00, 0.48, 0.20);
  const lumCta    = sampleRegionLuminance(img, 0.00, 0.76, 0.32, 0.24);

  // Pick the highest luminance region — the most demanding case
  const readings = [lumBrand, lumNav, lumCta].filter(v => v !== null);

  // CORS fallback: if all readings are null (tainted canvas / cross-origin without
  // CORS headers), default to 'mid' rather than doing nothing. This ensures the
  // UI always has at least a moderate contrast boost on any background.
  if (readings.length === 0) {
    applyTier('mid');
    return;
  }

  const maxLum = Math.max(...readings);
  const tier   = classifyLuminance(maxLum);

  applyTier(tier);
}

/**
 * Schedules a debounced evaluation.
 * The 400 ms delay lets the crossfade begin before we change classes,
 * preventing any flicker mid-transition.
 * @param {number} [delay=400]
 */
export function scheduleContrastEval(delay = 400) {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(evaluateActiveSlide, delay);
}

/**
 * Initialises the contrast system.
 * Call once from main.js after initPage().
 * Also listens for the custom 'hero:slide-changed' event dispatched by slideshow.js.
 */
export function initAdaptiveContrast() {
  // Initial evaluation (give images time to decode)
  scheduleContrastEval(600);

  // Re-evaluate whenever the slideshow advances
  document.addEventListener('hero:slide-changed', () => scheduleContrastEval(400));
}
