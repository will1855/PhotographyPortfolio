'use strict';
// ─── DOM refs ──────────────────────────────────────────────────────────────────
let gallery        = document.getElementById('gallery');
const lightbox     = document.getElementById('lightbox');
const lightboxImg  = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');
let heroMedia      = document.getElementById('hero-media');
let heroKicker     = document.getElementById('hero-kicker');
let heroLink       = document.getElementById('hero-link');
const header       = document.getElementById('site-header');
const siteNav      = document.getElementById('site-nav');
const siteTitle    = document.getElementById('site-title');

// ─── Global State ──────────────────────────────────────────────────────────────
let heroIsVisible = true;
let heroObserver = null;

// ─── State ─────────────────────────────────────────────────────────────────────
const params  = new URLSearchParams(window.location.search);
let section   = params.get('section') || 'archive';
let images    = [];   // array of image objects from API
let currentIndex = 0;
let startX    = 0;
let heroSlides = [];
let heroIndex = 0;
let heroTimer = null;

// ─── Preload flash prevention ──────────────────────────────────────────────────
window.addEventListener('load', () => document.body.classList.remove('preload'));

// ─── Reveal animation cleanup ─────────────────────────────────────────────────
// After the intro animation ends, pin opacity to 1 via inline style and drop
// the 'reveal' class. This prevents browsers from discarding the animation
// forwards-fill during scroll-triggered style recalculations, which would cause
// a flash-to-black followed by the opacity transition fading back in.
document.addEventListener('animationend', (e) => {
  const el = e.target;
  if (el.classList.contains('reveal') && e.animationName === 'revealIn') {
    console.log('[reveal] animationend fired on', el.tagName, el.className, '— pinning opacity and removing class');
    el.style.opacity = '1';
    el.style.transform = 'none';
    el.classList.remove('reveal');
  }
}, { capture: true });

// ─── Bootstrap: load config then images ────────────────────────────────────────
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

let siteConfigCache = null;

async function initPage() {
  // Try to load or use cached config
  try {
    if (!siteConfigCache) {
      const configRes = await fetch('/api/site-config');
      siteConfigCache = await configRes.json();
    }
    applyConfig(siteConfigCache);
  } catch (err) {
    console.warn('[config] Failed to load site config, using defaults', err);
    applyFallbackNav();
  }

  const isAbout = window.location.pathname.includes('/about');

  if (isAbout) {
    if (siteConfigCache) loadAbout(siteConfigCache);
  } else {
    if (gallery) {
      try {
        const imgRes = await fetch(`/api/images?section=${encodeURIComponent(section)}`);
        const data   = await imgRes.json();
        if (Array.isArray(data) && data.length > 0) {
          images = data;
          renderGallery();
        } else {
          gallery.innerHTML = '<p style="padding:40px 22px;color:rgba(240,240,237,0.4);font-size:0.9rem;">No images yet.</p>';
        }
      } catch (err) {
        console.error('[images] Failed to load images', err);
        gallery.innerHTML = '<p style="padding:40px 22px;color:rgba(240,240,237,0.4);font-size:0.9rem;">Could not load images.</p>';
      }
    }
  }
}

// ─── Apply site config to DOM ──────────────────────────────────────────────────
function applyConfig(config) {
  // Site title
  const title = config.site_title || 'Will Davies';
  document.title = title;
  if (siteTitle && siteTitle.querySelector('a')) {
    siteTitle.querySelector('a').textContent = title;
  }

  // Build nav from DB sections
  const sections = config.sections || [];
  if (siteNav) siteNav.innerHTML = '';

  const isAboutPage = window.location.pathname.includes('/about');

  for (const s of sections) {
    const a = document.createElement('a');
    a.href = `/?section=${encodeURIComponent(s.slug)}`;
    a.textContent = s.nav_label || s.label;
    // Only highlight section if we are NOT on the about page
    if (!isAboutPage && s.slug === section) {
      a.classList.add('active');
    }
    if (siteNav) siteNav.appendChild(a);
  }

  // About link (always show if About page exists)
  const aboutLink = document.createElement('a');
  aboutLink.href = '/about';
  aboutLink.textContent = config.about_title || 'About';
  if (isAboutPage) {
    aboutLink.classList.add('active');
  }
  if (siteNav) siteNav.appendChild(aboutLink);

  // Hero — find config for this section
  const sectionConfig = sections.find(s => s.slug === section);
  if (sectionConfig && !isAboutPage) {
    if (heroKicker) {
      heroKicker.textContent = sectionConfig.hero_kicker || sectionConfig.label || '';
    }
    if (heroLink) {
      heroLink.textContent   = sectionConfig.hero_link_text || 'View';
    }
    
    if (sectionConfig.heroes && sectionConfig.heroes.length > 0) {
      initHeroSlideshow(sectionConfig.heroes);
    }
  }
}

function initHeroSlideshow(heroes) {
  if (!heroMedia) return;
  heroMedia.innerHTML = '';
  heroSlides = [];
  heroIndex = heroes.length > 0 ? Math.floor(Math.random() * heroes.length) : 0;

  heroes.forEach((h, i) => {
    const div = document.createElement('div');
    div.className = 'hero-slide';
    const img = document.createElement('img');
    img.src = h.full_url;
    img.alt = 'Hero image';
    if (h.focal_point && h.focal_point !== 'center') {
      img.style.setProperty('--mobile-focal-point', h.focal_point);
    }
    div.appendChild(img);
    heroMedia.appendChild(div);
    heroSlides.push(div);
  });

  // Fade in first random slide after a tiny delay to ensure transition triggers
  setTimeout(() => {
    if (heroSlides[heroIndex]) heroSlides[heroIndex].classList.add('active');
  }, 50);

  if (heroSlides.length > 1) {
    if (heroTimer) clearInterval(heroTimer);
    heroTimer = setInterval(() => {
      if (heroIsVisible) nextHeroSlide();
    }, 5000);
  }

  const heroSection = document.querySelector('.hero');
  if (heroSection) {
    if (heroObserver) heroObserver.disconnect();
    heroObserver = new IntersectionObserver((entries) => {
      // Pause slideshow if hero is not almost fully in view
      // This stops any crossfading while the user is scrolled down to the gallery
      heroIsVisible = entries[0].isIntersecting && entries[0].intersectionRatio > 0.95;
    }, { threshold: [0.95] });
    heroObserver.observe(heroSection);
  }
}

function nextHeroSlide() {
  if (heroSlides.length < 2) return;
  heroSlides[heroIndex].classList.remove('active');
  heroIndex = (heroIndex + 1) % heroSlides.length;
  heroSlides[heroIndex].classList.add('active');
}

function applyFallbackNav() {
  const isAboutPage = window.location.pathname.includes('/about');
  // Show basic Archive / Studies links if API fails
  if (siteNav) {
    siteNav.innerHTML = `
      <a href="/?section=archive"${!isAboutPage && section === 'archive' ? ' class="active"' : ''}>Archive</a>
      <a href="/?section=studies"${!isAboutPage && section === 'studies' ? ' class="active"' : ''}>Studies</a>
      <a href="/about"${isAboutPage ? ' class="active"' : ''}>About</a>
    `;
  }
}

// ─── Gallery rendering ─────────────────────────────────────────────────────────

const ROW_UNIT = 10; // px — grid-auto-rows value; must match CSS

function getNumCols() {
  const w = window.innerWidth;
  if (w > 1000) return 4;
  if (w > 700)  return 3;
  return 2;
}

/**
 * Compute and stamp explicit grid-column / grid-row on every gallery image.
 * Uses exact aspect-ratio floats for logical placement to ensure sequence is 
 * 100% identical across all screen sizes (admin vs public), and px for actual 
 * rendering to avoid any image cropping. Dense packing fills holes left by wide images.
 */
function layoutGallery() {
  if (!gallery) return; // Guard: not on a page with a gallery (e.g. About)
  const numCols = getNumCols();
  // Ensure we never have a 0 colWidth during transitions
  const containerWidth = gallery.offsetWidth > 0 ? gallery.offsetWidth : window.innerWidth;
  const colWidth = containerWidth / numCols;
  
  const logHeights = new Array(numCols).fill(0);
  const logGaps = []; 
  
  const pxHeights = new Array(numCols).fill(0);
  const pxGaps = []; 
  
  const lastItemInCol = new Array(numCols).fill(null);

  gallery.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`;

  const imgs = gallery.querySelectorAll('img');
  imgs.forEach((img, i) => {
    img.classList.remove('fill-gap');
    const imgData = images[i];
    if (!imgData) return;

    const isWide = imgData.is_wide && numCols >= 3;
    const isFilled = imgData.is_filled;
    const spanCols = isWide ? 2 : 1;
    const aspect = (imgData.width && imgData.height) ? (imgData.height / imgData.width) : (2 / 3);
    
    const logH = spanCols * aspect;
    const pxH = Math.max(1, Math.round((colWidth * spanCols * aspect) / ROW_UNIT));

    if (isWide) {
      let bestLog = Infinity;
      let colStart = 0;
      for (let c = 0; c < numCols - 1; c++) {
        const h = Math.max(logHeights[c], logHeights[c + 1]);
        if (h < bestLog) { bestLog = h; colStart = c; }
      }
      
      const pxStart = Math.max(pxHeights[colStart], pxHeights[colStart + 1]);
      
      // Check for stretchable items above
      for (let c of [colStart, colStart + 1]) {
        if (logHeights[c] < bestLog - 0.01) {
          const last = lastItemInCol[c];
          let stretched = false;
          if (last && last.is_filled) {
            if (last.spanCols === 1) {
              stretched = true;
            } else if (last.spanCols === 2) {
              const other = (last.col === c) ? c + 1 : c - 1;
              if (lastItemInCol[other] === last) {
                stretched = true;
                logHeights[other] = bestLog;
                pxHeights[other] = pxStart;
              }
            }
          }
          if (stretched) {
            last.el.style.gridRow = `${last.pxStart + 1} / span ${pxStart - last.pxStart}`;
            last.el.classList.add('fill-gap');
            logHeights[c] = bestLog;
            pxHeights[c] = pxStart;
          }
        }
      }
      
      if (logHeights[colStart] < bestLog - 0.01) {
        logGaps.push({ col: colStart, start: logHeights[colStart], end: bestLog });
        pxGaps.push({ col: colStart, start: pxHeights[colStart], end: pxStart });
      }
      if (logHeights[colStart + 1] < bestLog - 0.01) {
        logGaps.push({ col: colStart + 1, start: logHeights[colStart + 1], end: bestLog });
        pxGaps.push({ col: colStart + 1, start: pxHeights[colStart + 1], end: pxStart });
      }

      img.style.gridColumn = `${colStart + 1} / span 2`;
      img.style.gridRow    = `${pxStart + 1} / span ${pxH}`;
      
      logHeights[colStart] = bestLog + logH;
      logHeights[colStart + 1] = bestLog + logH;
      pxHeights[colStart] = pxStart + pxH;
      pxHeights[colStart + 1] = pxStart + pxH;
      
      const itemRecord = { el: img, pxStart, spanCols, is_filled: isFilled, col: colStart };
      lastItemInCol[colStart] = itemRecord;
      lastItemInCol[colStart + 1] = itemRecord;
      
    } else {
      let placedInGap = false;
      const sortedGapIndices = logGaps.map((_, idx) => idx).sort((a, b) => logGaps[a].start - logGaps[b].start);
      
      for (let idx of sortedGapIndices) {
        const logGap = logGaps[idx];
        const pxGap = pxGaps[idx];
        
        if (logH <= (logGap.end - logGap.start) + 0.01) {
          img.style.gridColumn = `${logGap.col + 1}`;
          
          if (isFilled) {
            const remainingPx = pxGap.end - pxGap.start;
            img.style.gridRow = `${pxGap.start + 1} / span ${remainingPx}`;
            img.classList.add('fill-gap');
            logGap.start = logGap.end;
            pxGap.start = pxGap.end;
          } else {
            img.style.gridRow = `${pxGap.start + 1} / span ${pxH}`;
            logGap.start += logH;
            pxGap.start += pxH;
          }
          
          placedInGap = true;
          
          if (logGap.start >= logGap.end - 0.01) {
            logGaps.splice(idx, 1);
            pxGaps.splice(idx, 1);
          }
          break;
        }
      }

      if (!placedInGap) {
        const minLog = Math.min(...logHeights);
        const colStart = logHeights.indexOf(minLog);
        const pxStart = pxHeights[colStart];
        
        img.style.gridColumn = `${colStart + 1}`;
        img.style.gridRow    = `${pxStart + 1} / span ${pxH}`;
        
        logHeights[colStart] = minLog + logH;
        pxHeights[colStart] = pxStart + pxH;
        
        lastItemInCol[colStart] = { el: img, pxStart, spanCols, is_filled: isFilled, col: colStart };
      }
    }
  });

  // Final pass: stretch filled items at the ragged bottom edge
  const maxPxHeight = Math.max(...pxHeights);
  for (let c = 0; c < numCols; c++) {
    const last = lastItemInCol[c];
    if (last && last.is_filled && pxHeights[c] < maxPxHeight) {
      let canStretch = false;
      if (last.spanCols === 1) canStretch = true;
      else if (last.spanCols === 2) {
        const other = last.col === c ? c + 1 : c - 1;
        if (lastItemInCol[other] === last) canStretch = true;
      }
      if (canStretch) {
        last.el.style.gridRow = `${last.pxStart + 1} / span ${maxPxHeight - last.pxStart}`;
        last.el.classList.add('fill-gap');
        pxHeights[c] = maxPxHeight;
        if (last.spanCols === 2) {
          const other = last.col === c ? c + 1 : c - 1;
          pxHeights[other] = maxPxHeight;
        }
      }
    }
  }
}

let _layoutTimer = null;
function renderGallery() {
  gallery.innerHTML = '';

  images.forEach((imgData, index) => {
    const img    = document.createElement('img');
    img.src      = imgData.public_url_thumb;
    img.alt      = imgData.alt_text || imgData.title || '';
    img.loading  = index < 8 ? 'eager' : 'lazy'; // first 8 load immediately
    img.decoding = 'async';

    // Set aspect-ratio so the element has correct proportions even before load
    img.style.aspectRatio = (imgData.width && imgData.height)
      ? `${imgData.width} / ${imgData.height}` : '3 / 2';
    if (imgData.width)  img.setAttribute('width',  imgData.width);
    if (imgData.height) img.setAttribute('height', imgData.height);

    img.addEventListener('load', () => img.classList.add('loaded'));
    img.addEventListener('click', () => openLightbox(index));
    gallery.appendChild(img);
  });

  // Run layout after DOM is painted so gallery.offsetWidth is accurate
  requestAnimationFrame(layoutGallery);
}

// Re-layout on resize (debounced)
new ResizeObserver(() => {
  clearTimeout(_layoutTimer);
  _layoutTimer = setTimeout(layoutGallery, 120);
}).observe(gallery);


// ─── Lightbox ──────────────────────────────────────────────────────────────────
// The clone zoom animation starts immediately using the already-loaded thumbnail.
// Full-res loads in parallel — no freeze, no waiting before anything moves.
// A monotonic openId prevents stale callbacks after close or rapid navigation.

let fullResLoader = null;
let lightboxOpenId = 0;

/**
 * Calculate the pixel dimensions the lightbox image should occupy,
 * constrained to 94vw × 92vh, preserving the image's aspect ratio.
 * Using stored DB dimensions means both thumbnail and full-res get the
 * same element size, so there is no layout jump when the full-res loads.
 */
function calcLightboxSize(imgData) {
  const srcW  = imgData.width  || 3;
  const srcH  = imgData.height || 2;
  const vw    = window.innerWidth  * 0.94;
  const vh    = window.innerHeight * 0.92;
  const ratio = srcW / srcH;
  let w = vw, h = w / ratio;
  if (h > vh) { h = vh; w = h * ratio; }
  return { w: Math.round(w), h: Math.round(h) };
}

function applyLightboxSize(imgData) {
  const { w, h } = calcLightboxSize(imgData);
  lightboxImg.style.width  = `${w}px`;
  lightboxImg.style.height = `${h}px`;
}

function openLightbox(index) {
  currentIndex = index;
  const imgData = images[index];
  const openId  = ++lightboxOpenId;

  // Cancel any previous in-flight load
  if (fullResLoader) { fullResLoader.onload = null; fullResLoader.onerror = null; fullResLoader = null; }

  // ── Clone zoom: starts immediately, uses cached thumbnail ──────────────────
  const thumbEl = gallery.querySelectorAll('img')[index];
  let clone = null;

  if (thumbEl) {
    const rect = thumbEl.getBoundingClientRect();
    clone = document.createElement('img');
    clone.src = thumbEl.currentSrc || thumbEl.src;
    clone.className = 'lightbox-clone';
    clone.style.cssText = `top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;`;
    document.body.appendChild(clone);

    // Use stored DB dimensions to calculate final size without needing full-res loaded
    const srcW  = imgData.width  || thumbEl.naturalWidth  || rect.width;
    const srcH  = imgData.height || thumbEl.naturalHeight || rect.height;
    const vw = window.innerWidth * 0.94, vh = window.innerHeight * 0.92;
    const ratio = srcW / srcH;
    let finalW = vw, finalH = finalW / ratio;
    if (finalH > vh) { finalH = vh; finalW = finalH * ratio; }

    // Animate on next frame so the starting position paints first
    requestAnimationFrame(() => {
      clone.style.top    = `${(window.innerHeight - finalH) / 2}px`;
      clone.style.left   = `${(window.innerWidth  - finalW) / 2}px`;
      clone.style.width  = `${finalW}px`;
      clone.style.height = `${finalH}px`;
    });
  }

  lightboxImg.classList.remove('ready', 'is-thumb');
  lightbox.classList.remove('hidden');
  
  // Prevent layout shift when scrollbar disappears
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.paddingRight = `${scrollbarWidth}px`;
  document.body.classList.add('lightbox-open');

  // ── Load full-res in parallel while animation plays ────────────────────────
  let fullLoaded = false;
  const full = new Image();
  fullResLoader = full;
  full.src = imgData.public_url_full;
  full.onload = () => {
    if (openId !== lightboxOpenId) return;
    fullResLoader = null;
    fullLoaded = true;
  };
  full.onerror = () => { if (openId === lightboxOpenId) fullResLoader = null; };

  // ── After animation (420ms): reveal image behind the clone ────────────────
  setTimeout(() => {
    if (openId !== lightboxOpenId) { clone?.remove(); return; } // closed/navigated away
    clone?.remove();

    // Pin the element to the correct display dimensions BEFORE revealing.
    // Both the thumbnail placeholder and the eventual full-res will render
    // at exactly these dimensions — no size jump between the two.
    applyLightboxSize(imgData);

    if (fullLoaded) {
      // Best case: full-res finished during animation — show it directly, crisp
      lightboxImg.src = imgData.public_url_full;
      lightboxImg.classList.remove('is-thumb');
    } else {
      // Still downloading — show thumbnail as a sharp enough placeholder
      lightboxImg.src = imgData.public_url_thumb;
      lightboxImg.classList.add('is-thumb');
      // Cross-fade to full-res the moment it arrives
      full.onload = () => {
        if (openId !== lightboxOpenId) return;
        // Instant swap — src change is atomic (image already decoded in memory).
        // Keep 'ready' on so there is no opacity dip/flicker.
        lightboxImg.src = imgData.public_url_full;
        lightboxImg.classList.remove('is-thumb'); // deblur fades via filter transition
      };
    }
    lightboxImg.classList.add('ready');
  }, 420);
}

function updateLightbox() {
  // Arrow / swipe navigation — no thumbnail to zoom from, use blur-up.
  const imgData = images[currentIndex];
  if (fullResLoader) { fullResLoader.onload = null; fullResLoader.onerror = null; fullResLoader = null; }
  const openId = ++lightboxOpenId;

  // Fix the element size FIRST so thumbnail and full-res both render at
  // the same dimensions — prevents the image jumping size when full-res loads.
  applyLightboxSize(imgData);
  lightboxImg.src = imgData.public_url_thumb;
  lightboxImg.classList.add('ready', 'is-thumb');

  const full = new Image();
  fullResLoader = full;
  full.src = imgData.public_url_full;
  full.onload = () => {
    if (openId !== lightboxOpenId) return;
    fullResLoader = null;
    // Instant swap — keep 'ready', just swap src and remove blur
    lightboxImg.src = imgData.public_url_full;
    lightboxImg.classList.remove('is-thumb');
  };
  full.onerror = () => { if (openId === lightboxOpenId) fullResLoader = null; };
}

function closeLightbox() {
  ++lightboxOpenId; // invalidate all in-flight callbacks
  if (fullResLoader) { fullResLoader.onload = null; fullResLoader.onerror = null; fullResLoader = null; }
  
  const thumbEl = gallery?.querySelectorAll('img')[currentIndex];
  
  if (thumbEl && !lightbox.classList.contains('hidden')) {
    // ── Reverse clone zoom ────────────────────────────────────────────────────
    const rect = thumbEl.getBoundingClientRect();
    const imgData = images[currentIndex];
    
    // Use the exact calculated lightbox size as the starting point
    const { w: startW, h: startH } = calcLightboxSize(imgData);
    
    const clone = document.createElement('img');
    clone.src = thumbEl.currentSrc || thumbEl.src;
    clone.className = 'lightbox-clone';
    clone.style.cssText = `top:${(window.innerHeight - startH) / 2}px;left:${(window.innerWidth - startW) / 2}px;width:${startW}px;height:${startH}px;`;
    document.body.appendChild(clone);

    // Animate clone back to the thumbnail grid position
    requestAnimationFrame(() => {
      clone.style.top    = `${rect.top}px`;
      clone.style.left   = `${rect.left}px`;
      clone.style.width  = `${rect.width}px`;
      clone.style.height = `${rect.height}px`;
    });

    setTimeout(() => clone.remove(), 420);
  }

  lightboxImg.classList.remove('ready', 'is-thumb');
  lightboxImg.style.width  = '';
  lightboxImg.style.height = '';
  lightbox.classList.add('hidden');
  document.body.classList.remove('lightbox-open');
  document.body.style.paddingRight = '';
}

// ─── Lightbox controls ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!lightbox || lightbox.classList.contains('hidden')) return;
  if (e.key === 'ArrowRight') { currentIndex = (currentIndex + 1) % images.length; updateLightbox(); }
  else if (e.key === 'ArrowLeft')  { currentIndex = (currentIndex - 1 + images.length) % images.length; updateLightbox(); }
  else if (e.key === 'Escape')     { closeLightbox(); }
});

lightbox?.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
lightboxClose?.addEventListener('click', closeLightbox);

lightbox?.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
lightbox?.addEventListener('touchend', e => {
  const delta = e.changedTouches[0].clientX - startX;
  if (Math.abs(delta) < 40) return;
  currentIndex = delta < 0
    ? (currentIndex + 1) % images.length
    : (currentIndex - 1 + images.length) % images.length;
  updateLightbox();
}, { passive: true });

// ─── Header scroll behaviour ───────────────────────────────────────────────────
// Suppress header toggling during smooth-scroll autoscroll.
// The native smooth scroll causes a single-frame scrollY jitter (layout shift
// from ResizeObserver/layoutGallery resizing the grid mid-scroll), which
// makes the scroll handler think the user scrolled up and un-hides the header
// for ~16ms — the visible "pulse". We suppress that window.
let smoothScrollActive = false;
let _scrollEndTimer = null;

// Set the flag whenever a hash-link is clicked (e.g. the "View" button)
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  smoothScrollActive = true;
  console.log('[smooth-scroll] flag SET — suppressing header toggle during scroll');
}, { capture: true });

let lastScrollY = window.scrollY;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (y < 80) {
    // Near the top: header always visible with transparent background
    header.classList.remove('hidden-header', 'scrolled');
    lastScrollY = y;
    return;
  }
  const goingDown = y > lastScrollY;
  header.classList.toggle('hidden-header', goingDown);
  // Only apply the dark 'scrolled' background when the header is reappearing
  // (scrolling up). When hiding on scroll-down, don't darken the header first
  // — that creates a visible 'getting darker before fading' effect.
  header.classList.toggle('scrolled', !goingDown);
  lastScrollY = y;
}, { passive: true });

// ─── DEBUG: Pulse investigation ────────────────────────────────────────────────
// Intercept every class mutation on the header and log it with a timestamp.
(function installHeaderDebug() {
  let _lastScrollLog = -1;
  const _add    = DOMTokenList.prototype.add;
  const _remove = DOMTokenList.prototype.remove;
  const _toggle = DOMTokenList.prototype.toggle;

  // Wrap classList methods on the header element only
  const origAdd = header.classList.add.bind(header.classList);
  header.classList.add = function(...cls) {
    console.log(`[header.classList.add] ${cls.join(',')} | y=${window.scrollY.toFixed(0)} | before: "${header.className}"`);
    origAdd(...cls);
  };
  const origRemove = header.classList.remove.bind(header.classList);
  header.classList.remove = function(...cls) {
    console.log(`[header.classList.remove] ${cls.join(',')} | y=${window.scrollY.toFixed(0)} | before: "${header.className}"`);
    origRemove(...cls);
  };
  const origToggle = header.classList.toggle.bind(header.classList);
  header.classList.toggle = function(cls, force) {
    const result = force !== undefined ? origToggle(cls, force) : origToggle(cls);
    console.log(`[header.classList.toggle] ${cls}=${result} (force=${force}) | y=${window.scrollY.toFixed(0)} | now: "${header.className}"`);
    return result;
  };

  // Log CSS transition events on the header
  header.addEventListener('transitionstart', e => {
    console.log(`[header.transitionstart] property=${e.propertyName} | opacity=${getComputedStyle(header).opacity} | classes="${header.className}"`);
  });
  header.addEventListener('transitionend', e => {
    console.log(`[header.transitionend] property=${e.propertyName} | final-opacity=${getComputedStyle(header).opacity}`);
  });

  // Log every scroll event (throttled: only when y changes by ≥5px)
  window.addEventListener('scroll', () => {
    const y = Math.round(window.scrollY);
    if (Math.abs(y - _lastScrollLog) >= 5) {
      console.log(`[scroll] y=${y} | header: "${header.className}" | heroIsVisible=${heroIsVisible}`);
      _lastScrollLog = y;
    }
  }, { passive: true });

  // Monitor computed opacity on main and hero for any unexpected drops
  let _opacityCheckId = null;
  function checkOpacity() {
    const mainEl  = document.querySelector('main');
    const heroEl  = document.querySelector('.hero');
    const footerEl = document.querySelector('footer');
    [mainEl, heroEl, footerEl].forEach(el => {
      if (!el) return;
      const op = parseFloat(getComputedStyle(el).opacity);
      if (op < 0.95) {
        console.warn(`[opacity-watch] ${el.tagName}.${el.className.split(' ').join('.')} opacity=${op.toFixed(3)} at y=${window.scrollY.toFixed(0)}`);
      }
    });
    _opacityCheckId = requestAnimationFrame(checkOpacity);
  }
  checkOpacity();

  // Log any CSS animation starting on .reveal elements
  document.addEventListener('animationstart', e => {
    if (e.animationName === 'revealIn') {
      console.warn(`[animationstart] revealIn on ${e.target.tagName}.${e.target.className} at y=${window.scrollY.toFixed(0)}`);
      console.trace();
    }
  }, { capture: true });

  console.log('[debug] Header + opacity + scroll watchers installed.');
})();

function loadAbout(config) {
  const content = document.getElementById('about-content');
  if (!content) return;

  // Update title
  const title = config.site_title || 'Will Davies';
  document.title = `${config.about_title || 'About'} — ${title}`;

  let textCol = '';

  textCol += `<h2 class="about-name reveal" style="animation-delay: 250ms;">${config.about_title || 'About'}</h2>`;

  if (config.about_text) {
    textCol += `<p class="about-text reveal" style="animation-delay: 350ms;">${escapeHtml(config.about_text)}</p>`;
  } else {
    textCol += `<p class="about-text reveal" style="animation-delay: 350ms;color:rgba(243,243,240,0.35)">About content coming soon.</p>`;
  }

  const links = [];
  if (config.contact_email)  links.push(`<a href="mailto:${escapeHtml(config.contact_email)}">${escapeHtml(config.contact_email)}</a>`);
  if (config.instagram_url)  links.push(`<a href="${escapeHtml(config.instagram_url)}" target="_blank" rel="noopener">Instagram ↗</a>`);
  if (links.length > 0) {
    textCol += `<div class="about-links reveal" style="animation-delay: 450ms;">${links.join('')}</div>`;
  }

  textCol += `
    <form class="contact-form reveal" id="contact-form" style="animation-delay: 550ms; margin-top: 48px;">
      <h3 style="font-size:1.2rem;margin-bottom:24px;font-weight:500;">Send a message</h3>
      <div class="field">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" required placeholder="Your name">
      </div>
      <div class="field">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required placeholder="hello@example.com">
      </div>
      <div class="field">
        <label for="message">Message</label>
        <textarea id="message" name="message" rows="5" required placeholder="How can I help?"></textarea>
      </div>
      <button type="submit" class="btn-submit" id="submit-btn">Send Message</button>
      <div id="form-status"></div>
    </form>
  `;

  let html = '';

  if (config.about_profile_url) {
    html += `<div class="about-header">
      <img class="about-profile-img reveal" src="${config.about_profile_url}" alt="${title}" style="animation-delay: 150ms;">
      <div class="about-text-col" style="flex: 1;">${textCol}</div>
    </div>`;
  } else {
    // No profile image — render text inline without the flex wrapper
    html += textCol;
  }

  content.innerHTML = html;

  // Attach form listener
  const form = document.getElementById('contact-form');
  const status = document.getElementById('form-status');
  const btn = document.getElementById('submit-btn');

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Sending…';
    status.className = '';
    status.textContent = '';

    const formData = {
      name: form.name.value,
      email: form.email.value,
      message: form.message.value,
    };

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        status.textContent = 'Message sent successfully. Thank you!';
        status.className = 'success';
        form.reset();
      } else {
        status.textContent = 'Failed to send message. Please try again.';
        status.className = 'error';
      }
    } catch (err) {
      status.textContent = 'Connection error. Please try again.';
      status.className = 'error';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send Message';
    }
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── SPA Router ────────────────────────────────────────────────────────────────
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a');
  if (!a) return;

  // Only intercept same-origin, non-hash, non-target-_blank links
  if (a.origin !== window.location.origin) return;
  if (a.target === '_blank') return;
  if (a.hasAttribute('download')) return;

  // Skip hash-only navigation (same page, different anchor) — let browser handle natively.
  // Compare path+search without the fragment to be robust against any hash value.
  const currentBase = window.location.pathname + window.location.search;
  const targetBase  = a.pathname + a.search;
  if (a.hash && targetBase === currentBase) return;

  // Intercept the click!
  e.preventDefault();
  const targetUrl = a.href;

  window.history.pushState({}, '', targetUrl);
  _lastRoutedBase = a.pathname + a.search; // keep popstate guard in sync
  await handleRoute(targetUrl);
});

// Track the base URL (path+search) of the last SPA route so we can
// distinguish real navigations from hash-only fragment scrolls.
// Chrome fires popstate for both, but only real navigations need re-routing.
let _lastRoutedBase = window.location.pathname + window.location.search;

window.addEventListener('popstate', () => {
  const currentBase = window.location.pathname + window.location.search;
  if (currentBase === _lastRoutedBase) {
    // Only the hash changed (e.g. clicking "View" / href="#gallery").
    // The browser already scrolled to the anchor — no re-route needed.
    console.log('[popstate] hash-only change, skipping re-route. hash=' + window.location.hash);
    return;
  }
  _lastRoutedBase = currentBase;
  handleRoute(window.location.href);
});

async function handleRoute(url) {
  try {
    const res = await fetch(url);
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const newContent = doc.getElementById('app-content');
    if (!newContent) {
      window.location.href = url; // Fallback to hard reload
      return;
    }

    // Update section parameter from the new URL
    const params = new URLSearchParams(new URL(url).search);
    section = params.get('section') || 'archive';

    const performUpdate = async () => {
      const appContent = document.getElementById('app-content');

      // Strip .reveal before injecting so the View Transition "new" snapshot
      // is never captured at opacity:0 (which causes the fade-to-black).
      // Page navigations use the View Transition cross-fade instead.
      newContent.querySelectorAll('.reveal').forEach(el => {
        el.classList.remove('reveal');
        el.style.opacity = '1';
        el.style.transform = 'none';
      });

      appContent.innerHTML = newContent.innerHTML;
      window.scrollTo(0, 0); // Always start at the top of the new page
      
      // Update DOM refs inside app-content
      gallery = document.getElementById('gallery');
      heroMedia = document.getElementById('hero-media');
      heroKicker = document.getElementById('hero-kicker');
      heroLink = document.getElementById('hero-link');
      
      document.title = doc.title;
      await initPage();
    };

    if (document.startViewTransition) {
      document.startViewTransition(() => performUpdate());
    } else {
      performUpdate();
    }
  } catch (err) {
    console.error('Routing failed', err);
    window.location.href = url;
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
initPage();