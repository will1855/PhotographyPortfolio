'use strict';

import { logAnalyticsEvent } from './analytics.js';
import { renderGallery } from './gallery.js';
import { renderWorkLayout } from './gallery.js';
import { renderLightboxSlides } from './lightbox.js';
import { initHeroSlideshow, cleanupHeroSlideshow } from './slideshow.js';
import { dom, state } from './state.js';
import { initAdaptiveContrast, scheduleContrastEval } from './contrast.js';
import { initDvdLogo, stopDvdBounce } from './dvdLogo.js';
import { initBlobNav, updateBlobNavActive, refreshBlobPositions } from './blobNav.js';

// Local variables in main scope
let siteConfigCache = null;
let _lastRoutedBase = window.location.pathname + window.location.search;
let _activeNavIdx = 0;
let _blobFirstInit = true;

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
    initDvdLogo();

    // Blob navigation — init (idempotent) and set active dot
    initBlobNav(async (link) => {
      const url = new URL(link.href, window.location.origin);
      const base = url.pathname + url.search;
      if (base === _lastRoutedBase) return;
      window.history.pushState({}, '', link.href);
      _lastRoutedBase = base;
      await handleRoute(link.href);
    });
    updateBlobNavActive(_activeNavIdx, _blobFirstInit);
    _blobFirstInit = false;
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

  const existingLogo = document.querySelector('.site-logo');
  if (existingLogo) {
    existingLogo.alt = site_title;
  } else if (dom.siteTitle && dom.siteTitle.querySelector('a')) {
    const titleLink = dom.siteTitle.querySelector('a');
    const logoImg = titleLink.querySelector('img');
    if (logoImg) {
      logoImg.alt = site_title;
    } else {
      titleLink.textContent = site_title;
    }
  }

  // Resolve section slugs for blob nav
  const workSection = sections.find(s => (s.nav_label || s.label || '').toLowerCase().trim() !== 'archive') || sections[0];
  const archiveSection = sections.find(s => (s.nav_label || s.label || '').toLowerCase().trim() === 'archive');

  // Dynamic Navigation menu rendering — blob-link elements (no visible text)
  const hasHomeLink = !!dom.siteNav?.querySelector('a[data-nav-index="0"]');
  if (dom.siteNav && (dom.siteNav.children.length === 0 || dom.siteNav.dataset.built !== 'true' || !hasHomeLink)) {
    dom.siteNav.innerHTML = '';
    dom.siteNav.setAttribute('aria-label', 'Main navigation');

    const navItems = [
      { label: 'Home',    href: '/' },
      { label: 'My Work', href: workSection  ? `/?section=${encodeURIComponent(workSection.slug)}`  : '/?section=work' },
      { label: 'Archive', href: archiveSection ? `/?section=${encodeURIComponent(archiveSection.slug)}` : '/?section=archive' },
      { label: 'About',   href: '/about' },
    ];

    navItems.forEach((item, i) => {
      const a = document.createElement('a');
      a.href = item.href;
      a.setAttribute('aria-label', item.label);
      a.setAttribute('data-nav-index', String(i));
      a.className = 'blob-link';
      a.innerHTML = `<span class="sr-only">${item.label}</span>`;
      dom.siteNav.appendChild(a);
    });

    dom.siteNav.dataset.built = 'true';
  }

  // Determine active nav index
  if (isAboutPage) {
    _activeNavIdx = 3;
  } else if (isHomePage) {
    _activeNavIdx = 0;
  } else {
    _activeNavIdx = (workSection && state.section === workSection.slug) ? 1 : 2;
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
    dom.siteNav.innerHTML = '';
    dom.siteNav.setAttribute('aria-label', 'Main navigation');

    const items = [
      { label: 'Home',    href: '/' },
      { label: 'My Work', href: '/?section=studies' },
      { label: 'Archive', href: '/?section=archive' },
      { label: 'About',   href: '/about' },
    ];

    items.forEach((item, i) => {
      const a = document.createElement('a');
      a.href = item.href;
      a.setAttribute('aria-label', item.label);
      a.setAttribute('data-nav-index', String(i));
      a.className = 'blob-link';
      a.innerHTML = `<span class="sr-only">${item.label}</span>`;
      dom.siteNav.appendChild(a);
    });
  }

  // Determine active index
  if (isAboutPage) _activeNavIdx = 3;
  else if (isHomePage) _activeNavIdx = 0;
  else if (state.section === 'studies') _activeNavIdx = 1;
  else _activeNavIdx = 2;
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
  stopDvdBounce(true);
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
      transition.finished.catch(() => {}).finally(() => {
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
      transition.finished.catch(() => {}).finally(() => {
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

// ─── Tab visibility restore handler ────────────────────────────────────────────
// When the user switches back to this tab, any View Transition that was in flight
// when they left may be stuck (the browser pauses/cancels transitions in hidden tabs).
// This clears the stale promise and force-shows any images that are loaded but not
// yet marked visible — preventing the blank gallery bug.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;

  // Clear any stuck View Transition promise so future fade-ins aren't blocked
  if (window.activeViewTransition) {
    window.activeViewTransition = null;
  }

  // Force-apply `loaded` class to any gallery images that have decoded but
  // are still waiting on a stuck transition promise
  const gallery = document.getElementById('gallery');
  if (gallery) {
    gallery.querySelectorAll('img').forEach(img => {
      if (img.naturalWidth > 0 && !img.classList.contains('loaded')) {
        img.classList.add('loaded');
      }
    });
  }

  // Also fix any hero slideshow images
  const heroMedia = document.getElementById('hero-media');
  if (heroMedia) {
    heroMedia.querySelectorAll('img').forEach(img => {
      if (img.naturalWidth > 0 && !img.classList.contains('loaded')) {
        img.classList.add('loaded');
      }
    });
  }
});

window.addEventListener('resize', () => {
  requestAnimationFrame(() => refreshBlobPositions());
});

window.addEventListener('load', () => {
  requestAnimationFrame(() => refreshBlobPositions());
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
