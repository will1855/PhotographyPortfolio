'use strict';

import { logAnalyticsEvent } from './analytics.js';
import { renderGallery } from './gallery.js';
import { renderWorkLayout } from './gallery.js';
import { renderLightboxSlides } from './lightbox.js';
import { initHeroSlideshow, cleanupHeroSlideshow } from './slideshow.js';
import { dom, state } from './state.js';
import { initAdaptiveContrast, scheduleContrastEval } from './contrast.js';

// Local variables in main scope
let siteConfigCache = null;
let _lastRoutedBase = window.location.pathname + window.location.search;

// ─── Preload flash prevention ──────────────────────────────────────────────────
// Removing 'preload' class as soon as the script executes (deferred, DOM is ready)
document.body.classList.remove('preload');

// ─── Reveal animation cleanup ─────────────────────────────────────────────────
// Pins opacity to 1 after intro animation to prevent visual flickering on reflow
document.addEventListener('animationend', (e) => {
  const el = e.target;
  if (el.classList.contains('reveal') && e.animationName === 'revealIn') {
    el.style.opacity = '1';
    el.style.transform = 'none';
    el.classList.remove('reveal');
  }
}, { capture: true });

// Disable browser default scroll restoration
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

// Register the adaptive contrast slide-changed listener once at module load
initAdaptiveContrast();

/**
 * Bootstraps the application, loading the site configuration and section images.
 */
export async function initPage() {
  try {
    if (!siteConfigCache) {
      if (window.INITIAL_DATA) {
        siteConfigCache = window.INITIAL_DATA;
      } else {
        const configRes = await fetch('/api/site-config');
        siteConfigCache = await configRes.json();
      }
    }
    applyConfig(siteConfigCache);
    setupNavPrefetch();
    setupLiquidNavDrag();
    setupLiquidHoverEffects();
    setupLiquidGlassReactivity();

    updateLiquidNavPill(true);
  } catch (err) {
    console.warn('[config] Failed to load site config, using defaults', err);
    applyFallbackNav();
  }

  const isAbout = window.location.pathname.includes('/about');
  // "Home" = on the root path with no ?section= param
  const urlSection = new URLSearchParams(window.location.search).get('section');
  const isHome = !isAbout && (window.location.pathname === '/' || window.location.pathname === '/index.html') && !urlSection;

  // Toggle hero visibility: show on Home, hide on Work/Archive/About
  document.body.classList.toggle('no-hero', !isHome);

  // Always reset custom background color initially when loading any page/section
  document.documentElement.style.setProperty('--bg', '');
  document.body.classList.remove('cinematic-bg-active');

  if (isAbout) {
    if (siteConfigCache) loadAbout(siteConfigCache);
  } else if (isHome) {
    // ── Home tab: hero only — no gallery rendering ──
    // Clean up any gallery content left from a previous section visit
    const prevIntro = document.getElementById('work-intro');
    if (prevIntro) prevIntro.remove();
    if (dom.gallery) {
      dom.gallery.innerHTML = '';
      dom.gallery.classList.remove('work-editorial', 'work-editorial--custom');
      dom.gallery.style.height   = '';
      dom.gallery.style.position = '';
    }
  } else {
    // ── Section tab (My Work / Archive): render gallery, no hero ──
    const prevIntro = document.getElementById('work-intro');
    if (prevIntro) prevIntro.remove();
    if (dom.gallery) {
      dom.gallery.classList.remove('work-editorial', 'work-editorial--custom');
      dom.gallery.style.height   = '';
      dom.gallery.style.position = '';
    }

    if (dom.gallery) {
      try {
        let data;
        let currentSection = urlSection;
        if (!currentSection && siteConfigCache?.sections) {
          const archiveSec = siteConfigCache.sections.find(s => (s.nav_label || s.label || '').toLowerCase().trim() === 'archive');
          if (archiveSec) currentSection = archiveSec.slug;
        }
        if (!currentSection) currentSection = 'archive';
        
        state.section = currentSection;

        const isEditorial = (() => {
          if (!siteConfigCache?.sections) return true; // default to editorial
          const sec = siteConfigCache.sections.find(s => s.slug === state.section);
          if (!sec) return true;
          const lbl = (sec.nav_label || sec.label || '').toLowerCase().trim();
          return lbl !== 'archive';
        })();

        let imgSection = state.section;
        if (isEditorial && siteConfigCache?.sections) {
          const archiveSec = siteConfigCache.sections.find(s => (s.nav_label || s.label || '').toLowerCase().trim() === 'archive');
          if (archiveSec) {
            imgSection = archiveSec.slug;
          }
        }

        if (siteConfigCache?.initial_images && state.section === currentSection) {
          data = siteConfigCache.initial_images;
          delete siteConfigCache.initial_images; // Consume only once
          state.sectionCache.set(state.section, data);
        } else if (state.sectionCache.has(state.section)) {
          data = state.sectionCache.get(state.section);
        } else {
          const imgRes = await fetch(`/api/images?section=${encodeURIComponent(imgSection)}`);
          data = await imgRes.json();
          state.sectionCache.set(state.section, data);
        }

        if (Array.isArray(data) && data.length > 0) {
          state.images = data;

          if (isEditorial) {
            let layoutData = null;
            try {
              const layoutRes = await fetch(`/api/layout?section=${encodeURIComponent(state.section)}`);
              if (layoutRes.ok) {
                const layoutJson = await layoutRes.json();
                layoutData = layoutJson.layout;
              }
            } catch { /* gracefully ignore — will use default layout */ }
            renderWorkLayout(data, layoutData);
          } else {
            renderGallery();
          }

          renderLightboxSlides();
        } else {
          dom.gallery.innerHTML = '<p style="padding:40px 22px;color:rgba(240,240,237,0.4);font-size:0.9rem;">No images yet.</p>';
        }
      } catch (err) {
        console.error('[images] Failed to load images', err);
        dom.gallery.innerHTML = '<p style="padding:40px 22px;color:rgba(240,240,237,0.4);font-size:0.9rem;">Could not load images.</p>';
      }
    }
  }

  // Asynchronous page view logging
  logAnalyticsEvent('page_view', isAbout ? 'about' : isHome ? 'home' : state.section);

  // Re-sample hero brightness after each page/section load
  scheduleContrastEval(700);
}

/**
 * Handles hover/touch predictive preloading using high-performance imagesrcset attributes
 * to ensure exact-resolution preloading without double fetches.
 */
function setupNavPrefetch() {
  if (!dom.siteNav || dom.siteNav.dataset.prefetchSetup === 'true') return;
  dom.siteNav.dataset.prefetchSetup = 'true';

  const prefetch = (e) => {
    const a = e.target.closest('a');
    if (!a || !a.href.includes('section=')) return;
    try {
      const url = new URL(a.href, window.location.origin);
      const s = url.searchParams.get('section');
      if (s && !state.sectionCache.has(s)) {
        fetch(`/api/images?section=${encodeURIComponent(s)}`)
          .then(res => res.json())
          .then(data => {
            state.sectionCache.set(s, data);
            data.slice(0, 2).forEach(img => {
              const link = document.createElement('link');
              link.rel = 'preload';
              link.as = 'image';
              link.href = img.public_url_grid_thumb || img.public_url_thumb;

              if (img.public_url_grid_thumb && img.public_url_thumb) {
                link.setAttribute('imagesrcset', `${img.public_url_grid_thumb} 600w, ${img.public_url_thumb} 1600w`);
                if (img.is_wide) {
                  link.setAttribute('imagesizes', '(min-width: 1000px) 50vw, (min-width: 700px) 67vw, 50vw');
                } else {
                  link.setAttribute('imagesizes', '(min-width: 1000px) 25vw, (min-width: 700px) 33vw, 50vw');
                }
              }

              link.setAttribute('fetchpriority', 'low');
              document.head.appendChild(link);
            });
          })
          .catch(() => { });
      }
    } catch (e) { }
  };
  dom.siteNav.addEventListener('mouseover', prefetch, { passive: true });
  dom.siteNav.addEventListener('touchstart', prefetch, { passive: true });
}

/**
 * Configures dynamic page metadata, site title, navigation active states,
 * kicker text, and boots the slideshow.
 */
let navPointer = null;
let suppressNextNavClick = false;

function updateLiquidNavPill(noTransition = false) {
  const nav = dom.siteNav || document.querySelector('nav');
  const activeLink = nav?.querySelector('a.active');

  if (!nav || !activeLink) return;

  if (noTransition) {
    nav.classList.add('nav-dragging');
  }

  nav.style.setProperty('--nav-pill-x', `${activeLink.offsetLeft}px`);
  nav.style.setProperty('--nav-pill-w', `${activeLink.offsetWidth}px`);
  nav.style.setProperty('--nav-pill-scale-x', '1');
  nav.style.setProperty('--nav-pill-scale-y', '1');
  nav.style.setProperty('--nav-pill-glare-x', '30%');

  if (noTransition) {
    // Force a style/layout reflow
    nav.offsetHeight;
    nav.classList.remove('nav-dragging');
  }
}

function setActiveNavLink(link) {
  const nav = dom.siteNav || document.querySelector('nav');
  if (!nav || !link) return;

  nav.querySelectorAll('a').forEach(a => {
    a.classList.toggle('active', a === link);
  });

  updateLiquidNavPill();
}

function getClosestNavLink(nav, clientX) {
  const links = Array.from(nav.querySelectorAll('a'));
  let closest = null;
  let closestDistance = Infinity;

  for (const link of links) {
    const rect = link.getBoundingClientRect();
    const centre = rect.left + rect.width / 2;
    const distance = Math.abs(clientX - centre);

    if (distance < closestDistance) {
      closest = link;
      closestDistance = distance;
    }
  }

  return closest;
}

async function goToNavLink(link) {
  if (!link) return;

  const currentBase = window.location.pathname + window.location.search;
  const targetBase = link.pathname + link.search;

  setActiveNavLink(link);

  if (targetBase === currentBase) {
    requestAnimationFrame(() => updateLiquidNavPill(false));
    return;
  }

  window.history.pushState({}, '', link.href);
  _lastRoutedBase = targetBase;

  await handleRoute(link.href);

  requestAnimationFrame(() => updateLiquidNavPill(false));
}

function setupLiquidNavDrag() {
  const nav = dom.siteNav || document.querySelector('nav');
  if (!nav || nav.dataset.liquidDragSetup === 'true') return;

  nav.dataset.liquidDragSetup = 'true';

  nav.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;

    const targetLink = e.target.closest('a');
    if (!targetLink) return;

    const activeLink = nav.querySelector('a.active') || targetLink;

    navPointer = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLink: activeLink,
      targetLink: targetLink,
      didDrag: false,
    };

    nav.setPointerCapture?.(e.pointerId);
  });

  nav.addEventListener('pointermove', (e) => {
    if (!navPointer || navPointer.id !== e.pointerId) return;

    const rawDx = e.clientX - navPointer.startX;
    const rawDy = e.clientY - navPointer.startY;

    if (!navPointer.didDrag && Math.abs(rawDx) < 5 && Math.abs(rawDy) < 5) return;

    navPointer.didDrag = true;
    nav.classList.add('nav-dragging');

    // Tactile logarithmic/rubber-band damping on pointer displacement
    const dx = Math.sign(rawDx) * Math.log1p(Math.abs(rawDx) * 0.02) * 25;

    const navRect = nav.getBoundingClientRect();
    const startLink = navPointer.startLink;
    const startX = startLink.offsetLeft;
    const startW = startLink.offsetWidth;

    // Distort pill width and position based on direction of drag
    let L, R;
    if (dx >= 0) {
      L = startX + dx * 0.15;
      R = startX + startW + dx * 0.85;
    } else {
      L = startX + dx * 0.85;
      R = startX + startW + dx * 0.15;
    }

    // Constraints to maintain layout bounds
    L = Math.max(3, L);
    R = Math.min(nav.offsetWidth - 3, R);
    const W = Math.max(startW * 0.9, R - L);
    const X = L;

    // Calculate visual stretch amount, clamped subtly to scaleX [0.96, 1.08] and scaleY [0.96, 1.02]
    const stretch = (W - startW) / startW;
    let scaleX, scaleY;
    if (stretch >= 0) {
      scaleX = 1 + Math.min(stretch, 0.08);
      scaleY = 1 - Math.min(stretch * 0.5, 0.04);
    } else {
      scaleX = 1 + Math.max(stretch, -0.04);
      scaleY = 1 - Math.max(stretch * 0.5, -0.02);
    }
    const clampedScaleX = Math.max(0.96, Math.min(1.08, scaleX));
    const clampedScaleY = Math.max(0.96, Math.min(1.02, scaleY));

    // Calculate dynamic glare shift (radial gradient light source reflection movement)
    const glareX = Math.max(10, Math.min(50, 30 + (dx / startW) * 20));

    nav.style.setProperty('--nav-pill-x', `${X}px`);
    nav.style.setProperty('--nav-pill-w', `${W}px`);
    nav.style.setProperty('--nav-pill-scale-x', `${clampedScaleX}`);
    nav.style.setProperty('--nav-pill-scale-y', `${clampedScaleY}`);
    nav.style.setProperty('--nav-pill-glare-x', `${glareX}%`);
  });

  nav.addEventListener('pointerup', async (e) => {
    if (!navPointer || navPointer.id !== e.pointerId) return;

    const wasDrag = navPointer.didDrag;
    const clickedLink = navPointer.targetLink;

    navPointer = null;
    nav.classList.remove('nav-dragging');
    nav.releasePointerCapture?.(e.pointerId);

    if (wasDrag) {
      const chosenLink = getClosestNavLink(nav, e.clientX);
      
      // Update browser history and route to section
      suppressNextNavClick = true;
      await goToNavLink(chosenLink);
      
      setTimeout(() => {
        suppressNextNavClick = false;
      }, 50);
    } else {
      if (clickedLink) {
        suppressNextNavClick = true;
        await goToNavLink(clickedLink);
        
        setTimeout(() => {
          suppressNextNavClick = false;
        }, 50);
      } else {
        requestAnimationFrame(() => updateLiquidNavPill(false));
      }
    }
  });

  nav.addEventListener('pointercancel', () => {
    navPointer = null;
    suppressNextNavClick = false;
    nav.classList.remove('nav-dragging');
    requestAnimationFrame(() => updateLiquidNavPill(false));
  });

  nav.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    
    e.preventDefault();
    e.stopImmediatePropagation();

    if (suppressNextNavClick) {
      suppressNextNavClick = false;
      return;
    }

    if (link) {
      goToNavLink(link);
    }
  }, true);
}

function setupLiquidHoverEffects() {
  const elements = [];
  const nav = dom.siteNav || document.querySelector('nav');
  if (nav) elements.push(nav);
  
  elements.forEach(el => {
    if (el.dataset.liquidHoverSetup === 'true') return;
    el.dataset.liquidHoverSetup = 'true';
    
    el.addEventListener('pointermove', (e) => {
      if (el.classList.contains('nav-dragging')) return;
      
      if (el._resetRaf) {
        cancelAnimationFrame(el._resetRaf);
        el._resetRaf = null;
      }
      
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const normX = (x / rect.width) * 2 - 1;
      const normY = (y / rect.height) * 2 - 1;
      
      el.style.setProperty('--tilt-x', normX.toFixed(3));
      el.style.setProperty('--tilt-y', normY.toFixed(3));
      
      const glareX = (x / rect.width) * 100;
      const glareY = (y / rect.height) * 100;
      el.style.setProperty('--glare-x', `${glareX.toFixed(1)}%`);
      el.style.setProperty('--glare-y', `${glareY.toFixed(1)}%`);
    });
    
    el.addEventListener('pointerleave', () => {
      if (el._resetRaf) {
        cancelAnimationFrame(el._resetRaf);
      }
      
      let currentX = parseFloat(el.style.getPropertyValue('--tilt-x')) || 0;
      let currentY = parseFloat(el.style.getPropertyValue('--tilt-y')) || 0;
      
      const duration = 250;
      const start = performance.now();
      
      function reset() {
        const elapsed = performance.now() - start;
        const progress = Math.min(elapsed / duration, 1);
        const ease = progress * (2 - progress);
        
        const nextX = currentX * (1 - ease);
        const nextY = currentY * (1 - ease);
        
        el.style.setProperty('--tilt-x', nextX.toFixed(3));
        el.style.setProperty('--tilt-y', nextY.toFixed(3));
        
        const currentGlareX = parseFloat(el.style.getPropertyValue('--glare-x')) || 50;
        const currentGlareY = parseFloat(el.style.getPropertyValue('--glare-y')) || 20;
        const nextGlareX = currentGlareX + (50 - currentGlareX) * ease;
        const nextGlareY = currentGlareY + (20 - currentGlareY) * ease;
        
        el.style.setProperty('--glare-x', `${nextGlareX.toFixed(1)}%`);
        el.style.setProperty('--glare-y', `${nextGlareY.toFixed(1)}%`);
        
        if (progress < 1) {
          el._resetRaf = requestAnimationFrame(reset);
        } else {
          el.style.removeProperty('--tilt-x');
          el.style.removeProperty('--tilt-y');
          el.style.removeProperty('--glare-x');
          el.style.removeProperty('--glare-y');
          el._resetRaf = null;
        }
      }
      el._resetRaf = requestAnimationFrame(reset);
    });
  });
}

/**
 * Drives the SVG liquid-lens filter reactively from mouse position.
 * The feTurbulence baseFrequency shifts as the cursor moves across the
 * glass element, so the background image visibly warps and refracts
 * in real time — not static blur.
 */
function setupLiquidGlassReactivity() {
  // Grab the live SVG filter elements so we can mutate their attributes each frame
  const turbulence = document.querySelector('#liquid-lens-backdrop feTurbulence');
  const displacement = document.querySelector('#liquid-lens-backdrop feDisplacementMap');
  if (!turbulence || !displacement) return;

  const nav = dom.siteNav || document.querySelector('nav');
  const glassEls = nav ? [nav] : [];

  // Smoothed internal state
  let targetFreqX = 0.015;
  let targetFreqY = 0.015;
  let currentFreqX = 0.015;
  let currentFreqY = 0.015;
  let targetScale = 18;
  let currentScale = 18;
  let animRaf = null;
  let isHovering = false;

  // Base frequency range: rest vs hovered
  const REST_FREQ = 0.015;
  const HOVER_FREQ_X_RANGE = 0.018; // delta from rest when cursor is at edge
  const HOVER_FREQ_Y_RANGE = 0.012;
  const REST_SCALE = 18;
  const HOVER_SCALE = 32;

  function animateFilter() {
    // Smooth towards target with exponential decay (feels springy/liquid)
    const lerpFactor = 0.1;
    currentFreqX += (targetFreqX - currentFreqX) * lerpFactor;
    currentFreqY += (targetFreqY - currentFreqY) * lerpFactor;
    currentScale += (targetScale - currentScale) * lerpFactor;

    turbulence.setAttribute('baseFrequency', `${currentFreqX.toFixed(5)} ${currentFreqY.toFixed(5)}`);
    displacement.setAttribute('scale', currentScale.toFixed(2));

    // Keep running while hovering or while values are still settling
    const settled =
      Math.abs(currentFreqX - targetFreqX) < 0.0001 &&
      Math.abs(currentFreqY - targetFreqY) < 0.0001 &&
      Math.abs(currentScale - targetScale) < 0.1;

    if (!settled || isHovering) {
      animRaf = requestAnimationFrame(animateFilter);
    } else {
      animRaf = null;
    }
  }

  function startAnim() {
    if (!animRaf) animRaf = requestAnimationFrame(animateFilter);
  }

  glassEls.forEach(el => {
    el.addEventListener('pointermove', (e) => {
      isHovering = true;
      const rect = el.getBoundingClientRect();
      // Normalised cursor position: -1 (left/top) to +1 (right/bottom)
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;

      // Map cursor position to turbulence frequency shift
      targetFreqX = REST_FREQ + nx * HOVER_FREQ_X_RANGE * 0.5;
      targetFreqY = REST_FREQ + Math.abs(ny) * HOVER_FREQ_Y_RANGE;
      targetScale = REST_SCALE + (1 - Math.abs(nx) * 0.5) * (HOVER_SCALE - REST_SCALE);

      startAnim();
    }, { passive: true });

    el.addEventListener('pointerleave', () => {
      isHovering = false;
      // Return to rest state
      targetFreqX = REST_FREQ;
      targetFreqY = REST_FREQ;
      targetScale = REST_SCALE;
      startAnim();
    }, { passive: true });
  });
}

function applyConfig(config) {
  const site_title = config.site_title || 'Will Davies';
  const sections = config.sections || [];
  const isAboutPage = window.location.pathname.includes('/about');
  const urlSection = new URLSearchParams(window.location.search).get('section');
  const isHomePage = !isAboutPage && !urlSection &&
    (window.location.pathname === '/' || window.location.pathname === '/index.html');
  const sectionConfig = sections.find(s => s.slug === state.section);

  if (isAboutPage) {
    document.title = `${config.about_title || 'About'} — ${site_title}`;
  } else if (isHomePage) {
    document.title = site_title;
  } else if (sectionConfig && sectionConfig.slug !== 'archive') {
    document.title = `${sectionConfig.label} — ${site_title}`;
  } else {
    document.title = site_title;
  }

  if (dom.siteTitle && dom.siteTitle.querySelector('a')) {
    dom.siteTitle.querySelector('a').textContent = site_title;
  }

  // Dynamic Navigation menu rendering
  // Force rebuild if: empty, not yet marked built, OR missing the Home link (stale nav from old code)
  const hasHomeLink = !!dom.siteNav?.querySelector('a[href="/"]');
  if (dom.siteNav && (dom.siteNav.children.length === 0 || dom.siteNav.dataset.built !== 'true' || !hasHomeLink)) {
    dom.siteNav.innerHTML = '';

    // ── Home link (first) ──
    const homeLink = document.createElement('a');
    homeLink.href = '/';
    homeLink.textContent = 'Home';
    if (isHomePage) homeLink.classList.add('active');
    dom.siteNav.appendChild(homeLink);

    // ── Section links ──
    for (const s of sections) {
      const a = document.createElement('a');
      a.href = `/?section=${encodeURIComponent(s.slug)}`;
      a.textContent = s.nav_label || s.label;
      if (!isAboutPage && !isHomePage && s.slug === state.section) a.classList.add('active');
      dom.siteNav.appendChild(a);
    }

    // ── About link (last) ──
    const aboutLink = document.createElement('a');
    aboutLink.href = '/about';
    aboutLink.textContent = config.about_title || 'About';
    if (isAboutPage) aboutLink.classList.add('active');
    dom.siteNav.appendChild(aboutLink);
    dom.siteNav.dataset.built = 'true';
  } else if (dom.siteNav) {
    const allLinks = dom.siteNav.querySelectorAll('a');
    allLinks.forEach(a => {
      const url = new URL(a.href, window.location.origin);
      if (url.pathname === '/about') {
        a.classList.toggle('active', isAboutPage);
      } else if (!url.searchParams.get('section') && url.pathname === '/') {
        // Home link — active only when on the bare home page
        a.classList.toggle('active', isHomePage);
      } else {
        const s = url.searchParams.get('section');
        a.classList.toggle('active', !isAboutPage && !isHomePage && s === state.section);
      }
    });
  }

  // Hero slideshow — only boot when we're on the Home tab
  if (isHomePage) {
    // Find the first non-archive section to use for the hero slideshow
    const heroSection = sections.find(s => (s.nav_label || s.label || '').toLowerCase().trim() !== 'archive') || sections[0];
    if (heroSection) {
      if (heroSection.heroes && heroSection.heroes.length > 0) {
        initHeroSlideshow(heroSection.heroes);
      }
    } else if (sectionConfig) {
      // Fallback: use the currently resolved section
      if (sectionConfig.heroes?.length > 0) initHeroSlideshow(sectionConfig.heroes);
    }
  }
}

/**
 * Fallback static navigation layout if database is unavailable.
 */
function applyFallbackNav() {
  const isAboutPage = window.location.pathname.includes('/about');
  const urlSection = new URLSearchParams(window.location.search).get('section');
  const isHomePage = !isAboutPage && !urlSection &&
    (window.location.pathname === '/' || window.location.pathname === '/index.html');
  if (dom.siteNav) {
    dom.siteNav.innerHTML = `
      <a href="/"${isHomePage ? ' class="active"' : ''}>Home</a>
      <a href="/?section=archive"${!isAboutPage && !isHomePage && state.section === 'archive' ? ' class="active"' : ''}>Archive</a>
      <a href="/?section=studies"${!isAboutPage && !isHomePage && state.section === 'studies' ? ' class="active"' : ''}>Studies</a>
      <a href="/about"${isAboutPage ? ' class="active"' : ''}>About</a>
    `;
  }
}

/**
 * Populates and initialises the About page content, social links,
 * and forms standard POST actions for the message/contact form.
 */
function loadAbout(config) {
  const content = document.getElementById('about-content');
  if (!content) return;

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
  if (config.contact_email) links.push(`<a href="mailto:${escapeHtml(config.contact_email)}">${escapeHtml(config.contact_email)}</a>`);
  if (config.instagram_url) links.push(`<a href="${escapeHtml(config.instagram_url)}" target="_blank" rel="noopener">Instagram ↗</a>`);
  if (links.length > 0) {
    textCol += `<div class="about-links reveal" style="animation-delay: 450ms;">${links.join('')}</div>`;
  }

  textCol += `
    <form class="contact-form reveal" id="contact-form" style="animation-delay: 550ms; margin-top: 28px;">
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
        <textarea id="message" name="message" rows="3" required placeholder="How can I help?"></textarea>
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
    html += textCol;
  }

  content.innerHTML = html;

  // Contact form submission logic
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

  // Only intercept same-origin, standard navigations
  if (a.origin !== window.location.origin) return;
  if (a.target === '_blank') return;
  if (a.hasAttribute('download')) return;

  // Skip hash-only anchor jumps (handled natively by browser layout engine)
  const currentBase = window.location.pathname + window.location.search;
  const targetBase = a.pathname + a.search;
  if (a.hash && targetBase === currentBase) return;

  e.preventDefault();
  const targetUrl = a.href;

  window.history.pushState({}, '', targetUrl);
  _lastRoutedBase = a.pathname + a.search;
  await handleRoute(targetUrl);
});

// Guard POP state to differentiate hash scroll from true route shifts
window.addEventListener('popstate', () => {
  const currentBase = window.location.pathname + window.location.search;
  if (currentBase === _lastRoutedBase) return;
  _lastRoutedBase = currentBase;
  handleRoute(window.location.href);
});

/**
 * Dynamic SPA route handler that fetches page content, triggers ViewTransitions,
 * scrolls to the top, and re-boots the page.
 */
async function handleRoute(url) {
  // Clean up slideshow before route change
  cleanupHeroSlideshow();

  const urlObj = new URL(url);
  const newSection = urlObj.searchParams.get('section');
  const isHome = urlObj.pathname === '/' || urlObj.pathname === '/index.html';
  const hasGallery = !!document.getElementById('gallery');

  // Fast client-side navigation (same HTML shell — Home ↔ sections, sections ↔ sections)
  // Works for: Home→Section, Section→Section, Section→Home (no-section)
  if (isHome && hasGallery) {
    if (newSection) state.section = newSection;
    const performUpdate = async () => {
      document.documentElement.classList.remove('smooth-scroll-active');
      window.scrollTo(0, 0);
      await initPage();
    };
    if (document.startViewTransition) {
      const transition = document.startViewTransition(performUpdate);
      window.activeViewTransition = transition.finished;
      transition.finished.finally(() => {
        if (window.activeViewTransition === transition.finished) {
          window.activeViewTransition = null;
        }
      });
    } else {
      performUpdate();
    }
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

    let resolvedSection = newSection;
    if (!resolvedSection && siteConfigCache?.sections) {
      const archiveSec = siteConfigCache.sections.find(s => (s.nav_label || s.label || '').toLowerCase().trim() === 'archive');
      if (archiveSec) resolvedSection = archiveSec.slug;
    }
    state.section = resolvedSection || 'archive';

    const performUpdate = async () => {
      const appContent = document.getElementById('app-content');

      // Strip transition animations on load to prevent content flashing
      newContent.querySelectorAll('.reveal').forEach(el => {
        el.classList.remove('reveal');
        el.style.opacity = '1';
        el.style.transform = 'none';
      });

      appContent.innerHTML = newContent.innerHTML;
      document.documentElement.classList.remove('smooth-scroll-active');
      window.scrollTo(0, 0);

      document.title = doc.title;
      await initPage();
    };

    if (document.startViewTransition) {
      const transition = document.startViewTransition(() => performUpdate());
      window.activeViewTransition = transition.finished;
      transition.finished.finally(() => {
        if (window.activeViewTransition === transition.finished) {
          window.activeViewTransition = null;
        }
      });
    } else {
      performUpdate();
    }
  } catch (err) {
    console.error('Routing failed', err);
    window.location.href = url;
  }
}

// ─── Header hide scroll behavior ────────────────────────────────────────────────
let lastScrollY = window.scrollY;
let scrollTicking = false;

window.addEventListener('scroll', () => {
  if (!scrollTicking) {
    window.requestAnimationFrame(() => {
      const y = window.scrollY;
      if (y < 80) {
        dom.header?.classList.remove('hidden-header', 'scrolled');
      } else {
        const goingDown = y > lastScrollY;
        dom.header?.classList.toggle('hidden-header', goingDown);
        dom.header?.classList.toggle('scrolled', !goingDown);
      }
      lastScrollY = y;
      scrollTicking = false;
    });
    scrollTicking = true;
  }
}, { passive: true });

// Smooth scroll target helper
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) {
    document.documentElement.classList.remove('smooth-scroll-active');
    return;
  }
  document.documentElement.classList.add('smooth-scroll-active');
}, { capture: true });

// ─── Service Worker Registration ────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      for (const registration of registrations) {
        registration.unregister().then(success => {
          if (success) console.log('[ServiceWorker] Unregistered stale service worker on localhost');
        });
      }
    });
  } else {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .catch(err => console.warn('[ServiceWorker] Registration failed:', err));
    });
  }
}

// Idempotent BFCache restore handler
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    console.log('[bfcache] Page restored from BFCache, re-initializing...');
    initPage();
  }
});

window.addEventListener('resize', () => {
  requestAnimationFrame(() => updateLiquidNavPill(true));
});

window.addEventListener('load', () => {
  requestAnimationFrame(() => updateLiquidNavPill(true));
});

// Cinematic background mouse reactivity (subtle parallax drift) - DISABLED
// let _mouseRequestFrame = null;
// window.addEventListener('mousemove', (e) => {
//   if (!document.body.classList.contains('cinematic-bg-active')) return;
//   if (_mouseRequestFrame) cancelAnimationFrame(_mouseRequestFrame);
//   _mouseRequestFrame = requestAnimationFrame(() => {
//     const dx = e.clientX - window.innerWidth / 2;
//     const dy = e.clientY - window.innerHeight / 2;
//     document.documentElement.style.setProperty('--mouse-x', `${dx}px`);
//     document.documentElement.style.setProperty('--mouse-y', `${dy}px`);
//   });
// });

// Bootstrap initial load
initPage();
