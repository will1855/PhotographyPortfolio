'use strict';

// Resolve initial section from URL parameters
const params = new URLSearchParams(window.location.search);
const initialSection = params.get('section') || 'archive';

// Centralised mutable state object
export const state = {
  heroIsVisible: true,
  heroObserver: null,
  section: initialSection,
  images: [],
  currentIndex: 0,
  startX: 0,
  startY: 0,
  heroSlides: [],
  heroIndex: 0,
  heroTimer: null,
  sectionCache: new Map(),

  // Zoom & Swipe State
  zoomScale: 1,
  lastZoomScale: 1,
  initialPinchDistance: 0,
  isPinching: false,
  translateX: 0,
  translateY: 0,
  panStartX: 0,
  panStartY: 0,
  isSwipingVertical: false,
  isSwipingHorizontal: false,
  
  // Lightbox sequence tracker
  lightboxOpenId: 0
};

// Dynamic DOM selector registry (prevents stale nodes during page transitions)
export const dom = {
  get gallery() { return document.getElementById('gallery'); },
  get lightboxSlider() { return document.getElementById('lightbox-slider'); },
  get lightboxClose() { return document.getElementById('lightbox-close'); },
  get heroMedia() { return document.getElementById('hero-media'); },
  get heroKicker() { return document.getElementById('hero-kicker'); },
  get heroLink() { return document.getElementById('hero-link'); },
  get header() { return document.getElementById('site-header'); },
  get siteNav() { return document.getElementById('site-nav'); },
  get siteTitle() { return document.getElementById('site-title'); },
  get lightbox() { return document.getElementById('lightbox'); }
};

/**
 * Diagnostic logger that prints which image URLs are loaded, and of what type (thumb vs full).
 * Enabled if '?diagnostic=true' is in the URL query string or localStorage.getItem('diagnostic') === 'true'.
 */
export function logImageLoad(url, type) {
  if (!url) return;
  const isDiagnostic = window.location.search.includes('diagnostic') ||
                       localStorage.getItem('diagnostic') === 'true';
  if (isDiagnostic) {
    console.log(`%c[Image Diagnostic] Loading ${type}: ${url}`, 'color: #00ebae; font-weight: bold; background: #121212; padding: 2px 6px; border-radius: 4px;');
  }
}

