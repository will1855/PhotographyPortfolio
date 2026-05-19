'use strict';

import { state, dom } from './state.js';

/**
 * Initialises the hero slideshow. Reuses server-side pre-rendered slides if available
 * for instant paint, falling back to client-side DOM creation.
 * @param {Array<Object>} heroes - Array of hero image data objects
 */
export function initHeroSlideshow(heroes) {
  if (!dom.heroMedia) return;
  
  // Use server-provided index if available for consistency with preloading
  if (window.INITIAL_DATA && typeof window.INITIAL_DATA.initial_hero_index === 'number') {
    state.heroIndex = window.INITIAL_DATA.initial_hero_index;
    delete window.INITIAL_DATA.initial_hero_index;
  } else {
    state.heroIndex = heroes.length > 0 ? Math.floor(Math.random() * heroes.length) : 0;
  }

  const existingSlides = dom.heroMedia.querySelectorAll('.hero-slide');
  if (existingSlides.length === heroes.length) {
    // 1. Re-use server pre-rendered slides for instant paint
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
      img.addEventListener('error', handleImgError, { once: true });
      if (img.complete && img.naturalWidth === 0) {
        handleImgError();
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
        }
      };

      const loadFullRes = () => {
        // Ensure standard thumbnail is loaded
        loadSlideImage();

        // Remove the loading blur as soon as the standard thumbnail is complete
        if (img.complete) {
          img.classList.remove('loading');
        } else {
          img.onload = () => {
            img.classList.remove('loading');
          };
        }

        // Mobile performance: Skip full-resolution download on mobile devices (Rule 4 & 7)
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
          return;
        }

        // Load the crystal-clear, full-resolution original photograph in the background (desktop only, Rule 1 & 6)
        if (img.dataset.fullLoaded === 'true') {
          return;
        }
        const full = new Image();
        if (i === state.heroIndex) full.fetchPriority = 'high';
        full.onload = () => {
          img.removeAttribute('srcset');
          img.removeAttribute('sizes');
          img.src = h.full_url;
          img.dataset.fullLoaded = 'true';
        };
        full.src = h.full_url;
      };

      div.loadSlideImage = loadSlideImage;
      div.loadFullRes = loadFullRes;

      if (i === state.heroIndex) {
        loadSlideImage();
        loadFullRes();
      }
    });
  } else {
    // 2. Fallback: recreate slides from scratch if SSR mismatches
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
      img.addEventListener('error', handleImgError, { once: true });

      div.appendChild(img);
      dom.heroMedia.appendChild(div);
      state.heroSlides.push(div);

      img.dataset.fullUrl = h.full_url;

      const loadSlideImage = () => {
        if (!img.src || img.src === window.location.href || img.src === '') {
          img.srcset = img.dataset.srcset;
          img.src = img.dataset.src;
        }
      };

      const loadFullRes = () => {
        loadSlideImage();

        if (img.complete) {
          img.classList.remove('loading');
        } else {
          img.onload = () => {
            img.classList.remove('loading');
          };
        }

        // Mobile performance: Skip full-resolution download on mobile devices (Rule 4 & 7)
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
          return;
        }

        if (img.dataset.fullLoaded === 'true') {
          return;
        }
        const full = new Image();
        if (i === state.heroIndex) full.fetchPriority = 'high';
        full.onload = () => {
          img.removeAttribute('srcset');
          img.removeAttribute('sizes');
          img.src = h.full_url;
          img.dataset.fullLoaded = 'true';
        };
        full.src = h.full_url;
      };

      div.loadSlideImage = loadSlideImage;
      div.loadFullRes = loadFullRes;

      if (i === state.heroIndex) {
        loadSlideImage();
        loadFullRes();
      }
    });
  }

  // Ensure active slide is shown
  if (state.heroSlides[state.heroIndex]) {
    state.heroSlides[state.heroIndex].classList.add('active');
  }

  // Set up slide transition timer loop
  if (state.heroSlides.length > 1) {
    if (state.heroTimer) clearInterval(state.heroTimer);
    state.heroTimer = setInterval(() => {
      if (state.heroIsVisible) nextHeroSlide();
    }, 5000);
  }

  // IntersectionObserver to pause the transition interval loop when hero is scrolled out of view
  const heroSection = document.querySelector('.hero');
  if (heroSection) {
    if (state.heroObserver) state.heroObserver.disconnect();
    state.heroObserver = new IntersectionObserver((entries) => {
      state.heroIsVisible = entries[0].isIntersecting && entries[0].intersectionRatio >= 0.25;
    }, { threshold: [0.25] });
    state.heroObserver.observe(heroSection);
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
  setTimeout(() => {
    oldSlide.classList.remove('last-active');
  }, 2000);

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


