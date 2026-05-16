'use strict';
// ─── DOM refs ──────────────────────────────────────────────────────────────────
let gallery        = document.getElementById('gallery');
const lightboxSlider = document.getElementById('lightbox-slider');
const lightboxClose = document.getElementById('lightbox-close');
let heroMedia      = document.getElementById('hero-media');
let heroKicker     = document.getElementById('hero-kicker');
let heroLink       = document.getElementById('hero-link');
const header       = document.getElementById('site-header');
const siteNav      = document.getElementById('site-nav');
const siteTitle    = document.getElementById('site-title');

const lightbox     = document.getElementById('lightbox');

// ─── Global State ──────────────────────────────────────────────────────────────
let heroIsVisible = true;
let heroObserver = null;

// ─── State ─────────────────────────────────────────────────────────────────────
const params  = new URLSearchParams(window.location.search);
let section   = params.get('section') || 'archive';
let images    = [];
let currentIndex = 0;
let startX    = 0;
let startY    = 0;
let heroSlides = [];
let heroIndex = 0;
let heroTimer = null;
let sectionCache = new Map();

// ─── Zoom State ───────────────────────────────────────────────────────────────
let zoomScale = 1;
let lastZoomScale = 1;
let initialPinchDistance = 0;
let isPinching = false;
let translateX = 0;
let translateY = 0;
let panStartX = 0;
let panStartY = 0;

// ─── Preload flash prevention ──────────────────────────────────────────────────
// Removing 'preload' as soon as the script executes (it's deferred, so DOM is ready)
// This makes the header and hero appear much faster without waiting for all images.
document.body.classList.remove('preload');

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
      if (window.INITIAL_DATA) {
        siteConfigCache = window.INITIAL_DATA;
        // Don't delete yet as it contains initial_images
      } else {
        const configRes = await fetch('/api/site-config');
        siteConfigCache = await configRes.json();
      }
    }
    applyConfig(siteConfigCache);
    setupNavPrefetch();
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
        let data;
        // Check if we have initial images for the current section injected by the server
        const currentSection = new URLSearchParams(window.location.search).get('section') || 'archive';
        
        if (siteConfigCache?.initial_images && section === currentSection) {
          data = siteConfigCache.initial_images;
          delete siteConfigCache.initial_images; // Use only once
          sectionCache.set(section, data);
        } else if (sectionCache.has(section)) {
          data = sectionCache.get(section);
        } else {
          const imgRes = await fetch(`/api/images?section=${encodeURIComponent(section)}`);
          data = await imgRes.json();
          sectionCache.set(section, data);
        }

        if (Array.isArray(data) && data.length > 0) {
          images = data;
          renderGallery();
          renderLightboxSlides();
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

function setupNavPrefetch() {
  if (!siteNav) return;
  const prefetch = (e) => {
    const a = e.target.closest('a');
    if (!a || !a.href.includes('section=')) return;
    try {
      const url = new URL(a.href, window.location.origin);
      const s = url.searchParams.get('section');
      if (s && !sectionCache.has(s)) {
        fetch(`/api/images?section=${encodeURIComponent(s)}`)
          .then(res => res.json())
          .then(data => {
            sectionCache.set(s, data);
            // Predictive preloading: Load the first 2 thumbnails of this section
            data.slice(0, 2).forEach(img => {
              const link = document.createElement('link');
              link.rel = 'preload'; link.as = 'image'; link.href = img.public_url_thumb;
              link.setAttribute('fetchpriority', 'low'); // Lower priority for predictive preloading
              document.head.appendChild(link);
            });
          })
          .catch(() => {});
      }
    } catch (e) {}
  };
  siteNav.addEventListener('mouseover', prefetch, { passive: true });
  siteNav.addEventListener('touchstart', prefetch, { passive: true });
}

// ─── Apply site config to DOM ──────────────────────────────────────────────────
function applyConfig(config) {
  // Site title
  const title = config.site_title || 'Will Davies';
  document.title = title;
  if (siteTitle && siteTitle.querySelector('a')) {
    siteTitle.querySelector('a').textContent = title;
  }

  // Build nav from DB sections if empty or update active state
  const sections = config.sections || [];
  const isAboutPage = window.location.pathname.includes('/about');

  if (siteNav && (siteNav.children.length === 0 || siteNav.dataset.built !== 'true')) {
    siteNav.innerHTML = '';
    for (const s of sections) {
      const a = document.createElement('a');
      a.href = `/?section=${encodeURIComponent(s.slug)}`;
      a.textContent = s.nav_label || s.label;
      if (!isAboutPage && s.slug === section) a.classList.add('active');
      siteNav.appendChild(a);
    }
    const aboutLink = document.createElement('a');
    aboutLink.href = '/about';
    aboutLink.textContent = config.about_title || 'About';
    if (isAboutPage) aboutLink.classList.add('active');
    siteNav.appendChild(aboutLink);
    siteNav.dataset.built = 'true';
  } else if (siteNav) {
    // Just update active classes
    const allLinks = siteNav.querySelectorAll('a');
    allLinks.forEach(a => {
      const url = new URL(a.href, window.location.origin);
      if (url.pathname === '/about') {
        a.classList.toggle('active', isAboutPage);
      } else {
        const s = url.searchParams.get('section');
        a.classList.toggle('active', !isAboutPage && s === section);
      }
    });
  }

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
  
  // Use server-provided index if available for consistency with preload
  if (window.INITIAL_DATA && typeof window.INITIAL_DATA.initial_hero_index === 'number') {
    heroIndex = window.INITIAL_DATA.initial_hero_index;
    // Note: We don't delete it here because initHeroSlideshow might be called
    // multiple times if initPage is re-run (though we should avoid it).
    // Actually, delete it to ensure future navigations are random.
    delete window.INITIAL_DATA.initial_hero_index;
  } else {
    heroIndex = heroes.length > 0 ? Math.floor(Math.random() * heroes.length) : 0;
  }

  heroes.forEach((h, i) => {
    const div = document.createElement('div');
    div.className = 'hero-slide';
    const img = document.createElement('img');
    img.src = h.thumb_url; // Load optimized thumb first
    img.classList.add('loading');
    img.alt = 'Hero image';
    if (h.focal_point && h.focal_point !== 'center') {
      img.style.setProperty('--mobile-focal-point', h.focal_point);
    }
    div.appendChild(img);
    heroMedia.appendChild(div);
    heroSlides.push(div);

    // Attach full-res URL for on-demand loading
    img.dataset.fullUrl = h.full_url;

    const loadFullRes = () => {
      if (img.dataset.fullLoaded === 'true') return;
      const full = new Image();
      if (i === heroIndex) full.fetchPriority = 'high';
      full.src = h.full_url;
      full.onload = () => {
        img.src = h.full_url;
        img.classList.remove('loading');
        img.dataset.fullLoaded = 'true';
      };
    };

    // Store reference to load function for later use
    div.loadFullRes = loadFullRes;

    if (i === heroIndex) {
      loadFullRes();
    }
  });

  // Fade in first random slide after a tiny delay to ensure transition triggers.
  // We use a double requestAnimationFrame to ensure the elements are painted 
  // at opacity:0 before we trigger the transition to opacity:1.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (heroSlides[heroIndex]) heroSlides[heroIndex].classList.add('active');
    });
  });

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
  
  // Trigger full-res load for the incoming slide
  if (heroSlides[heroIndex].loadFullRes) {
    heroSlides[heroIndex].loadFullRes();
  }
  
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
    if (index < 8) img.fetchPriority = 'high';   // Prioritise initial view images
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

function renderLightboxSlides() {
  if (!lightboxSlider) return;
  lightboxSlider.innerHTML = '';
  images.forEach((_, i) => {
    const slide = document.createElement('div');
    slide.className = 'lightbox-slide';
    lightboxSlider.appendChild(slide);
  });
}

// Re-layout on resize (debounced)
new ResizeObserver(() => {
  clearTimeout(_layoutTimer);
  _layoutTimer = setTimeout(layoutGallery, 120);
}).observe(document.body);


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

function applyLightboxSize(imgData, imgEl) {
  const { w, h } = calcLightboxSize(imgData);
  imgEl.style.width  = `${w}px`;
  imgEl.style.height = `${h}px`;
}

function loadLightboxSlide(index, openId, delayReady = false, shouldLoadFull = false) {
  if (index < 0 || index >= images.length) return;
  const slide = lightboxSlider.children[index];
  if (!slide) return;

  let img = slide.querySelector('img');
  if (!img) {
    img = document.createElement('img');
    slide.appendChild(img);
  }

  // Only return early if we've already handled this openId AND we aren't trying to upgrade to full-res
  if (img.dataset.loadedId === String(openId) && !shouldLoadFull) return;
  img.dataset.loadedId = openId;

  const imgData = images[index];
  applyLightboxSize(imgData, img);

  if (delayReady) {
    img.classList.remove('ready');
    img.dataset.delayReady = 'true';
  } else {
    delete img.dataset.delayReady;
  }

  console.log(`[lightbox] slide ${index}: loadFull=${shouldLoadFull}, current=${currentIndex}, fullLoaded=${img.dataset.fullLoaded}`);

  // 1. If already full-loaded, ensure it is visible (unless delayed) and return.
  if (img.dataset.fullLoaded === 'true') {
    img.src = imgData.public_url_full;
    img.classList.remove('is-thumb');
    if (img.dataset.delayReady !== 'true') img.classList.add('ready');
    return;
  }

  // 2. If we're told to load the full-res version (and not already loaded).
  if (shouldLoadFull) {
    console.log(`[lightbox] slide ${index}: fetching full-res...`);
    const full = new Image();
    full.fetchPriority = (index === currentIndex) ? 'high' : 'low';
    full.src = imgData.public_url_full;
    
    full.onload = () => {
      console.log(`[lightbox] slide ${index}: full-res loaded`);
      applyLightboxSize(imgData, img);
      img.src = imgData.public_url_full;
      img.classList.remove('is-thumb');
      img.dataset.fullLoaded = 'true';
      if (img.dataset.delayReady !== 'true') img.classList.add('ready');
    };

    full.onerror = () => {
      console.warn(`[lightbox] slide ${index}: full-res failed`);
      img.src = imgData.public_url_thumb;
      if (img.dataset.delayReady !== 'true') img.classList.add('ready');
    };
  }

  // 3. Show thumbnail immediately (as a placeholder or for neighbors).
  if (img.src !== imgData.public_url_full) {
    img.src = imgData.public_url_thumb;
    if (img.dataset.delayReady !== 'true') img.classList.add('ready', 'is-thumb');
  }
}

function openLightbox(index) {
  currentIndex = index;
  const imgData = images[index];
  const openId  = ++lightboxOpenId;

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

    const { w: finalW, h: finalH } = calcLightboxSize(imgData);

    requestAnimationFrame(() => {
      clone.style.top    = `${(window.innerHeight - finalH) / 2}px`;
      clone.style.left   = `${(window.innerWidth  - finalW) / 2}px`;
      clone.style.width  = `${finalW}px`;
      clone.style.height = `${finalH}px`;
    });
  }

  // Jump slider to correct position instantly
  lightboxSlider.style.transition = 'none';
  lightboxSlider.style.transform = `translateX(-${index * 100}vw)`;
  
  lightbox.classList.remove('hidden');
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.paddingRight = `${scrollbarWidth}px`;
  document.body.classList.add('lightbox-open');

  // Load active slide (delayed reveal) and neighbours (immediate)
  loadLightboxSlide(index, openId, true, true); // delayReady = true, shouldLoadFull = true
  loadLightboxSlide(index - 1, openId, false, false);
  loadLightboxSlide(index + 1, openId, false, false);

  setTimeout(() => {
    if (openId === lightboxOpenId) {
      clone?.remove();
      const activeSlide = lightboxSlider.children[index];
      const activeImg = activeSlide?.querySelector('img');
      if (activeImg) {
        delete activeImg.dataset.delayReady;
        activeImg.classList.add('ready');
      }
      lightboxSlider.style.transition = '';
    } else {
      clone?.remove();
    }
  }, 420);
}

function getDistance(touch1, touch2) {
  const dx = touch1.clientX - touch2.clientX;
  const dy = touch1.clientY - touch2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function updateImageTransform() {
  const slide = lightboxSlider.children[currentIndex];
  const img = slide?.querySelector('img');
  if (!img) return;
  
  img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${zoomScale})`;
  img.style.transition = (isPinching || isDragging) ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
}

function resetZoom() {
  zoomScale = 1;
  lastZoomScale = 1;
  translateX = 0;
  translateY = 0;
  const slides = lightboxSlider.querySelectorAll('.lightbox-slide img');
  slides.forEach(img => {
    img.style.transform = '';
    img.style.transition = '';
  });
}

function updateLightbox() {
  resetZoom();
  const openId = ++lightboxOpenId;
  lightboxSlider.style.transform = `translateX(-${currentIndex * 100}vw)`;
  
  // 1. Show thumbnails immediately for the new view and its neighbours
  loadLightboxSlide(currentIndex, openId, false, false);
  loadLightboxSlide(currentIndex - 1, openId, false, false);
  loadLightboxSlide(currentIndex + 1, openId, false, false);

  // 2. Defer heavy full-res loading until after the swipe animation (450ms)
  // We trigger the current slide load slightly sooner (100ms) to reduce perceived lag.
  setTimeout(() => {
    if (openId === lightboxOpenId) {
      loadLightboxSlide(currentIndex, openId, false, true);
    }
  }, 100);

  setTimeout(() => {
    if (openId === lightboxOpenId) {
      loadLightboxSlide(currentIndex + 1, openId, false, true); // preload next high-res
    }
  }, 480);
}

function closeLightbox() {
  ++lightboxOpenId;
  
  const thumbEl = gallery?.querySelectorAll('img')[currentIndex];
  if (thumbEl && !lightbox.classList.contains('hidden')) {
    const rect = thumbEl.getBoundingClientRect();
    const imgData = images[currentIndex];
    const { w: startW, h: startH } = calcLightboxSize(imgData);
    
    const clone = document.createElement('img');
    clone.src = thumbEl.currentSrc || thumbEl.src;
    clone.className = 'lightbox-clone';
    clone.style.cssText = `top:${(window.innerHeight - startH) / 2}px;left:${(window.innerWidth - startW) / 2}px;width:${startW}px;height:${startH}px;`;
    document.body.appendChild(clone);

    requestAnimationFrame(() => {
      clone.style.top    = `${rect.top}px`;
      clone.style.left   = `${rect.left}px`;
      clone.style.width  = `${rect.width}px`;
      clone.style.height = `${rect.height}px`;
    });
    setTimeout(() => clone.remove(), 420);
  }

  lightbox.classList.add('hidden');
  document.body.classList.remove('lightbox-open');
  document.body.style.paddingRight = '';
  resetZoom();
}

// ─── Lightbox controls ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!lightbox || lightbox.classList.contains('hidden')) return;
  if (e.key === 'ArrowRight') { currentIndex = (currentIndex + 1) % images.length; updateLightbox(); }
  else if (e.key === 'ArrowLeft')  { currentIndex = (currentIndex - 1 + images.length) % images.length; updateLightbox(); }
  else if (e.key === 'Escape')     { closeLightbox(); }
});

lightbox?.addEventListener('click', e => {
  if (e.target === lightbox || e.target === lightboxSlider || e.target.classList.contains('lightbox-slide')) {
    closeLightbox();
  }
});
lightboxClose?.addEventListener('click', closeLightbox);

let currentTranslate = 0;
let isDragging = false;

lightbox?.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    isPinching = true;
    isDragging = false;
    initialPinchDistance = getDistance(e.touches[0], e.touches[1]);
    lastZoomScale = zoomScale;
  } else if (e.touches.length === 1) {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    
    if (zoomScale > 1) {
      isDragging = true;
      panStartX = e.touches[0].clientX - translateX;
      panStartY = e.touches[0].clientY - translateY;
    } else {
      isDragging = true;
      lightboxSlider.style.transition = 'none';
      currentTranslate = -currentIndex * window.innerWidth;
    }
  }
}, { passive: true });

lightbox?.addEventListener('touchmove', e => {
  if (isPinching && e.touches.length === 2) {
    const currentDistance = getDistance(e.touches[0], e.touches[1]);
    const ratio = currentDistance / initialPinchDistance;
    zoomScale = Math.min(Math.max(lastZoomScale * ratio, 1), 4);
    updateImageTransform();
  } else if (isDragging && e.touches.length === 1) {
    if (zoomScale > 1) {
      translateX = e.touches[0].clientX - panStartX;
      translateY = e.touches[0].clientY - panStartY;
      updateImageTransform();
    } else {
      const currentX = e.touches[0].clientX;
      const diff = currentX - startX;
      lightboxSlider.style.transform = `translateX(${currentTranslate + diff}px)`;
    }
  }
}, { passive: true });

lightbox?.addEventListener('touchend', e => {
  if (isPinching) {
    isPinching = false;
    lastZoomScale = zoomScale;
    if (zoomScale < 1.05) resetZoom();
  } else if (isDragging) {
    isDragging = false;
    if (zoomScale > 1) {
      // Done panning
    } else {
      lightboxSlider.style.transition = '';
      const diff = e.changedTouches[0].clientX - startX;
      
      if (Math.abs(diff) > 50) {
        if (diff < 0 && currentIndex < images.length - 1) {
          currentIndex++;
        } else if (diff > 0 && currentIndex > 0) {
          currentIndex--;
        }
      }
      updateLightbox();
    }
  }
}, { passive: true });

// ─── Header scroll behaviour ───────────────────────────────────────────────────
let smoothScrollActive = false;
let _scrollEndTimer = null;

document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) {
    document.documentElement.classList.remove('smooth-scroll-active');
    return;
  }
  document.documentElement.classList.add('smooth-scroll-active');
}, { capture: true });

let lastScrollY = window.scrollY;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (y < 80) {
    header.classList.remove('hidden-header', 'scrolled');
    lastScrollY = y;
    return;
  }
  const goingDown = y > lastScrollY;
  header.classList.toggle('hidden-header', goingDown);
  header.classList.toggle('scrolled', !goingDown);
  lastScrollY = y;
}, { passive: true });

  console.log('[script] Nav prefetching and SSR support ready.');

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
  const urlObj = new URL(url);
  const newSection = urlObj.searchParams.get('section');
  const isHome = urlObj.pathname === '/' || urlObj.pathname === '/index.html';
  const hasGallery = !!document.getElementById('gallery');

  // Optimization: If switching sections on the home page, do it locally without a full page fetch
  if (isHome && hasGallery && newSection) {
    section = newSection;
    const performUpdate = async () => {
      document.documentElement.classList.remove('smooth-scroll-active');
      window.scrollTo(0, 0);
      await initPage();
    };
    if (document.startViewTransition) document.startViewTransition(performUpdate);
    else performUpdate();
    return;
  }

  try {
    const res = await fetch(url);
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const newContent = doc.getElementById('app-content');
    if (!newContent) {
      window.location.href = url;
      return;
    }

    section = newSection || 'archive';

    const performUpdate = async () => {
      const appContent = document.getElementById('app-content');

      newContent.querySelectorAll('.reveal').forEach(el => {
        el.classList.remove('reveal');
        el.style.opacity = '1';
        el.style.transform = 'none';
      });

      appContent.innerHTML = newContent.innerHTML;
      document.documentElement.classList.remove('smooth-scroll-active');
      window.scrollTo(0, 0);
      
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