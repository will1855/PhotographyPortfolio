'use strict';

let animFrameId = null;
let isBouncing = false;
let posX = 0;
let posY = 0;
let vx = 0.9;
let vy = 0.7;
let placeholder = null;
let initialized = false;

const BOUNCE_COLORS = [
  '#ff3366', '#33ccff', '#33ff77', '#ffcc00', '#ff66ff',
  '#00ffcc', '#ff9933', '#b866ff', '#00e5ff', '#ff3333'
];

let currentColorIdx = 0;

/**
 * Initializes DVD logo bounce handler on the site title logo.
 */
export function initDvdLogo() {
  stopDvdBounce(true);
  if (initialized) return;
  initialized = true;

  // Use capture phase event delegation for clicks on logo and nav tabs
  document.addEventListener('click', (e) => {
    const siteTitleLink = e.target.closest('#site-title a');
    if (siteTitleLink) {
      e.preventDefault();
      e.stopPropagation();
      if (isBouncing) {
        stopDvdBounce();
      } else {
        startDvdBounce();
      }
      return;
    }

    // Clicking any navbar link immediately restores bouncing logo to header
    const navLink = e.target.closest('#site-nav a');
    if (navLink && isBouncing) {
      stopDvdBounce(true);
    }
  }, { capture: true });

  // Keep bouncing logo within screen bounds on window resize
  window.addEventListener('resize', () => {
    if (!isBouncing) return;
    const logo = document.querySelector('.site-logo');
    if (!logo) return;
    const w = logo.offsetWidth || 140;
    const h = logo.offsetHeight || 120;
    if (posX + w > window.innerWidth) {
      posX = Math.max(0, window.innerWidth - w);
    }
    if (posY + h > window.innerHeight) {
      posY = Math.max(0, window.innerHeight - h);
    }
  });
}

/**
 * Starts the DVD screensaver bouncing animation.
 */
export function startDvdBounce() {
  const logo = document.querySelector('.site-logo');
  const siteTitleLink = document.querySelector('#site-title a');
  if (!logo || !siteTitleLink || isBouncing) return;

  const rect = logo.getBoundingClientRect();

  // Create invisible placeholder to reserve exact header space
  if (!placeholder || !placeholder.parentNode) {
    placeholder = document.createElement('div');
    placeholder.className = 'site-logo-placeholder';
  }
  placeholder.style.width = `${rect.width}px`;
  placeholder.style.height = `${rect.height}px`;
  placeholder.style.display = 'inline-block';
  placeholder.style.visibility = 'hidden';

  if (logo.parentNode) {
    logo.parentNode.insertBefore(placeholder, logo);
  }

  posX = rect.left;
  posY = rect.top;

  // Move logo to root level so header overflow/transforms don't constrain it
  document.body.appendChild(logo);

  logo.classList.add('dvd-bouncing');
  logo.style.position = 'fixed';
  logo.style.left = `${posX}px`;
  logo.style.top = `${posY}px`;
  logo.style.margin = '0';
  logo.style.zIndex = '999999';
  logo.style.pointerEvents = 'auto';
  logo.style.cursor = 'pointer';
  logo.style.transition = 'filter 300ms ease';

  // Significantly slower gentle velocity (~0.8 - 1.2 px/frame)
  vx = (Math.random() > 0.5 ? 1 : -1) * (0.8 + Math.random() * 0.4);
  vy = (Math.random() > 0.5 ? 1 : -1) * (0.6 + Math.random() * 0.4);

  isBouncing = true;

  // Click handler while floating: return to nav
  logo._dvdClickHandler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    stopDvdBounce();
  };
  logo.addEventListener('click', logo._dvdClickHandler);

  step();
}

/**
 * Animation loop for gliding & wall bouncing.
 */
function step() {
  if (!isBouncing) return;

  const logo = document.querySelector('.site-logo');
  if (!logo) {
    stopDvdBounce(true);
    return;
  }

  const w = logo.offsetWidth || 140;
  const h = logo.offsetHeight || 120;
  const maxW = window.innerWidth;
  const maxH = window.innerHeight;

  posX += vx;
  posY += vy;

  let bounced = false;

  // Bounce X walls
  if (posX <= 0) {
    posX = 0;
    vx = Math.abs(vx);
    bounced = true;
  } else if (posX + w >= maxW) {
    posX = maxW - w;
    vx = -Math.abs(vx);
    bounced = true;
  }

  // Bounce Y walls
  if (posY <= 0) {
    posY = 0;
    vy = Math.abs(vy);
    bounced = true;
  } else if (posY + h >= maxH) {
    posY = maxH - h;
    vy = -Math.abs(vy);
    bounced = true;
  }

  // On collision, shift drop-shadow hue glow like the DVD screensaver!
  // if (bounced) {
  //   currentColorIdx = (currentColorIdx + 1) % BOUNCE_COLORS.length;
  //   const color = BOUNCE_COLORS[currentColorIdx];
  //   logo.style.filter = `drop-shadow(0 0 16px ${color}) drop-shadow(0 0 35px ${color})`;
  // }

  logo.style.left = `${posX}px`;
  logo.style.top = `${posY}px`;

  animFrameId = requestAnimationFrame(step);
}

/**
 * Stops bouncing animation and returns logo to original nav bar space.
 * @param {boolean} [immediate=false] - If true, immediately restores DOM position without transition animation.
 */
export function stopDvdBounce(immediate = false) {
  if (!isBouncing && !document.querySelector('.site-logo.dvd-bouncing')) return;
  isBouncing = false;

  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }

  const logo = document.querySelector('.site-logo');
  const siteTitleLink = document.querySelector('#site-title a');

  if (logo && logo._dvdClickHandler) {
    logo.removeEventListener('click', logo._dvdClickHandler);
    delete logo._dvdClickHandler;
  }

  const resetLogoStyles = () => {
    const currentLogo = document.querySelector('.site-logo');
    const targetLink = document.querySelector('#site-title a');
    if (currentLogo && targetLink) {
      targetLink.appendChild(currentLogo);
      currentLogo.classList.remove('dvd-bouncing');
      currentLogo.style.position = '';
      currentLogo.style.left = '';
      currentLogo.style.top = '';
      currentLogo.style.margin = '';
      currentLogo.style.zIndex = '';
      currentLogo.style.cursor = '';
      currentLogo.style.transition = '';
      currentLogo.style.filter = '';
    }
    if (placeholder && placeholder.parentNode) {
      placeholder.parentNode.removeChild(placeholder);
    }
    placeholder = null;
  };

  if (immediate || !logo || !siteTitleLink || !placeholder || !placeholder.parentNode) {
    resetLogoStyles();
    return;
  }

  // Smoothly animate back to placeholder position
  const rect = placeholder.getBoundingClientRect();
  logo.style.transition = 'left 350ms cubic-bezier(0.2, 0.8, 0.2, 1), top 350ms cubic-bezier(0.2, 0.8, 0.2, 1), filter 350ms ease';
  logo.style.left = `${rect.left}px`;
  logo.style.top = `${rect.top}px`;
  logo.style.filter = '';

  setTimeout(() => {
    resetLogoStyles();
  }, 350);
}
