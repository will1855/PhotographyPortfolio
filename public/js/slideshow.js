'use strict';

import { state, dom, logImageLoad } from './state.js';

/**
 * Cleanly cancels all background slideshow processes, observers, and event listeners.
 */
export function cleanupHeroSlideshow() {
  if (state.heroTimer) {
    clearInterval(state.heroTimer);
    state.heroTimer = null;
  }
  if (state.heroObserver) {
    state.heroObserver.disconnect();
    state.heroObserver = null;
  }
  if (state.heroTimeouts) {
    state.heroTimeouts.forEach(clearTimeout);
    state.heroTimeouts = [];
  }
  if (state.heroAbortController) {
    state.heroAbortController.abort();
    state.heroAbortController = null;
  }
}

/**
 * Initialises the hero slideshow. Reuses server-side pre-rendered slides if available
 * for instant paint, falling back to client-side DOM creation.
 * @param {Array<Object>} heroes - Array of hero image data objects
 */
export function initHeroSlideshow(heroes) {
  if (!dom.heroMedia) return;
  
  try {
    console.log('[Image Diagnostic] Debug initHeroSlideshow: heroes.length=' + heroes.length + ' heroIndex=' + state.heroIndex);

    // Idempotency check: Clean up any existing slideshow interval or observers
  cleanupHeroSlideshow();

  // Create a new abort controller for this slideshow run
  state.heroAbortController = new AbortController();
  const { signal } = state.heroAbortController;

  // Use server-provided index if available for consistency with preloading
  if (window.INITIAL_DATA && typeof window.INITIAL_DATA.initial_hero_index === 'number') {
    state.heroIndex = window.INITIAL_DATA.initial_hero_index;
    delete window.INITIAL_DATA.initial_hero_index;
  } else {
    // If state.heroIndex is already valid and bounds-safe, keep it for idempotency on re-entry
    if (typeof state.heroIndex !== 'number' || state.heroIndex < 0 || state.heroIndex >= heroes.length) {
      state.heroIndex = heroes.length > 0 ? Math.floor(Math.random() * heroes.length) : 0;
    }
  }

  const existingSlides = dom.heroMedia.querySelectorAll('.hero-slide');
  let canReuse = false;

  // Check if we can safely reuse the existing DOM slides
  if (existingSlides.length === heroes.length && heroes.length > 0) {
    const firstImg = existingSlides[0].querySelector('img');
    if (firstImg) {
      const firstHero = heroes[0];
      if (firstImg.dataset.fullUrl === firstHero.full_url || firstImg.src === firstHero.thumb_url || firstImg.dataset.src === firstHero.thumb_url) {
        canReuse = true;
      }
    }
  }

  if (canReuse) {
    // 1. Re-use server pre-rendered or existing slides safely
    state.heroSlides = Array.from(existingSlides);
    
    heroes.forEach((h, i) => {
      const div = state.heroSlides[i];
      const img = div.querySelector('img');
      
      img.dataset.fullUrl = h.full_url;

      // Pure JS error fallback (Rule 6: CSP & security compliant, no inline onerror)
      const handleImgError = () => {
        img.removeAttribute('srcset');
        img.src = h.thumb_url;
      };

      // Bind listeners idempotently
      if (img.dataset.listenersBound !== 'true') {
        img.dataset.listenersBound = 'true';
        img.addEventListener('error', handleImgError, { once: true, signal });
        if (img.complete && img.naturalWidth === 0) {
          handleImgError();
        }
      }

      // Helper function to load the standard/srcset slide image (Rule 8: lazy load)
      const loadSlideImage = () => {
        if (!img.src || img.src === window.location.href || img.src === '') {
          const srcVal = img.dataset.src || h.thumb_url;
          const srcSetVal = img.dataset.srcset || (h.grid_thumb_url ? `${h.grid_thumb_url} 600w, ${h.thumb_url} 1600w` : null);
          
          if (srcSetVal) {
            img.srcset = srcSetVal;
            img.sizes = '100vw';
          }
          img.src = srcVal;
          logImageLoad(srcVal, 'hero-thumb (1600w WebP)');
        }
      };

      const loadFullRes = () => {
        // Ensure standard thumbnail is loaded
        loadSlideImage();

        // Idempotent blur removal helper
        const removeBlur = () => {
          img.classList.remove('loading');
        };

        // Remove the loading blur as soon as the standard thumbnail is complete/decoded
        if (img.complete) {
          if (img.naturalWidth > 0) {
            removeBlur();
          } else if (typeof img.decode === 'function') {
            img.decode().then(removeBlur).catch(removeBlur);
          } else {
            removeBlur();
          }
        } else {
          img.addEventListener('load', removeBlur, { once: true, signal });
          img.addEventListener('error', removeBlur, { once: true, signal });
          if (typeof img.decode === 'function') {
            img.decode().then(removeBlur).catch(removeBlur);
          }
          // Failsafe timeout: 2 seconds
          const failsafeTimeoutId = setTimeout(removeBlur, 2000);
          state.heroTimeouts.push(failsafeTimeoutId);
        }

        // Mobile performance: Skip full-resolution download on mobile devices (Rule 4 & 7)
        const isMobile = window.innerWidth <= 768;
        console.log('[Image Diagnostic] loadFullRes entry reuse: isMobile=' + isMobile + ' innerWidth=' + window.innerWidth);
        if (isMobile) {
          return;
        }

        if (img.dataset.fullLoaded === 'true') {
          return;
        }

        // Only upgrade the currently active desktop hero image
        // Introduce a slight delay (800ms) before downloading the heavy original full-res image.
        const delay = 800;
        const upgradeTimeoutId = setTimeout(() => {
          const currentMobile = window.innerWidth <= 768;
          console.log('[Image Diagnostic] Debug reuse: i=' + i + ' heroIndex=' + state.heroIndex + ' heroIsVisible=' + state.heroIsVisible + ' isMobile=' + currentMobile);
          if (currentMobile || i !== state.heroIndex || !state.heroIsVisible) {
            return;
          }
          if (img.dataset.fullLoaded === 'true') {
            return;
          }

          logImageLoad(h.full_url, 'hero-full-res-upgrade (Original)');

          const full = new Image();
          if (i === state.heroIndex) full.fetchPriority = 'high';
          full.onload = () => {
            img.removeAttribute('srcset');
            img.removeAttribute('sizes');
            img.src = h.full_url;
            img.dataset.fullLoaded = 'true';
            removeBlur();
          };
          full.onerror = () => {
            console.warn('[hero] Full-resolution image failed to load, keeping standard thumbnail sharp');
            removeBlur();
          };
          full.src = h.full_url;
        }, delay);
        state.heroTimeouts.push(upgradeTimeoutId);
      };

      div.loadSlideImage = loadSlideImage;
      div.loadFullRes = loadFullRes;

      if (i === state.heroIndex) {
        loadSlideImage();
        loadFullRes();
      }
    });
  } else {
    // 2. Fallback: recreate slides from scratch if SSR mismatches or switching sections
    dom.heroMedia.innerHTML = '';
    state.heroSlides = [];
    
    heroes.forEach((h, i) => {
      const div = document.createElement('div');
      div.className = 'hero-slide';
      const img = document.createElement('img');
      img.classList.add('loading');
      img.alt = 'Hero image';
      if (h.focal_point && h.focal_point !== 'center') {
        img.style.setProperty('--mobile-focal-point', h.focal_point);
      }
      
      // Store standard properties on dataset to prevent immediate auto-download (Rule 8)
      img.dataset.src = h.thumb_url;
      const gridThumb = h.grid_thumb_url || h.thumb_url; // Rule 9 fallback
      img.dataset.srcset = `${gridThumb} 600w, ${h.thumb_url} 1600w`;
      img.sizes = '100vw';
      
      // Pure JS error fallback (Rule 6: CSP & security compliant, no inline onerror)
      const handleImgError = () => {
        img.removeAttribute('srcset');
        img.src = h.thumb_url;
      };
      img.addEventListener('error', handleImgError, { once: true, signal });
      img.dataset.listenersBound = 'true';

      div.appendChild(img);
      dom.heroMedia.appendChild(div);
      state.heroSlides.push(div);

      img.dataset.fullUrl = h.full_url;

      const loadSlideImage = () => {
        if (!img.src || img.src === window.location.href || img.src === '') {
          img.srcset = img.dataset.srcset;
          img.src = img.dataset.src;
          logImageLoad(img.dataset.src, 'hero-thumb (1600w WebP)');
        }
      };

      const loadFullRes = () => {
        loadSlideImage();

        const removeBlur = () => {
          img.classList.remove('loading');
        };

        if (img.complete) {
          if (img.naturalWidth > 0) {
            removeBlur();
          } else if (typeof img.decode === 'function') {
            img.decode().then(removeBlur).catch(removeBlur);
          } else {
            removeBlur();
          }
        } else {
          img.addEventListener('load', removeBlur, { once: true, signal });
          img.addEventListener('error', removeBlur, { once: true, signal });
          if (typeof img.decode === 'function') {
            img.decode().then(removeBlur).catch(removeBlur);
          }
          // Failsafe timeout: 2 seconds
          const failsafeTimeoutId = setTimeout(removeBlur, 2000);
          state.heroTimeouts.push(failsafeTimeoutId);
        }

        // Mobile performance: Skip full-resolution download on mobile devices (Rule 4 & 7)
        const isMobile = window.innerWidth <= 768;
        console.log('[Image Diagnostic] loadFullRes entry fallback: isMobile=' + isMobile + ' innerWidth=' + window.innerWidth);
        if (isMobile) {
          return;
        }

        if (img.dataset.fullLoaded === 'true') {
          return;
        }

        // Only upgrade the currently active desktop hero image
        // Introduce a slight delay (800ms) before downloading the heavy original full-res image.
        const delay = 800;
        const upgradeTimeoutId = setTimeout(() => {
          const currentMobile = window.innerWidth <= 768;
          console.log('[Image Diagnostic] Debug fallback: i=' + i + ' heroIndex=' + state.heroIndex + ' heroIsVisible=' + state.heroIsVisible + ' isMobile=' + currentMobile);
          if (currentMobile || i !== state.heroIndex || !state.heroIsVisible) {
            return;
          }
          if (img.dataset.fullLoaded === 'true') {
            return;
          }

          logImageLoad(h.full_url, 'hero-full-res-upgrade (Original)');

          const full = new Image();
          if (i === state.heroIndex) full.fetchPriority = 'high';
          full.onload = () => {
            img.removeAttribute('srcset');
            img.removeAttribute('sizes');
            img.src = h.full_url;
            img.dataset.fullLoaded = 'true';
            removeBlur();
          };
          full.onerror = () => {
            console.warn('[hero] Full-resolution image failed to load, keeping standard thumbnail sharp');
            removeBlur();
          };
          full.src = h.full_url;
        }, delay);
        state.heroTimeouts.push(upgradeTimeoutId);
      };

      div.loadSlideImage = loadSlideImage;
      div.loadFullRes = loadFullRes;

      if (i === state.heroIndex) {
        loadSlideImage();
        loadFullRes();
      }
    });
  }

  // Cleanly reset active and last-active classes on all slides, showing only the active one
  state.heroSlides.forEach((slide, idx) => {
    if (idx === state.heroIndex) {
      slide.classList.remove('last-active');
      slide.classList.add('active');
    } else {
      slide.classList.remove('active', 'last-active');
    }
  });

  // Set up slide transition timer loop
  if (state.heroSlides.length > 1) {
    state.heroTimer = setInterval(() => {
      if (state.heroIsVisible) nextHeroSlide();
    }, 5000);
  }

  // IntersectionObserver to pause the transition interval loop when hero is scrolled out of view
  const heroSection = document.querySelector('.hero');
  if (heroSection) {
    state.heroObserver = new IntersectionObserver((entries) => {
      state.heroIsVisible = entries[0].isIntersecting && entries[0].intersectionRatio >= 0.25;
    }, { threshold: [0.25] });
    state.heroObserver.observe(heroSection);
  }

  } catch (err) {
    console.error('[Image Diagnostic] CRASH in initHeroSlideshow:', err.message, err.stack);
  }
}

/**
 * Triggers transition to the next hero slide.
 */
export function nextHeroSlide() {
  if (state.heroSlides.length < 2) return;
  
  const oldSlide = state.heroSlides[state.heroIndex];
  oldSlide.classList.add('last-active');
  oldSlide.classList.remove('active');
  
  // Remove last-active class after fade-out transition completes (2000ms buffer)
  const fadeTimeoutId = setTimeout(() => {
    oldSlide.classList.remove('last-active');
  }, 2000);
  state.heroTimeouts.push(fadeTimeoutId);

  state.heroIndex = (state.heroIndex + 1) % state.heroSlides.length;
  
  const nextSlide = state.heroSlides[state.heroIndex];

  // Load standard thumbnail (and srcset) for the incoming active slide
  if (nextSlide.loadSlideImage) {
    nextSlide.loadSlideImage();
  }

  // Trigger full-res load for the incoming slide (desktop only)
  if (nextSlide.loadFullRes) {
    nextSlide.loadFullRes();
  }
  
  nextSlide.classList.add('active');

  // Predictive Preloading: Load standard image for the slide AFTER the next one
  // so it is cached and ready before the transition (Rule 8)
  const preloadIndex = (state.heroIndex + 1) % state.heroSlides.length;
  const preloadSlide = state.heroSlides[preloadIndex];
  if (preloadSlide && preloadSlide.loadSlideImage) {
    preloadSlide.loadSlideImage();
  }
}



