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
      
      // If inactive slide, set src now (deferred from server load to save initial FCP payload)
      if (i !== state.heroIndex) {
        img.src = h.thumb_url;
      }
      
      img.dataset.fullUrl = h.full_url;

      const loadFullRes = () => {
        // Remove the loading blur as soon as the standard thumbnail is complete
        if (img.complete) {
          img.classList.remove('loading');
        } else {
          img.onload = () => {
            img.classList.remove('loading');
          };
        }

        // Load the crystal-clear, full-resolution original photograph in the background
        if (img.dataset.fullLoaded === 'true') {
          return;
        }
        const full = new Image();
        if (i === state.heroIndex) full.fetchPriority = 'high';
        full.src = h.full_url;
        full.onload = () => {
          img.src = h.full_url;
          img.dataset.fullLoaded = 'true';
        };
      };

      div.loadFullRes = loadFullRes;

      if (i === state.heroIndex) {
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
      img.src = h.thumb_url;
      img.classList.add('loading');
      img.alt = 'Hero image';
      if (h.focal_point && h.focal_point !== 'center') {
        img.style.setProperty('--mobile-focal-point', h.focal_point);
      }
      div.appendChild(img);
      dom.heroMedia.appendChild(div);
      state.heroSlides.push(div);

      img.dataset.fullUrl = h.full_url;

      const loadFullRes = () => {
        // Remove the loading blur as soon as the standard thumbnail is complete
        if (img.complete) {
          img.classList.remove('loading');
        } else {
          img.onload = () => {
            img.classList.remove('loading');
          };
        }

        // Load the crystal-clear, full-resolution original photograph in the background
        if (img.dataset.fullLoaded === 'true') {
          return;
        }
        const full = new Image();
        if (i === state.heroIndex) full.fetchPriority = 'high';
        full.src = h.full_url;
        full.onload = () => {
          img.src = h.full_url;
          img.dataset.fullLoaded = 'true';
        };
      };

      div.loadFullRes = loadFullRes;

      if (i === state.heroIndex) {
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
  
  // Trigger full-res load for the incoming slide
  if (state.heroSlides[state.heroIndex].loadFullRes) {
    state.heroSlides[state.heroIndex].loadFullRes();
  }
  
  state.heroSlides[state.heroIndex].classList.add('active');
}
