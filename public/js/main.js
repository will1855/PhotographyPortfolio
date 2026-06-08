'use strict';

import { logAnalyticsEvent } from './analytics.js';
import { renderGallery } from './gallery.js';
import { renderLightboxSlides } from './lightbox.js';
import { initHeroSlideshow } from './slideshow.js';
import { dom, state } from './state.js';

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

    requestAnimationFrame(updateLiquidNavPill);
  } catch (err) {
    console.warn('[config] Failed to load site config, using defaults', err);
    applyFallbackNav();
  }

  const isAbout = window.location.pathname.includes('/about');

  if (isAbout) {
    if (siteConfigCache) loadAbout(siteConfigCache);
  } else {
    if (dom.gallery) {
      try {
        let data;
        const currentSection = new URLSearchParams(window.location.search).get('section') || 'archive';

        if (siteConfigCache?.initial_images && state.section === currentSection) {
          data = siteConfigCache.initial_images;
          delete siteConfigCache.initial_images; // Consume only once
          state.sectionCache.set(state.section, data);
        } else if (state.sectionCache.has(state.section)) {
          data = state.sectionCache.get(state.section);
        } else {
          const imgRes = await fetch(`/api/images?section=${encodeURIComponent(state.section)}`);
          data = await imgRes.json();
          state.sectionCache.set(state.section, data);
        }

        if (Array.isArray(data) && data.length > 0) {
          state.images = data;
          renderGallery();
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
  logAnalyticsEvent('page_view', isAbout ? 'about' : state.section);
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

function updateLiquidNavPill() {
  const nav = dom.siteNav || document.querySelector('nav');
  const activeLink = nav?.querySelector('a.active');

  if (!nav || !activeLink) return;

  nav.style.setProperty('--nav-pill-x', `${activeLink.offsetLeft}px`);
  nav.style.setProperty('--nav-pill-w', `${activeLink.offsetWidth}px`);
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
    requestAnimationFrame(updateLiquidNavPill);
    return;
  }

  window.history.pushState({}, '', link.href);
  _lastRoutedBase = targetBase;

  await handleRoute(link.href);

  requestAnimationFrame(updateLiquidNavPill);
}

function movePillToPointer(nav, clientX) {
  const navRect = nav.getBoundingClientRect();
  const closestLink = getClosestNavLink(nav, clientX);

  const width = closestLink?.offsetWidth ||
    parseFloat(getComputedStyle(nav).getPropertyValue('--nav-pill-w')) ||
    48;

  let x = clientX - navRect.left - width / 2;
  x = Math.max(3, Math.min(x, nav.offsetWidth - width - 3));

  nav.style.setProperty('--nav-pill-x', `${x}px`);
  nav.style.setProperty('--nav-pill-w', `${width}px`);
}

function setupLiquidNavDrag() {
  const nav = dom.siteNav || document.querySelector('nav');
  if (!nav || nav.dataset.liquidDragSetup === 'true') return;

  nav.dataset.liquidDragSetup = 'true';

  nav.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary) return;

    const targetLink = e.target.closest('a');
    if (!targetLink) return;

    navPointer = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startLink: targetLink,
      didDrag: false,
    };

    nav.setPointerCapture?.(e.pointerId);
  });

  nav.addEventListener('pointermove', (e) => {
    if (!navPointer || navPointer.id !== e.pointerId) return;

    const dx = Math.abs(e.clientX - navPointer.startX);
    const dy = Math.abs(e.clientY - navPointer.startY);

    if (!navPointer.didDrag && dx < 5 && dy < 5) return;

    navPointer.didDrag = true;
    nav.classList.add('nav-dragging');

    movePillToPointer(nav, e.clientX);
  });

  nav.addEventListener('pointerup', async (e) => {
    if (!navPointer || navPointer.id !== e.pointerId) return;

    const wasDrag = navPointer.didDrag;
    const clickedLink = navPointer.startLink;

    navPointer = null;
    nav.classList.remove('nav-dragging');

    const chosenLink = wasDrag
      ? getClosestNavLink(nav, e.clientX)
      : clickedLink;

    // Always suppress the follow-up native click.
    // We are handling nav ourselves here.
    suppressNextNavClick = true;

    await goToNavLink(chosenLink);

    setTimeout(() => {
      suppressNextNavClick = false;
    }, 0);
  });

  nav.addEventListener('pointercancel', () => {
    navPointer = null;
    suppressNextNavClick = false;
    nav.classList.remove('nav-dragging');
    requestAnimationFrame(updateLiquidNavPill);
  });

  nav.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    if (suppressNextNavClick) {
      e.preventDefault();
      e.stopImmediatePropagation();
      suppressNextNavClick = false;
      return;
    }

    // Fallback only, in case pointer events fail for some reason.
    e.preventDefault();
    e.stopImmediatePropagation();
    goToNavLink(link);
  }, true);
}

function applyConfig(config) {
  const site_title = config.site_title || 'Will Davies';
  const sections = config.sections || [];
  const isAboutPage = window.location.pathname.includes('/about');
  const sectionConfig = sections.find(s => s.slug === state.section);

  if (isAboutPage) {
    document.title = `${config.about_title || 'About'} — ${site_title}`;
  } else if (sectionConfig && sectionConfig.slug !== 'archive') {
    document.title = `${sectionConfig.label} — ${site_title}`;
  } else {
    document.title = site_title;
  }

  if (dom.siteTitle && dom.siteTitle.querySelector('a')) {
    dom.siteTitle.querySelector('a').textContent = site_title;
  }

  // Dynamic Navigation menu rendering
  if (dom.siteNav && (dom.siteNav.children.length === 0 || dom.siteNav.dataset.built !== 'true')) {
    dom.siteNav.innerHTML = '';
    for (const s of sections) {
      const a = document.createElement('a');
      a.href = `/?section=${encodeURIComponent(s.slug)}`;
      a.textContent = s.nav_label || s.label;
      if (!isAboutPage && s.slug === state.section) a.classList.add('active');
      dom.siteNav.appendChild(a);
    }
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
      } else {
        const s = url.searchParams.get('section');
        a.classList.toggle('active', !isAboutPage && s === state.section);
      }
    });
  }

  if (sectionConfig && !isAboutPage) {
    if (dom.heroKicker) {
      dom.heroKicker.textContent = sectionConfig.hero_kicker || sectionConfig.label || '';
    }
    if (dom.heroLink) {
      dom.heroLink.textContent = sectionConfig.hero_link_text || 'View';
    }

    if (sectionConfig.heroes && sectionConfig.heroes.length > 0) {
      initHeroSlideshow(sectionConfig.heroes);
    }
  }
}

/**
 * Fallback static navigation layout if database is unavailable.
 */
function applyFallbackNav() {
  const isAboutPage = window.location.pathname.includes('/about');
  if (dom.siteNav) {
    dom.siteNav.innerHTML = `
      <a href="/?section=archive"${!isAboutPage && state.section === 'archive' ? ' class="active"' : ''}>Archive</a>
      <a href="/?section=studies"${!isAboutPage && state.section === 'studies' ? ' class="active"' : ''}>Studies</a>
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
  const urlObj = new URL(url);
  const newSection = urlObj.searchParams.get('section');
  const isHome = urlObj.pathname === '/' || urlObj.pathname === '/index.html';
  const hasGallery = !!document.getElementById('gallery');

  // Fast client-side section shift optimization
  if (isHome && hasGallery && newSection) {
    state.section = newSection;
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

    state.section = newSection || 'archive';

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
      document.startViewTransition(() => performUpdate());
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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch(err => console.warn('[ServiceWorker] Registration failed:', err));
  });
}

// Idempotent BFCache restore handler
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    console.log('[bfcache] Page restored from BFCache, re-initializing...');
    initPage();
  }
});

window.addEventListener('resize', () => {
  requestAnimationFrame(updateLiquidNavPill);
});

window.addEventListener('load', () => {
  requestAnimationFrame(updateLiquidNavPill);
});

// Bootstrap initial load
initPage();
