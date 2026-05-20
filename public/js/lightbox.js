'use strict';

import { state, dom, logImageLoad } from './state.js';
import { logAnalyticsEvent } from './analytics.js';

// Module-scoped touch state
let startX = 0;
let startY = 0;
let isSwipingVertical = false;
let isSwipingHorizontal = false;
let currentTranslate = 0;
let isDragging = false;

/**
 * Calculates constrained dimensions for the lightbox image preserving aspect ratio.
 * @param {Object} imgData - Image metadata containing width & height
 * @returns {Object} { w, h } constrained dimensions
 */
export function calcLightboxSize(imgData) {
  const srcW  = imgData.width  || 3;
  const srcH  = imgData.height || 2;
  const vw    = window.innerWidth  * 0.94;
  const vh    = window.innerHeight * 0.92;
  const ratio = srcW / srcH;
  let w = vw, h = w / ratio;
  if (h > vh) { h = vh; w = h * ratio; }
  return { w: Math.round(w), h: Math.round(h) };
}

/**
 * Helper to apply dynamic size to image element.
 */
export function applyLightboxSize(imgData, imgEl) {
  const { w, h } = calcLightboxSize(imgData);
  imgEl.style.width  = `${w}px`;
  imgEl.style.height = `${h}px`;
}

/**
 * Lazy loads a specific lightbox slide index.
 * Creates image sub-elements on-the-fly and swaps high-res full photographs seamlessly.
 */
export function loadLightboxSlide(index, openId, delayReady = false, shouldLoadFull = false) {
  if (index < 0 || index >= state.images.length) return;
  const slide = dom.lightboxSlider.children[index];
  if (!slide) return;

  let thumbImg = slide.querySelector('.lightbox-thumb');
  let fullImg = slide.querySelector('.lightbox-full');

  if (!thumbImg) {
    thumbImg = document.createElement('img');
    thumbImg.className = 'lightbox-thumb';
    slide.appendChild(thumbImg);
  }
  if (!fullImg) {
    fullImg = document.createElement('img');
    fullImg.className = 'lightbox-full';
    slide.appendChild(fullImg);
  }

  if (thumbImg.dataset.loadedId === String(openId) && !shouldLoadFull) return;
  thumbImg.dataset.loadedId = openId;
  fullImg.dataset.loadedId = openId;

  const imgData = state.images[index];
  applyLightboxSize(imgData, thumbImg);
  applyLightboxSize(imgData, fullImg);

  if (!thumbImg.src) {
    thumbImg.src = imgData.public_url_thumb;
    logImageLoad(imgData.public_url_thumb, 'lightbox-thumb (1600w WebP)');
  }

  if (delayReady) {
    thumbImg.classList.remove('ready');
    thumbImg.dataset.delayReady = 'true';
    fullImg.classList.remove('ready');
    fullImg.dataset.delayReady = 'true';
  } else {
    delete thumbImg.dataset.delayReady;
    delete fullImg.dataset.delayReady;
    thumbImg.classList.add('ready');
  }

  if (fullImg.dataset.fullLoaded === 'true') {
    if (!fullImg.src) {
      fullImg.src = imgData.public_url_full;
      logImageLoad(imgData.public_url_full, 'lightbox-full-res (Original)');
    }
    if (fullImg.dataset.delayReady !== 'true') {
      fullImg.classList.add('ready');
    }
    return;
  }

  if (shouldLoadFull) {
    fullImg.src = imgData.public_url_full;
    logImageLoad(imgData.public_url_full, 'lightbox-full-res (Original)');
    fullImg.onload = () => {
      applyLightboxSize(imgData, fullImg);
      fullImg.dataset.fullLoaded = 'true';
      if (fullImg.dataset.delayReady !== 'true') {
        fullImg.classList.add('ready');
      }
    };
    fullImg.onerror = () => {
      console.warn(`[lightbox] slide ${index}: full-res failed to load`);
    };
  }
}

/**
 * Renders standard container slide divs for every item in state.images.
 */
export function renderLightboxSlides() {
  if (!dom.lightboxSlider) return;
  dom.lightboxSlider.innerHTML = '';
  state.images.forEach(() => {
    const slide = document.createElement('div');
    slide.className = 'lightbox-slide';
    dom.lightboxSlider.appendChild(slide);
  });
}

/**
 * Triggers full-screen lightbox opening zoom animations.
 * Clones the pre-rendered gallery thumbnail for zero-CLS movement.
 */
export function openLightbox(index) {
  state.currentIndex = index;
  const imgData = state.images[index];
  const openId  = ++state.lightboxOpenId;

  // ── Clone zoom transition: starts instantly utilizing cached thumbnail
  const thumbEl = dom.gallery.querySelectorAll('img')[index];
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

  // Jump slider to active item instantly before reveal
  dom.lightboxSlider.style.transition = 'none';
  dom.lightboxSlider.style.transform = `translateX(-${index * 100}vw)`;
  
  dom.lightbox.classList.remove('hidden');
  
  // Set up lightbox index tracker counter
  let counter = dom.lightbox.querySelector('.lightbox-counter');
  if (!counter) {
    counter = document.createElement('div');
    counter.className = 'lightbox-counter';
    dom.lightbox.appendChild(counter);
  }
  counter.textContent = `${index + 1} / ${state.images.length}`;

  if (imgData) {
    logAnalyticsEvent('lightbox_click', imgData.title || imgData.original_filename || imgData.id);
  }
  
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  document.body.style.paddingRight = `${scrollbarWidth}px`;
  document.body.classList.add('lightbox-open');

  // Load the active slide's thumbnails and prepare full-res photograph
  loadLightboxSlide(index, openId, true, true);

  // Defer neighbor slides preloading to yield thread for instant initial rendering
  setTimeout(() => {
    if (openId === state.lightboxOpenId) {
      loadLightboxSlide(index - 1, openId, false, false);
      loadLightboxSlide(index + 1, openId, false, false);
    }
  }, 50);

  setTimeout(() => {
    if (openId === state.lightboxOpenId) {
      clone?.remove();
      const activeSlide = dom.lightboxSlider.children[index];
      if (activeSlide) {
        const thumb = activeSlide.querySelector('.lightbox-thumb');
        const full = activeSlide.querySelector('.lightbox-full');
        if (thumb) {
          delete thumb.dataset.delayReady;
          thumb.classList.add('ready');
        }
        if (full) {
          delete full.dataset.delayReady;
          if (full.dataset.fullLoaded === 'true') {
            full.classList.add('ready');
          }
        }
      }
      dom.lightboxSlider.style.transition = '';
    } else {
      clone?.remove();
    }
  }, 420);
}

/**
 * Navigation handler between slides.
 */
export function updateLightbox() {
  resetZoom();
  const openId = ++state.lightboxOpenId;
  dom.lightboxSlider.style.transform = `translateX(-${state.currentIndex * 100}vw)`;
  
  // Render active slide thumbnails instantly
  loadLightboxSlide(state.currentIndex, openId, false, false);

  // Defer preloads to drop input delay (INP)
  setTimeout(() => {
    if (openId === state.lightboxOpenId) {
      loadLightboxSlide(state.currentIndex - 1, openId, false, false);
      loadLightboxSlide(state.currentIndex + 1, openId, false, false);
    }
  }, 50);

  // Defer heavy full-res image request until animation ends
  setTimeout(() => {
    if (openId === state.lightboxOpenId) {
      loadLightboxSlide(state.currentIndex, openId, false, true);
    }
  }, 100);

  const counter = dom.lightbox.querySelector('.lightbox-counter');
  if (counter) {
    counter.textContent = `${state.currentIndex + 1} / ${state.images.length}`;
  }

  const imgData = state.images[state.currentIndex];
  if (imgData) {
    logAnalyticsEvent('lightbox_click', imgData.title || imgData.original_filename || imgData.id);
  }
}

/**
 * Triggers lightbox closing zoom-out transition.
 */
export function closeLightbox() {
  ++state.lightboxOpenId;
  
  const thumbEl = dom.gallery?.querySelectorAll('img')[state.currentIndex];
  if (thumbEl && !dom.lightbox.classList.contains('hidden')) {
    const rect = thumbEl.getBoundingClientRect();
    const imgData = state.images[state.currentIndex];
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

  dom.lightbox.classList.add('hidden');
  document.body.classList.remove('lightbox-open');
  document.body.style.paddingRight = '';
  resetZoom();
}

/**
 * Helper to compute distance between two touch events (pinch gestures).
 */
export function getDistance(touch1, touch2) {
  const dx = touch1.clientX - touch2.clientX;
  const dy = touch1.clientY - touch2.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Helper to update zoom transform styles.
 */
export function updateImageTransform() {
  const slide = dom.lightboxSlider.children[state.currentIndex];
  if (!slide) return;
  const imgs = slide.querySelectorAll('.lightbox-thumb, .lightbox-full');
  imgs.forEach(img => {
    img.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.zoomScale})`;
    img.style.transition = (state.isPinching || isDragging) ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
  });
}

/**
 * Helper to reset zoom parameters.
 */
export function resetZoom() {
  state.zoomScale = 1;
  state.lastZoomScale = 1;
  state.translateX = 0;
  state.translateY = 0;
  const slides = dom.lightboxSlider.querySelectorAll('.lightbox-slide img');
  slides.forEach(img => {
    img.style.transform = '';
    img.style.transition = '';
  });
}

// ─── Event Bindings ────────────────────────────────────────────────────────────

// Key navigation listener
document.addEventListener('keydown', e => {
  if (!dom.lightbox || dom.lightbox.classList.contains('hidden')) return;
  if (e.key === 'ArrowRight') {
    state.currentIndex = (state.currentIndex + 1) % state.images.length;
    updateLightbox();
  } else if (e.key === 'ArrowLeft')  {
    state.currentIndex = (state.currentIndex - 1 + state.images.length) % state.images.length;
    updateLightbox();
  } else if (e.key === 'Escape') {
    closeLightbox();
  }
});

// Click background listener to close
dom.lightbox?.addEventListener('click', e => {
  if (e.target === dom.lightbox || e.target === dom.lightboxSlider || e.target.classList.contains('lightbox-slide')) {
    closeLightbox();
  }
});

dom.lightboxClose?.addEventListener('click', closeLightbox);

// Mobile touch pinch-to-zoom and swipe-to-dismiss listeners
dom.lightbox?.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    state.isPinching = true;
    isDragging = false;
    state.initialPinchDistance = getDistance(e.touches[0], e.touches[1]);
    state.lastZoomScale = state.zoomScale;
  } else if (e.touches.length === 1) {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isSwipingVertical = false;
    isSwipingHorizontal = false;
    
    if (state.zoomScale > 1) {
      isDragging = true;
      state.panStartX = e.touches[0].clientX - state.translateX;
      state.panStartY = e.touches[0].clientY - state.translateY;
    } else {
      isDragging = true;
      dom.lightboxSlider.style.transition = 'none';
      currentTranslate = -state.currentIndex * window.innerWidth;
    }
  }
}, { passive: true });

dom.lightbox?.addEventListener('touchmove', e => {
  if (state.isPinching && e.touches.length === 2) {
    const currentDistance = getDistance(e.touches[0], e.touches[1]);
    const ratio = currentDistance / state.initialPinchDistance;
    state.zoomScale = Math.min(Math.max(state.lastZoomScale * ratio, 1), 4);
    updateImageTransform();
  } else if (isDragging && e.touches.length === 1) {
    if (state.zoomScale > 1) {
      state.translateX = e.touches[0].clientX - state.panStartX;
      state.translateY = e.touches[0].clientY - state.panStartY;
      updateImageTransform();
    } else {
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const diffX = currentX - startX;
      const diffY = currentY - startY;

      // Lock swipe direction dynamically
      if (!isSwipingVertical && !isSwipingHorizontal) {
        if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 8) {
          isSwipingVertical = true;
        } else if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 8) {
          isSwipingHorizontal = true;
        }
      }

      if (isSwipingVertical) {
        const slide = dom.lightboxSlider.children[state.currentIndex];
        const imgs = slide?.querySelectorAll('.lightbox-thumb, .lightbox-full');
        if (imgs && imgs.length > 0) {
          imgs.forEach(img => {
            img.classList.add('swiping');
            img.style.transform = `translateY(${diffY}px)`;
          });
          // Backdrop transparency fade-out mapping during scroll dismissal
          const bgOpacity = Math.max(0.1, 0.72 - Math.abs(diffY) / 600);
          const blurAmount = Math.max(0, 18 - Math.abs(diffY) / 20);
          dom.lightbox.style.backgroundColor = `rgba(0,0,0,${bgOpacity})`;
          dom.lightbox.style.backdropFilter = `blur(${blurAmount}px)`;
          dom.lightbox.style.webkitBackdropFilter = `blur(${blurAmount}px)`;
        }
      } else {
        dom.lightboxSlider.style.transform = `translateX(${currentTranslate + diffX}px)`;
      }
    }
  }
}, { passive: true });

dom.lightbox?.addEventListener('touchend', e => {
  if (state.isPinching) {
    state.isPinching = false;
    state.lastZoomScale = state.zoomScale;
    if (state.zoomScale < 1.05) resetZoom();
  } else if (isDragging) {
    isDragging = false;
    
    if (state.zoomScale > 1) {
      // Panning complete
    } else if (isSwipingVertical) {
      const diffY = e.changedTouches[0].clientY - startY;
      const slide = dom.lightboxSlider.children[state.currentIndex];
      const imgs = slide?.querySelectorAll('.lightbox-thumb, .lightbox-full');
      
      if (imgs && imgs.length > 0) {
        imgs.forEach(img => img.classList.remove('swiping'));
        if (Math.abs(diffY) > 120) {
          // Trigger full dismissing animation
          imgs.forEach(img => {
            img.classList.add('dismissing');
            img.style.transform = `translateY(${diffY > 0 ? '100vh' : '-100vh'})`;
            img.style.opacity = '0';
          });
          setTimeout(() => {
            closeLightbox();
            imgs.forEach(img => {
              img.style.transform = '';
              img.style.opacity = '';
              img.classList.remove('dismissing');
            });
            dom.lightbox.style.backgroundColor = '';
            dom.lightbox.style.backdropFilter = '';
            dom.lightbox.style.webkitBackdropFilter = '';
          }, 250);
        } else {
          // Bounce back dismiss block
          imgs.forEach(img => {
            img.classList.add('dismissing');
            img.style.transform = '';
          });
          dom.lightbox.style.backgroundColor = '';
          dom.lightbox.style.backdropFilter = '';
          dom.lightbox.style.webkitBackdropFilter = '';
          setTimeout(() => {
            imgs.forEach(img => img.classList.remove('dismissing'));
          }, 250);
        }
      }
      isSwipingVertical = false;
    } else {
      dom.lightboxSlider.style.transition = '';
      const diff = e.changedTouches[0].clientX - startX;
      
      if (Math.abs(diff) > 50) {
        if (diff < 0 && state.currentIndex < state.images.length - 1) {
          state.currentIndex++;
        } else if (diff > 0 && state.currentIndex > 0) {
          state.currentIndex--;
        }
      }
      updateLightbox();
      isSwipingHorizontal = false;
    }
  }
}, { passive: true });
