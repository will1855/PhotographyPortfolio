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

// ─── Bootstrap: load config then images ────────────────────────────────────────
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
    heroTimer = setInterval(nextHeroSlide, 5000);
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
  const numCols = getNumCols();
  const colWidth = gallery.offsetWidth / numCols;
  
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
  lightboxImg.classList.remove('ready', 'is-thumb');
  lightboxImg.style.width  = '';
  lightboxImg.style.height = '';
  lightbox.classList.add('hidden');
  document.body.classList.remove('lightbox-open');
}

// ─── Lightbox controls ─────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (lightbox.classList.contains('hidden')) return;
  if (e.key === 'ArrowRight') { currentIndex = (currentIndex + 1) % images.length; updateLightbox(); }
  else if (e.key === 'ArrowLeft')  { currentIndex = (currentIndex - 1 + images.length) % images.length; updateLightbox(); }
  else if (e.key === 'Escape')     { closeLightbox(); }
});

lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
lightboxClose?.addEventListener('click', closeLightbox);

lightbox.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
lightbox.addEventListener('touchend', e => {
  const delta = e.changedTouches[0].clientX - startX;
  if (Math.abs(delta) < 40) return;
  currentIndex = delta < 0
    ? (currentIndex + 1) % images.length
    : (currentIndex - 1 + images.length) % images.length;
  updateLightbox();
}, { passive: true });

// ─── Header scroll behaviour ───────────────────────────────────────────────────
let lastScrollY = window.scrollY;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  header.classList.toggle('scrolled', y > 40);
  if (y < 80) { header.classList.remove('hidden-header'); lastScrollY = y; return; }
  header.classList.toggle('hidden-header', y > lastScrollY);
  lastScrollY = y;
});

function loadAbout(config) {
  const content = document.getElementById('about-content');
  if (!content) return;

  // Update title
  const title = config.site_title || 'Will Davies';
  document.title = `${config.about_title || 'About'} — ${title}`;

  let html = '';

  if (config.about_profile_url) {
    html += `<img class="about-profile-img reveal" src="${config.about_profile_url}" alt="${title}" style="animation-delay: 150ms;">`;
  }

  html += `<h2 class="about-name reveal" style="animation-delay: 250ms;">${config.about_title || 'About'}</h2>`;

  if (config.about_text) {
    html += `<p class="about-text reveal" style="animation-delay: 350ms;">${escapeHtml(config.about_text)}</p>`;
  } else {
    html += `<p class="about-text reveal" style="animation-delay: 350ms;color:rgba(243,243,240,0.35)">About content coming soon.</p>`;
  }

  const links = [];
  if (config.contact_email)  links.push(`<a href="mailto:${escapeHtml(config.contact_email)}">${escapeHtml(config.contact_email)}</a>`);
  if (config.instagram_url)  links.push(`<a href="${escapeHtml(config.instagram_url)}" target="_blank" rel="noopener">Instagram ↗</a>`);
  if (links.length > 0) {
    html += `<div class="about-links reveal" style="animation-delay: 450ms;">${links.join('')}</div>`;
  }

  html += `
    <form class="contact-form reveal" id="contact-form" style="animation-delay: 550ms;">
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
  if (a.hash && a.pathname === window.location.pathname && a.search === window.location.search) return;
  if (a.target === '_blank') return;
  if (a.hasAttribute('download')) return;

  // Intercept the click!
  e.preventDefault();
  const targetUrl = a.href;

  window.history.pushState({}, '', targetUrl);
  await handleRoute(targetUrl);
});

window.addEventListener('popstate', () => {
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

    const performUpdate = () => {
      const appContent = document.getElementById('app-content');
      appContent.innerHTML = newContent.innerHTML;
      
      // Update DOM refs inside app-content
      gallery = document.getElementById('gallery');
      heroMedia = document.getElementById('hero-media');
      heroKicker = document.getElementById('hero-kicker');
      heroLink = document.getElementById('hero-link');
      
      document.title = doc.title;
      initPage();
    };

    if (document.startViewTransition) {
      document.startViewTransition(performUpdate);
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