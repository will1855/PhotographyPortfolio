'use strict';
require('dotenv').config();

const path        = require('path');
const crypto      = require('crypto');
const express     = require('express');
const cookieParser = require('cookie-parser');
const multer      = require('multer');
const jwt         = require('jsonwebtoken');
const rateLimit   = require('express-rate-limit');
const sharp       = require('sharp');
const fs          = require('fs');
const { createClient } = require('@supabase/supabase-js');
const compression  = require('compression');
const { Resend }    = require('resend');

// =============================================================================
// Environment validation
// =============================================================================
const REQUIRED_ENV = [
  'ADMIN_PASSWORD',
  'SESSION_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[startup] Missing required env var: ${key}`);
    process.exit(1);
  }
}

const {
  ADMIN_PASSWORD,
  SESSION_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_IMAGES_BUCKET = 'portfolio-images',
  SUPABASE_THUMBS_BUCKET  = 'portfolio-thumbs',
  NODE_ENV = 'development',
  PORT     = 3000,
} = process.env;

const IS_PROD = NODE_ENV === 'production';

// =============================================================================
// Supabase client (server-side only — service role key never sent to browser)
// =============================================================================
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Initialize Resend (optional, only sends if key is provided)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// =============================================================================
// Express app
// =============================================================================
const app = express();

// Strict Security and Privacy Headers Middleware
app.use((req, res, next) => {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https://*.supabase.co",
    "connect-src 'self' https://*.supabase.co https://vitals.vercel-insights.com",
    "media-src 'self' https://*.supabase.co",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  const permissions = [
    "camera=()",
    "microphone=()",
    "geolocation=()",
    "payment=()",
    "usb=()"
  ].join(', ');
  res.setHeader('Permissions-Policy', permissions);
  
  next();
});

app.use(compression()); // Compress all responses
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Debug: Log files available in the current directory on startup
console.log('[startup] Current directory:', __dirname);
try {
  const files = fs.readdirSync(__dirname);
  console.log('[startup] Files found:', files.join(', '));
} catch (err) {
  console.error('[startup] Failed to read directory:', err.message);
}

// Serve static public files - MOVE TO TOP
const STATIC_CACHE = { maxAge: '1y', immutable: true };
app.use(express.static(path.join(__dirname, 'public'), { index: false, ...STATIC_CACHE }));
// Legacy: serve local images/thumbs if they still exist (migration fallback)
app.use('/images', express.static(path.join(__dirname, 'images'), STATIC_CACHE));
app.use('/thumbs',  express.static(path.join(__dirname, 'thumbs'), STATIC_CACHE));

// =============================================================================
// SEO & Template Injection
// =============================================================================

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const templateCache = new Map();

async function getInjectedHtml(filename, siteConfig, activeSectionSlug = 'archive') {
  const filePath = path.join(__dirname, filename);
  let html;
  
  if (IS_PROD) {
    if (!templateCache.has(filename)) {
      const content = await fs.promises.readFile(filePath, 'utf8');
      templateCache.set(filename, content);
    }
    html = templateCache.get(filename);
  } else {
    html = await fs.promises.readFile(filePath, 'utf8');
  }
  
  const title = siteConfig?.site_title || 'Will Davies';
  const aboutTitle = siteConfig?.about_title || 'About';
  const desc = siteConfig?.about_text || 'Photography portfolio — archive and studies.';
  
  // Construct canonical absolute URL for dynamic page metadata
  const pageUrl = `https://willdaviesphoto.co.uk${filename === 'about.html' ? '/about' : (activeSectionSlug === 'archive' ? '/' : '/?section=' + encodeURIComponent(activeSectionSlug))}`;
  
  // Basic SEO injection
  html = html.replace(/<title>.*?<\/title>/, `<title>${filename === 'about.html' ? aboutTitle + ' — ' : ''}${title}</title>`);
  html = html.replace(/<meta name="description" content=".*?">/, `<meta name="description" content="${desc.slice(0, 160)}">`);
  
  // Update pre-existing canonical, og:url, and twitter:url in the base HTML if they exist to match the final domain
  html = html.replace(/<link rel="canonical" href=".*?">/, `<link rel="canonical" href="${pageUrl}">`);
  html = html.replace(/<meta property="og:url" content=".*?">/g, `<meta property="og:url" content="${pageUrl}">`);
  html = html.replace(/<meta property="twitter:url" content=".*?">/g, `<meta property="twitter:url" content="${pageUrl}">`);
  
  // OpenGraph & Performance injection
  const supabaseOrigin = new URL(SUPABASE_URL).origin;
  const performanceTags = `
    <link rel="preconnect" href="${supabaseOrigin}">
    <link rel="dns-prefetch" href="${supabaseOrigin}">
    <link rel="preload" href="/style.css?v=3" as="style">
    <link rel="modulepreload" href="/js/main.js?v=4">
  `;
  const ogTags = `
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${desc.slice(0, 160)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="${pageUrl}">
    <link rel="manifest" href="/manifest.json" crossorigin="use-credentials">
  `;
  const criticalCss = `
    <style>
      :root { --bg: #050505; --text: #f3f3f0; --accent: #fff; --header-h: 64px; }
      body { background: var(--bg); color: var(--text); margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; overflow-x: hidden; }
      header { position: fixed; top: 0; left: 0; width: 100%; height: var(--header-h); z-index: 50; display: flex; align-items: center; background: rgba(5, 5, 5, 0.15); backdrop-filter: blur(10px); transition: opacity 0.3s ease; }
      .hero { height: 100svh; min-height: 700px; background: #000; position: relative; overflow: hidden; }
      .hero-slide { position: absolute; inset: 0; opacity: 0; transition: opacity 1.6s ease-in-out; }
      .hero-slide.active { opacity: 1; }
      .hero-slide img { width: 100%; height: 100%; object-fit: cover; filter: brightness(0.96); transform: scale(1.02); }
      .reveal { opacity: 0; transform: translateY(8px); }
    </style>
  `;
  html = html.replace('</head>', `${criticalCss}\n${performanceTags}\n${ogTags}\n</head>`);
  
  const sections = siteConfig?.sections || [];
  const isAboutPage = filename === 'about.html';

  // 1. Dynamic pre-rendering: Site Navigation
  let navHtml = '';
  for (const s of sections) {
    const isActive = !isAboutPage && s.slug === activeSectionSlug;
    navHtml += `<a href="/?section=${encodeURIComponent(s.slug)}"${isActive ? ' class="active"' : ''}>${s.nav_label || s.label}</a>`;
  }
  const isAboutActive = isAboutPage;
  navHtml += `<a href="/about"${isAboutActive ? ' class="active"' : ''}>${aboutTitle}</a>`;
  html = html.replace(/<nav id="site-nav">[\s\S]*?<\/nav>/, `<nav id="site-nav" data-built="true">${navHtml}</nav>`);

  // 2. Dynamic pre-rendering: Hero slideshow, kicker, link (index.html only)
  const sectionConfig = sections.find(s => s.slug === activeSectionSlug);
  const heroes = sectionConfig?.heroes || [];
  const initialHeroIndex = heroes.length > 0 ? Math.floor(Math.random() * heroes.length) : 0;

  if (siteConfig) {
    siteConfig.initial_hero_index = initialHeroIndex;
  }

  if (filename === 'index.html' && sectionConfig) {
    let heroMediaHtml = '';
    heroes.forEach((h, i) => {
      const isActive = i === initialHeroIndex;
      const focalPointStyle = h.focal_point && h.focal_point !== 'center' ? ` style="--mobile-focal-point: ${h.focal_point};"` : '';
      
      const gridThumb = h.grid_thumb_url || h.thumb_url; // Rule 9: fallback to 1200px if grid thumb missing
      const srcSetAttr = ` srcset="${gridThumb} 600w, ${h.thumb_url} 1200w" sizes="100vw"`;

      if (isActive) {
        heroMediaHtml += `<div class="hero-slide active">
          <img src="${h.thumb_url}"${srcSetAttr} class="loading" alt="Hero image" data-full-url="${h.full_url}"${focalPointStyle}>
        </div>`;
      } else {
        // Rule 8: Lazy-loading inactive slides (data-srcset/data-src) to prevent instant download
        heroMediaHtml += `<div class="hero-slide">
          <img data-src="${h.thumb_url}" data-srcset="${gridThumb} 600w, ${h.thumb_url} 1200w" sizes="100vw" class="loading" alt="Hero image" data-full-url="${h.full_url}"${focalPointStyle}>
        </div>`;
      }
    });

    const kickerText = sectionConfig.hero_kicker || sectionConfig.label || '';
    const linkText = sectionConfig.hero_link_text || 'View';

    html = html.replace(/<div class="hero-media" id="hero-media">[\s\S]*?<\/div>/, `<div class="hero-media" id="hero-media">${heroMediaHtml}</div>`);
    html = html.replace(/<p class="hero-kicker" id="hero-kicker">[\s\S]*?<\/p>/, `<p class="hero-kicker" id="hero-kicker">${escapeHtml(kickerText)}</p>`);
    html = html.replace(/<a href="#gallery" class="hero-link" id="hero-link">[\s\S]*?<\/a>/, `<a href="#gallery" class="hero-link" id="hero-link">${escapeHtml(linkText)}</a>`);
  }
  
  // Initial Data injection
  if (siteConfig) {
    const dataScript = `\n<script>window.INITIAL_DATA = ${JSON.stringify(siteConfig)};</script>`;
    html = html.replace('</head>', `${dataScript}\n</head>`);

    // Preload the active hero's thumbnail for instant display
    if (heroes[initialHeroIndex]) {
      const activeHero = heroes[initialHeroIndex];
      const gridThumb = activeHero.grid_thumb_url || activeHero.thumb_url; // Rule 9 fallback
      const preloadTag = `<link rel="preload" as="image" href="${activeHero.thumb_url}" imagesrcset="${gridThumb} 600w, ${activeHero.thumb_url} 1200w" imagesizes="100vw" fetchpriority="high">`;
      html = html.replace('</head>', `${preloadTag}\n</head>`);
    }
  }
  
  return html;
}

// Serve injected pages
app.get('/', async (req, res) => {
  const slug = (req.query.section || 'archive').toLowerCase().trim();
  try {
    const config = await getSiteConfigData();
    // Also pre-fetch images for the initial section
    config.initial_images = await getSectionImagesData(slug);
    const html = await getInjectedHtml('index.html', config, slug);
    // Vercel Edge caching - approved via Rule 10
    res.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
    res.send(html);
  } catch (err) {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

app.get('/about', async (req, res) => {
  try {
    const config = await getSiteConfigData();
    const html = await getInjectedHtml('about.html', config);
    // Vercel Edge caching - approved via Rule 10
    res.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
    res.send(html);
  } catch (err) {
    res.sendFile(path.join(__dirname, 'about.html'));
  }
});

// Silences local Speed Insights 404 console errors when running locally
app.get('/_vercel/speed-insights/script.js', (req, res) => {
  res.type('application/javascript').send('');
});

// =============================================================================
// Helpers
// =============================================================================

/** Generate a public URL for a Supabase Storage object. */
function getPublicUrl(bucket, storagePath) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

/** Sanitise a filename: lowercase, alphanumeric+dash+dot only, timestamp prefix. */
function sanitiseFilename(original) {
  const ext  = path.extname(original).toLowerCase();
  const base = path.basename(original, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${Date.now()}-${base}${ext}`;
}

/** Constant-time string comparison to prevent timing attacks. */
function safeEqual(a, b) {
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/** Format an image DB row into the public API shape. */
function formatImageRow(row) {
  return {
    id:              row.id,
    title:           row.title || null,
    alt_text:        row.alt_text || null,
    width:           row.width || null,
    height:          row.height || null,
    sort_order:      row.sort_order,
    is_wide:         row.is_wide || false,
    is_filled:       row.is_filled || false,
    focal_point:     row.focal_point || 'center',
    public_url_full:  getPublicUrl(SUPABASE_IMAGES_BUCKET, row.storage_path_full),
    public_url_thumb: getPublicUrl(SUPABASE_THUMBS_BUCKET,  row.storage_path_thumb),
    public_url_grid_thumb: getPublicUrl(SUPABASE_THUMBS_BUCKET, row.storage_path_thumb.replace('.webp', '-grid.webp')),
    // Include paths for admin use
    storage_path_full:  row.storage_path_full,
    storage_path_thumb: row.storage_path_thumb,
  };
}

// =============================================================================
// Admin auth — stateless JWT in HTTP-only cookie
// =============================================================================
const JWT_COOKIE   = 'admin_token';
const JWT_EXPIRES  = '7d';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

function signAdminToken() {
  return jwt.sign({ admin: true }, SESSION_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyAdminToken(token) {
  try {
    const payload = jwt.verify(token, SESSION_SECRET);
    return payload.admin === true;
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  const token = req.cookies?.[JWT_COOKIE];
  if (!token || !verifyAdminToken(token)) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

// =============================================================================
// Upload config — memory storage only (no disk writes; Vercel-safe)
// =============================================================================
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_FILES_PER_UPLOAD = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILES_PER_UPLOAD },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only jpg, png, webp allowed.`));
    }
  },
});

// =============================================================================
// Login rate limiter — 5 attempts per 15 min per IP
// =============================================================================
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true,
});

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * GET /api/site-config
 * Returns: site settings, ordered visible sections, hero data for each section.
 */
/** Internal helper to fetch site config data without an HTTP request. */
async function getSiteConfigData() {
  if (process.env.CI === 'true') {
    return {
      site_title: 'Will Davies',
      about_title: 'About',
      about_text: 'This is a mock about text for E2E tests.',
      about_profile_url: null,
      about_profile_storage_path: null,
      about_profile_image_id: null,
      contact_email: 'hello@example.com',
      instagram_url: 'https://instagram.com/willdavies',
      sections: [
        {
          id: 1,
          slug: 'archive',
          label: 'Archive',
          nav_label: 'Archive',
          hero_kicker: 'Archive Collection',
          hero_link_text: 'View',
          sort_order: 1,
          heroes: []
        },
        {
          id: 2,
          slug: 'studies',
          label: 'Studies',
          nav_label: 'Studies',
          hero_kicker: 'Visual Studies',
          hero_link_text: 'Explore',
          sort_order: 2,
          heroes: []
        }
      ]
    };
  }

  // Fetch site settings
  const { data: settings, error: settingsErr } = await supabase
    .from('site_settings')
    .select('*')
    .eq('id', 1)
    .single();

  if (settingsErr && settingsErr.code !== 'PGRST116') throw settingsErr;

  // Fetch all visible sections ordered
  const { data: sections, error: sectionsErr } = await supabase
    .from('portfolio_sections')
    .select('*')
    .eq('is_visible', true)
    .order('sort_order', { ascending: true });

  if (sectionsErr) throw sectionsErr;

  // For each section with a hero, fetch hero image row
  const formattedSections = await Promise.all((sections || []).map(async (section) => {
    let heroes = [];
    const { data: heroLinks } = await supabase
      .from('section_hero_images')
      .select('image_id')
      .eq('section_id', section.id);

    if (heroLinks && heroLinks.length > 0) {
      const heroIds = heroLinks.map(h => h.image_id);
      const { data: heroRows } = await supabase
        .from('portfolio_images')
        .select('*')
        .in('id', heroIds);

      if (heroRows) {
        heroes = heroRows.map(row => ({
          id:             row.id,
          full_url:       getPublicUrl(SUPABASE_IMAGES_BUCKET, row.storage_path_full),
          thumb_url:      getPublicUrl(SUPABASE_THUMBS_BUCKET, row.storage_path_thumb),
          grid_thumb_url: row.storage_path_thumb ? getPublicUrl(SUPABASE_THUMBS_BUCKET, row.storage_path_thumb.replace('.webp', '-grid.webp')) : null,
          focal_point:    row.focal_point || 'center',
        }));
      }
    }
    return {
      id:           section.id,
      slug:         section.slug,
      label:        section.label,
      nav_label:    section.nav_label || section.label,
      hero_kicker:  section.hero_kicker,
      hero_link_text: section.hero_link_text,
      sort_order:   section.sort_order,
      heroes,
    };
  }));

  // About profile image
  let aboutProfileUrl = null;
  if (settings?.about_profile_storage_path) {
    aboutProfileUrl = getPublicUrl(SUPABASE_IMAGES_BUCKET, settings.about_profile_storage_path);
  } else if (settings?.about_profile_image_id) {
    const { data: profileRow } = await supabase
      .from('portfolio_images')
      .select('storage_path_full, storage_path_thumb')
      .eq('id', settings.about_profile_image_id)
      .single();
    if (profileRow) {
      aboutProfileUrl = getPublicUrl(SUPABASE_IMAGES_BUCKET, profileRow.storage_path_full);
    }
  }

  return {
    site_title:   settings?.site_title  || 'Will Davies',
    about_title:  settings?.about_title || 'About',
    about_text:   settings?.about_text  || '',
    about_profile_url: aboutProfileUrl,
    about_profile_storage_path: settings?.about_profile_storage_path || null,
    about_profile_image_id:     settings?.about_profile_image_id     || null,
    contact_email: settings?.contact_email || null,
    instagram_url: settings?.instagram_url || null,
    sections:     formattedSections,
  };
}

/** Internal helper to fetch images for a section without an HTTP request. */
async function getSectionImagesData(slug) {
  if (process.env.CI === 'true') {
    return [
      {
        id: 1,
        title: 'Mock Image 1',
        alt_text: 'Mock Alt 1',
        width: 1200,
        height: 800,
        sort_order: 1,
        is_wide: false,
        is_filled: false,
        focal_point: 'center',
        public_url_full: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=1200',
        public_url_thumb: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600',
        public_url_grid_thumb: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600',
        storage_path_full: 'mock/image1.jpg',
        storage_path_thumb: 'mock/image1-thumb.jpg'
      },
      {
        id: 2,
        title: 'Mock Image 2',
        alt_text: 'Mock Alt 2',
        width: 1200,
        height: 800,
        sort_order: 2,
        is_wide: true,
        is_filled: false,
        focal_point: 'center',
        public_url_full: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=1200',
        public_url_thumb: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=600',
        public_url_grid_thumb: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?w=600',
        storage_path_full: 'mock/image2.jpg',
        storage_path_thumb: 'mock/image2-thumb.jpg'
      }
    ];
  }

  try {
    const { data: section } = await supabase
      .from('portfolio_sections')
      .select('id')
      .eq('slug', slug)
      .eq('is_visible', true)
      .single();

    if (!section) return [];

    const { data: images } = await supabase
      .from('portfolio_images')
      .select('*')
      .eq('section_id', section.id)
      .eq('is_visible', true)
      .order('sort_order', { ascending: true });

    return (images || []).map(formatImageRow);
  } catch (err) {
    console.error('[getSectionImagesData]', err.message);
    return [];
  }
}

app.get('/api/site-config', async (req, res) => {
  try {
    // Edge cache for 1 min, allow stale-while-revalidate for 5 min
    res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    const data = await getSiteConfigData();
    res.json(data);
  } catch (err) {
    console.error('[/api/site-config]', err.message);
    res.status(500).json({ error: 'Failed to load site config' });
  }
});

/**
 * GET /api/images?section=<slug>
 * Returns ordered visible images for a section, with server-generated public URLs.
 */
app.get('/api/images', async (req, res) => {
  const slug = (req.query.section || '').toLowerCase().trim();
  if (!slug) return res.status(400).json({ error: 'Missing section parameter' });

  try {
    const data = await getSectionImagesData(slug);
    // Edge cache for 1 min, allow stale-while-revalidate for 5 min
    res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.json(data);
  } catch (err) {
    console.error('[/api/images]', err.message);
    res.status(500).json({ error: 'Failed to load images' });
  }
});

/**
 * POST /api/contact
 * Handles contact form submissions and stores them in Supabase.
 */
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const { error } = await supabase
      .from('contact_inquiries')
      .insert({ name, email, message });

    if (error) throw error;

    // 2. Attempt to send email notification (best-effort)
    if (resend) {
      try {
        // Fetch current contact email from settings
        const { data: settings } = await supabase.from('site_settings').select('contact_email').single();
        const recipient = settings?.contact_email;

        if (recipient) {
          await resend.emails.send({
            from: 'Portfolio Contact <onboarding@resend.dev>',
            to: recipient,
            subject: `New Inquiry from ${name}`,
            html: `
              <h2>New Portfolio Inquiry</h2>
              <p><strong>From:</strong> ${name} (${email})</p>
              <p><strong>Message:</strong></p>
              <div style="white-space: pre-wrap; background: #f4f4f4; padding: 15px; border-radius: 5px; font-family: sans-serif;">${message}</div>
              <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
              <p style="font-size: 0.8rem; color: #666;">View this message in your <a href="${req.protocol}://${req.get('host')}/admin">admin dashboard</a>.</p>
            `,
          });
          console.log(`[contact] Email notification sent to ${recipient}`);
        }
      } catch (emailErr) {
        console.error('[contact] Email notification failed:', emailErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[/api/contact]', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

/**
 * GET /sitemap.xml
 * Dynamically generates a valid sitemap.xml from portfolio_sections in database.
 */
app.get('/sitemap.xml', async (req, res) => {
  try {
    const baseUrl = 'https://willdaviesphoto.co.uk';

    // Get all active visible sections
    const { data: sections } = await supabase
      .from('portfolio_sections')
      .select('slug')
      .eq('is_visible', true);

    const slugs = ['archive', 'studies']; // Fallbacks in case query is empty
    if (sections && sections.length > 0) {
      slugs.length = 0; // Clear fallbacks if database responds
      sections.forEach(s => slugs.push(s.slug));
    }

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    // 1. Home page
    xml += `  <url>\n    <loc>${baseUrl}/</loc>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;

    // 2. About page
    xml += `  <url>\n    <loc>${baseUrl}/about</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;

    // 3. Sections pages
    for (const slug of slugs) {
      xml += `  <url>\n    <loc>${baseUrl}/?section=${encodeURIComponent(slug)}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
    }

    xml += `</urlset>`;

    res.header('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    console.error('[/sitemap.xml]', err.message);
    res.status(500).send('Error generating sitemap');
  }
});

/**
 * POST /api/analytics/log
 * Logs an anonymous analytic event: event_type, event_target.
 */
app.post('/api/analytics/log', async (req, res) => {
  const { event_type, event_target } = req.body;
  if (!event_type || !event_target) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const { error } = await supabase
      .from('portfolio_analytics')
      .insert({ event_type, event_target });

    if (error) {
      if (error.code === '42P01') {
        console.warn('[analytics] portfolio_analytics table does not exist. Run migration 002_analytics.sql.');
        return res.json({ ok: false, warning: 'analytics table missing' });
      }
      throw error;
    }

    res.json({ ok: true });
  } catch (err) {
    console.warn('[analytics] Graceful fail:', err.message);
    res.json({ ok: false, error: err.message });
  }
});


// =============================================================================
// ADMIN AUTH ROUTES
// =============================================================================

/** GET /admin — serve the admin SPA */
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

/** POST /admin/login — rate-limited, validates password, issues JWT cookie */
app.post('/admin/login', loginLimiter, (req, res) => {
  const { password } = req.body;

  if (!password || !safeEqual(String(password), ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  const token = signAdminToken();

  res.cookie(JWT_COOKIE, token, {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: 'lax',
    maxAge:   COOKIE_MAX_AGE,
    path:     '/',
  });

  res.json({ ok: true });
});

/** POST /admin/logout — clears the admin cookie */
app.post('/admin/logout', (_req, res) => {
  res.clearCookie(JWT_COOKIE, { path: '/' });
  res.json({ ok: true });
});

// =============================================================================
// ADMIN API — all routes protected by requireAdmin
// =============================================================================

/** GET /api/admin/session — check if the current cookie is valid */
app.get('/api/admin/session', requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

/** GET /api/admin/analytics — fetch and aggregate logs for dashboard stats */
app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
  try {
    const { data: events, error } = await supabase
      .from('portfolio_analytics')
      .select('event_type, event_target, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === '42P01') {
        return res.json({
          ok: true,
          warning: 'analytics_table_missing',
          totalViews: 0,
          totalClicks: 0,
          sectionViews: {},
          topImages: [],
          viewsByDate: {}
        });
      }
      throw error;
    }

    let totalViews = 0;
    let totalClicks = 0;
    const sectionViews = {};
    const imageClicks = {};
    const viewsByDate = {};

    if (events && events.length > 0) {
      events.forEach(e => {
        const dateStr = new Date(e.created_at).toISOString().split('T')[0]; // YYYY-MM-DD
        if (e.event_type === 'page_view') {
          totalViews++;
          sectionViews[e.event_target] = (sectionViews[e.event_target] || 0) + 1;
          viewsByDate[dateStr] = (viewsByDate[dateStr] || 0) + 1;
        } else if (e.event_type === 'lightbox_click') {
          totalClicks++;
          imageClicks[e.event_target] = (imageClicks[e.event_target] || 0) + 1;
        }
      });
    }

    const topImages = Object.entries(imageClicks)
      .map(([target, clicks]) => ({ target, clicks }))
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 10);

    res.json({
      ok: true,
      totalViews,
      totalClicks,
      sectionViews,
      topImages,
      viewsByDate
    });
  } catch (err) {
    console.error('[/api/admin/analytics]', err.message);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});


/** GET /api/admin/images?section=<slug> — all images (including hidden) for a section */
app.get('/api/admin/images', requireAdmin, async (req, res) => {
  const slug = (req.query.section || '').toLowerCase().trim();
  if (!slug) return res.status(400).json({ error: 'Missing section parameter' });

  try {
    const { data: section, error: sectionErr } = await supabase
      .from('portfolio_sections')
      .select('id')
      .eq('slug', slug)
      .single();

    if (sectionErr || !section) {
      return res.status(404).json({ error: `Section '${slug}' not found` });
    }

    const { data: images, error: imagesErr } = await supabase
      .from('portfolio_images')
      .select('*')
      .eq('section_id', section.id)
      .order('sort_order', { ascending: true });

    if (imagesErr) throw imagesErr;

    res.json((images || []).map(formatImageRow));
  } catch (err) {
    console.error('[/api/admin/images]', err.message);
    res.status(500).json({ error: 'Failed to load images' });
  }
});

/**
 * GET /api/admin/sections — all sections (including hidden) for admin dashboard
 */
app.get('/api/admin/sections', requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('portfolio_sections')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[/api/admin/sections]', err.message);
    res.status(500).json({ error: 'Failed to load sections' });
  }
});

/**
 * POST /api/admin/upload
 * Accepts up to 10 images, generates WebP thumbs via sharp, uploads to Supabase Storage,
 * and inserts rows into portfolio_images.
 */
app.post('/api/admin/upload', requireAdmin, (req, res, next) => {
  upload.array('images', MAX_FILES_PER_UPLOAD)(req, res, (err) => {
    if (err) {
      // multer errors (size, type, count)
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  const section_slug = (req.body.section || '').toLowerCase().trim();
  if (!section_slug) return res.status(400).json({ error: 'Missing section' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  try {
    // Resolve section
    const { data: section, error: sectionErr } = await supabase
      .from('portfolio_sections')
      .select('id')
      .eq('slug', section_slug)
      .single();

    if (sectionErr || !section) {
      return res.status(404).json({ error: `Section '${section_slug}' not found` });
    }

    // Get current max sort_order for this section
    const { data: maxRow } = await supabase
      .from('portfolio_images')
      .select('sort_order')
      .eq('section_id', section.id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single();

    let nextOrder = ((maxRow?.sort_order) ?? -1) + 1;

    const results = [];
    const errors  = [];

    for (const file of req.files) {
      try {
        const safeFilename = sanitiseFilename(file.originalname);
        const nameWithoutExt = path.basename(safeFilename, path.extname(safeFilename));

        const fullPath  = `${section_slug}/full/${safeFilename}`;
        const thumbPath = `${section_slug}/thumbs/${nameWithoutExt}.webp`;

        // Get image metadata (dimensions) before resizing
        const metadata = await sharp(file.buffer).metadata();

        // Generate WebP standard thumbnail (1200px)
        const thumbBuffer = await sharp(file.buffer)
          .resize({ width: 1200, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer();

        // Generate WebP grid thumbnail (600px)
        const gridThumbBuffer = await sharp(file.buffer)
          .resize({ width: 600, withoutEnlargement: true })
          .webp({ quality: 72 })
          .toBuffer();

        // Upload full-res with 1-year immutable caching
        const { error: fullUploadErr } = await supabase.storage
          .from(SUPABASE_IMAGES_BUCKET)
          .upload(fullPath, file.buffer, {
            contentType: file.mimetype,
            cacheControl: '31536000',
            upsert: false,
          });
        if (fullUploadErr) throw new Error(`Full upload failed: ${fullUploadErr.message}`);

        // Upload standard thumbnail with 1-year immutable caching
        const { error: thumbUploadErr } = await supabase.storage
          .from(SUPABASE_THUMBS_BUCKET)
          .upload(thumbPath, thumbBuffer, {
            contentType: 'image/webp',
            cacheControl: '31536000',
            upsert: false,
          });
        if (thumbUploadErr) throw new Error(`Thumb upload failed: ${thumbUploadErr.message}`);

        // Upload grid thumbnail with 1-year immutable caching
        const gridThumbPath = thumbPath.replace('.webp', '-grid.webp');
        const { error: gridUploadErr } = await supabase.storage
          .from(SUPABASE_THUMBS_BUCKET)
          .upload(gridThumbPath, gridThumbBuffer, {
            contentType: 'image/webp',
            cacheControl: '31536000',
            upsert: false,
          });
        if (gridUploadErr) throw new Error(`Grid thumb upload failed: ${gridUploadErr.message}`);

        // Insert DB row
        const { data: imageRow, error: insertErr } = await supabase
          .from('portfolio_images')
          .insert({
            section_id:         section.id,
            original_filename:  file.originalname,
            safe_filename:      safeFilename,
            storage_path_full:  fullPath,
            storage_path_thumb: thumbPath,
            width:              metadata.width  || null,
            height:             metadata.height || null,
            sort_order:         nextOrder,
            is_visible:         true,
          })
          .select()
          .single();

        if (insertErr) throw new Error(`DB insert failed: ${insertErr.message}`);

        nextOrder++;
        results.push(formatImageRow(imageRow));
      } catch (fileErr) {
        errors.push({ filename: file.originalname, error: fileErr.message });
      }
    }

    res.json({ uploaded: results, errors });
  } catch (err) {
    console.error('[/api/admin/upload]', err.message);
    res.status(500).json({ error: 'Upload failed' });
  }
});

/**
 * POST /api/admin/upload-profile
 * Handles dedicated profile image upload for the About page.
 */
app.post('/api/admin/upload-profile', requireAdmin, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  try {
    const safeFilename = sanitiseFilename(req.file.originalname);
    const storagePath  = `profile/${safeFilename}`;

    // Get current settings to find old profile path for cleanup
    const { data: settings } = await supabase
      .from('site_settings')
      .select('about_profile_storage_path')
      .eq('id', 1)
      .single();

    // Upload to Supabase Storage
    const { error: uploadErr } = await supabase.storage
      .from(SUPABASE_IMAGES_BUCKET)
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '86400',
        upsert: false,
      });

    if (uploadErr) throw uploadErr;

    // Update site_settings
    const { error: updateErr } = await supabase
      .from('site_settings')
      .update({
        about_profile_storage_path: storagePath,
        about_profile_image_id:     null, // clear the old reference if any
        updated_at:                 new Date().toISOString(),
      })
      .eq('id', 1);

    if (updateErr) throw updateErr;

    // Clean up old profile image if it exists and is in the 'profile/' folder
    if (settings?.about_profile_storage_path && settings.about_profile_storage_path.startsWith('profile/')) {
      await supabase.storage
        .from(SUPABASE_IMAGES_BUCKET)
        .remove([settings.about_profile_storage_path]);
    }

    res.json({
      ok: true,
      public_url: getPublicUrl(SUPABASE_IMAGES_BUCKET, storagePath),
      storage_path: storagePath,
    });
  } catch (err) {
    console.error('[/api/admin/upload-profile]', err.message);
    res.status(500).json({ error: 'Profile upload failed' });
  }
});

/**
 * POST /api/admin/reorder
 * Body: { section: 'archive', order: ['uuid1', 'uuid2', ...] }
 * Updates sort_order for each image to match array position.
 */
app.post('/api/admin/reorder', requireAdmin, async (req, res) => {
  const { section: slug, order } = req.body;
  if (!slug || !Array.isArray(order)) {
    return res.status(400).json({ error: 'Missing section or order array' });
  }

  try {
    const updates = order.map((id, index) =>
      supabase
        .from('portfolio_images')
        .update({ sort_order: index, updated_at: new Date().toISOString() })
        .eq('id', id)
    );

    await Promise.all(updates);
    res.json({ ok: true });
  } catch (err) {
    console.error('[/api/admin/reorder]', err.message);
    res.status(500).json({ error: 'Reorder failed' });
  }
});

/**
 * DELETE /api/admin/image/:id
 * Removes full-res + thumb from Supabase Storage, then deletes the DB row.
 */
app.delete('/api/admin/image/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    // Fetch the row first to get storage paths
    const { data: image, error: fetchErr } = await supabase
      .from('portfolio_images')
      .select('storage_path_full, storage_path_thumb')
      .eq('id', id)
      .single();

    if (fetchErr || !image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Null out any FK references to this image before deleting
    // (hero_image_id on sections, about_profile_image_id on site_settings)
    // The FK constraints use ON DELETE SET NULL, so Postgres handles this automatically.

    // Delete from storage
    await supabase.storage.from(SUPABASE_IMAGES_BUCKET).remove([image.storage_path_full]);
    await supabase.storage.from(SUPABASE_THUMBS_BUCKET).remove([image.storage_path_thumb]);

    // Delete DB row
    const { error: deleteErr } = await supabase
      .from('portfolio_images')
      .delete()
      .eq('id', id);

    if (deleteErr) throw deleteErr;

    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/admin/image]', err.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

/**
 * PATCH /api/admin/image/:id/wide
 * Body: { "is_wide": true | false }
 * Toggles the 2-column "wide" display flag for an image.
 */
app.patch('/api/admin/image/:id/wide', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const is_wide = Boolean(req.body.is_wide);
  try {
    const { data: updated, error } = await supabase
      .from('portfolio_images')
      .update({ is_wide, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(formatImageRow(updated));
  } catch (err) {
    console.error('[PATCH /api/admin/image/wide]', err.message);
    res.status(500).json({ error: 'Failed to update wide flag' });
  }
});

/**
 * PATCH /api/admin/image/:id/fill
 * Body: { "is_filled": true | false }
 * Toggles the "fill gap" flag for an image.
 */
app.patch('/api/admin/image/:id/fill', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const is_filled = Boolean(req.body.is_filled);
  try {
    const { data: updated, error } = await supabase
      .from('portfolio_images')
      .update({ is_filled, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(formatImageRow(updated));
  } catch (err) {
    console.error('[PATCH /api/admin/image/fill]', err.message);
    res.status(500).json({ error: 'Failed to update fill flag' });
  }
});

/**
 * PATCH /api/admin/image/:id/focal
 * Body: { "focal_point": "top" }
 * Updates the focal point of the image.
 */
app.patch('/api/admin/image/:id/focal', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { focal_point } = req.body;
  try {
    const { data: updated, error } = await supabase
      .from('portfolio_images')
      .update({ focal_point, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(formatImageRow(updated));
  } catch (err) {
    console.error('[PATCH /api/admin/image/focal]', err.message);
    res.status(500).json({ error: 'Failed to update focal point' });
  }
});

/**
 * POST /api/admin/image/:id/rotate
 * Body: { "degrees": 90 } or { "degrees": -90 }
 *
 * WHY NEW PATHS: Supabase Storage CDN caches objects by URL. Overwriting the same
 * path with upsert:true replaces the bytes on disk but the CDN keeps serving the
 * old cached version. Uploading to a NEW timestamped path produces a fresh URL that
 * is guaranteed to return the rotated image immediately. The DB is updated with the
 * new paths, and the old files are deleted from storage. All FK references
 * (hero_image_id, about_profile_image_id) reference the image's UUID, not the path,
 * so they continue to work correctly.
 */
app.post('/api/admin/image/:id/rotate', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const degrees = Number(req.body.degrees);

  if (degrees !== 90 && degrees !== -90 && degrees !== 180) {
    return res.status(400).json({ error: 'degrees must be 90, -90, or 180' });
  }

  try {
    // 1. Fetch image row (need old paths to download + clean up after)
    const { data: image, error: fetchErr } = await supabase
      .from('portfolio_images')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !image) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // 2. Download the full-res image into memory
    const { data: blob, error: downloadErr } = await supabase.storage
      .from(SUPABASE_IMAGES_BUCKET)
      .download(image.storage_path_full);

    if (downloadErr || !blob) {
      throw new Error(`Download failed: ${downloadErr?.message || 'no data'}`);
    }

    const fullBuffer = Buffer.from(await blob.arrayBuffer());

    // 3. Rotate with sharp (strips EXIF, applies clean rotation)
    const rotatedFullBuffer = await sharp(fullBuffer).rotate(degrees).toBuffer();

    // 4. New dimensions (width/height swap for 90°/-90°)
    const newMeta = await sharp(rotatedFullBuffer).metadata();

    // 5. MIME type from original extension
    const ext      = path.extname(image.storage_path_full).toLowerCase().replace('.', '');
    const mimeMap  = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    const mimeType = mimeMap[ext] || 'image/jpeg';
    const fileExt  = ext === 'jpeg' ? 'jpg' : (ext || 'jpg');

    // 6. Generate NEW storage paths with a fresh timestamp prefix.
    //    This is essential: Supabase's CDN caches by URL, so overwriting the
    //    same path with upsert:true leaves the CDN serving the stale version.
    //    A new path = a new URL = no cached version to serve.
    const sectionSlug    = image.storage_path_full.split('/')[0];
    const baseName       = path.basename(
      image.safe_filename || image.original_filename || 'image',
      path.extname(image.safe_filename || image.original_filename || '')
    );
    const newSafeFilename = `${Date.now()}-${baseName}.${fileExt}`;
    const newBaseName     = path.basename(newSafeFilename, `.${fileExt}`);
    const newFullPath     = `${sectionSlug}/full/${newSafeFilename}`;
    const newThumbPath    = `${sectionSlug}/thumbs/${newBaseName}.webp`;

    // 7. Regenerate WebP thumbnail from rotated image
    const thumbBuffer = await sharp(rotatedFullBuffer)
      .resize({ width: 900, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    // 8. Upload rotated full-res to new path
    const { error: fullUpErr } = await supabase.storage
      .from(SUPABASE_IMAGES_BUCKET)
      .upload(newFullPath, rotatedFullBuffer, { contentType: mimeType, cacheControl: '86400', upsert: false });
    if (fullUpErr) throw new Error(`Full upload failed: ${fullUpErr.message}`);

    // 9. Upload new thumbnail to new path
    const { error: thumbUpErr } = await supabase.storage
      .from(SUPABASE_THUMBS_BUCKET)
      .upload(newThumbPath, thumbBuffer, { contentType: 'image/webp', cacheControl: '86400', upsert: false });
    if (thumbUpErr) {
      // Roll back the full upload before throwing
      await supabase.storage.from(SUPABASE_IMAGES_BUCKET).remove([newFullPath]);
      throw new Error(`Thumb upload failed: ${thumbUpErr.message}`);
    }

    // 10. Update DB with new paths + dimensions
    const { data: updated, error: updateErr } = await supabase
      .from('portfolio_images')
      .update({
        storage_path_full:  newFullPath,
        storage_path_thumb: newThumbPath,
        safe_filename:      newSafeFilename,
        width:              newMeta.width  || null,
        height:             newMeta.height || null,
        updated_at:         new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // 11. Delete old files from storage (best-effort — don't fail if this errors)
    await supabase.storage.from(SUPABASE_IMAGES_BUCKET).remove([image.storage_path_full]).catch(() => {});
    await supabase.storage.from(SUPABASE_THUMBS_BUCKET).remove([image.storage_path_thumb]).catch(() => {});

    res.json(formatImageRow(updated));
  } catch (err) {
    console.error('[POST /api/admin/image/rotate]', err.message);
    res.status(500).json({ error: `Rotation failed: ${err.message}` });
  }
});


/**
 * POST /api/admin/hero
 * Body: { section: 'archive', hero_image_ids: ['uuid1', 'uuid2'], hero_kicker: '...', hero_link_text: '...' }
 */
app.post('/api/admin/hero', requireAdmin, async (req, res) => {
  const { section: slug, hero_image_ids, hero_kicker, hero_link_text } = req.body;
  if (!slug) return res.status(400).json({ error: 'Missing section' });

  try {
    // 1. Resolve section
    const { data: section, error: secErr } = await supabase
      .from('portfolio_sections')
      .select('id')
      .eq('slug', slug)
      .single();

    if (secErr || !section) throw new Error('Section not found');

    // 2. Update section fields (legacy hero_image_id set to first one for compat)
    await supabase
      .from('portfolio_sections')
      .update({
        hero_image_id:  (hero_image_ids && hero_image_ids.length > 0) ? hero_image_ids[0] : null,
        hero_kicker:    hero_kicker   || null,
        hero_link_text: hero_link_text || null,
        updated_at:     new Date().toISOString(),
      })
      .eq('id', section.id);

    // 3. Update section_hero_images table
    // Delete old links
    await supabase.from('section_hero_images').delete().eq('section_id', section.id);

    // Insert new links
    if (Array.isArray(hero_image_ids) && hero_image_ids.length > 0) {
      const links = hero_image_ids.map(id => ({ section_id: section.id, image_id: id }));
      await supabase.from('section_hero_images').insert(links);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[/api/admin/hero]', err.message);
    res.status(500).json({ error: 'Failed to update hero slideshow' });
  }
});

/**
 * POST /api/admin/site-settings
 * Body: { site_title, about_title, about_text, about_profile_image_id, contact_email, instagram_url }
 */
app.post('/api/admin/site-settings', requireAdmin, async (req, res) => {
  const {
    site_title, about_title, about_text,
    about_profile_image_id, about_profile_storage_path, contact_email, instagram_url,
  } = req.body;

  try {
    const { error } = await supabase
      .from('site_settings')
      .upsert({
        id:                         1,
        site_title:                 site_title             || 'Will Davies',
        about_title:                about_title            || 'About',
        about_text:                 about_text             || null,
        about_profile_image_id:     about_profile_image_id || null,
        about_profile_storage_path: about_profile_storage_path || null,
        contact_email:              contact_email          || null,
        instagram_url:              instagram_url          || null,
        updated_at:                 new Date().toISOString(),
      });

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[/api/admin/site-settings]', err.message);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * POST /api/admin/sections/new
 * Body: { label: 'New Section' }
 */
app.post('/api/admin/sections/new', requireAdmin, async (req, res) => {
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'Missing section label' });

  // Generate URL-friendly slug
  let slug = label.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) slug = `section-${Date.now()}`;

  try {
    // Check if slug already exists
    const { data: existing } = await supabase
      .from('portfolio_sections')
      .select('id')
      .eq('slug', slug)
      .single();

    if (existing) {
      // Append a short random string or timestamp to make it unique
      slug = `${slug}-${Math.floor(Math.random() * 1000)}`;
    }

    // Get max sort_order
    const { data: maxRow } = await supabase
      .from('portfolio_sections')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .single();
    
    const nextOrder = (maxRow?.sort_order ?? -1) + 1;

    // Insert new section (default to not visible so admin can add images first)
    const { data: newSection, error } = await supabase
      .from('portfolio_sections')
      .insert({
        slug,
        label,
        nav_label: label,
        sort_order: nextOrder,
        is_visible: false,
      })
      .select()
      .single();

    if (error) throw error;
    res.json(newSection);
  } catch (err) {
    console.error('[/api/admin/sections/new]', err.message);
    res.status(500).json({ error: 'Failed to create section' });
  }
});

/**
 * POST /api/admin/section-settings
 * Body: { section: 'archive', label, nav_label, sort_order, is_visible }
 */
app.post('/api/admin/section-settings', requireAdmin, async (req, res) => {
  const { section: slug, label, nav_label, sort_order, is_visible } = req.body;
  if (!slug) return res.status(400).json({ error: 'Missing section' });

  try {
    const updates = { updated_at: new Date().toISOString() };
    if (label     !== undefined) updates.label      = label;
    if (nav_label !== undefined) updates.nav_label  = nav_label;
    if (sort_order !== undefined) updates.sort_order = Number(sort_order);
    if (is_visible !== undefined) updates.is_visible = Boolean(is_visible);

    const { error } = await supabase
      .from('portfolio_sections')
      .update(updates)
      .eq('slug', slug);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[/api/admin/section-settings]', err.message);
    res.status(500).json({ error: 'Failed to update section' });
  }
});

/**
 * GET /api/admin/inquiries
 * Returns all contact form submissions, newest first.
 */
app.get('/api/admin/inquiries', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('contact_inquiries')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[GET /api/admin/inquiries]', err.message);
    res.status(500).json({ error: 'Failed to fetch inquiries' });
  }
});

/**
 * DELETE /api/admin/inquiry/:id
 * Deletes a specific inquiry.
 */
app.delete('/api/admin/inquiry/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('contact_inquiries')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/admin/inquiry]', err.message);
    res.status(500).json({ error: 'Failed to delete inquiry' });
  }
});

// =============================================================================
// Catch-all — serve index.html for unknown routes (SPA fallback)
// About page has its own static file
// =============================================================================
app.get('/about', (_req, res) => {
  res.sendFile(path.join(__dirname, 'about.html'));
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// =============================================================================
// Start server (local dev — Vercel ignores this)
// =============================================================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[server] http://localhost:${PORT}`);
    console.log(`[server] NODE_ENV=${NODE_ENV}`);
  });
}

module.exports = app; // exported for Vercel