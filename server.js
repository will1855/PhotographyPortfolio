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

// =============================================================================
// Express app
// =============================================================================
const app = express();
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
app.use(express.static(path.join(__dirname), { index: false }));
// Legacy: serve local images/thumbs if they still exist (migration fallback)
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/thumbs',  express.static(path.join(__dirname, 'thumbs')));

// =============================================================================
// SEO & Template Injection
// =============================================================================

async function getInjectedHtml(filename, siteConfig) {
  const filePath = path.join(__dirname, filename);
  let html = await fs.promises.readFile(filePath, 'utf8');
  
  const title = siteConfig?.site_title || 'Will Davies';
  const aboutTitle = siteConfig?.about_title || 'About';
  const desc = siteConfig?.about_text || 'Photography portfolio — archive and studies.';
  
  // Basic SEO injection
  html = html.replace(/<title>.*?<\/title>/, `<title>${filename === 'about.html' ? aboutTitle + ' — ' : ''}${title}</title>`);
  html = html.replace(/<meta name="description" content=".*?">/, `<meta name="description" content="${desc.slice(0, 160)}">`);
  
  // OpenGraph injection
  const ogTags = `
    <meta property="og:title" content="${title}">
    <meta property="og:description" content="${desc.slice(0, 160)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="/">
    <link rel="manifest" href="/manifest.json">
  `;
  html = html.replace('</head>', `${ogTags}\n</head>`);
  
  return html;
}

// Serve injected pages
app.get('/', async (req, res) => {
  try {
    const config = await getSiteConfigData();
    const html = await getInjectedHtml('index.html', config);
    res.send(html);
  } catch (err) {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

app.get('/about', async (req, res) => {
  try {
    const config = await getSiteConfigData();
    const html = await getInjectedHtml('about.html', config);
    res.send(html);
  } catch (err) {
    res.sendFile(path.join(__dirname, 'about.html'));
  }
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
          id:        row.id,
          full_url:  getPublicUrl(SUPABASE_IMAGES_BUCKET, row.storage_path_full),
          thumb_url: getPublicUrl(SUPABASE_THUMBS_BUCKET,  row.storage_path_thumb),
          focal_point: row.focal_point || 'center',
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
    sections:     formattedSections,
  };
}

app.get('/api/site-config', async (req, res) => {
  try {
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
    // Look up section by slug (DB-driven — no hardcoded whitelist)
    const { data: section, error: sectionErr } = await supabase
      .from('portfolio_sections')
      .select('id')
      .eq('slug', slug)
      .eq('is_visible', true)
      .single();

    if (sectionErr || !section) {
      return res.status(404).json({ error: `Section '${slug}' not found` });
    }

    const { data: images, error: imagesErr } = await supabase
      .from('portfolio_images')
      .select('*')
      .eq('section_id', section.id)
      .eq('is_visible', true)
      .order('sort_order', { ascending: true });

    if (imagesErr) throw imagesErr;

    res.json((images || []).map(formatImageRow));
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
    res.json({ ok: true });
  } catch (err) {
    console.error('[/api/contact]', err.message);
    res.status(500).json({ error: 'Failed to send message' });
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

        // Generate WebP thumbnail in memory
        const thumbBuffer = await sharp(file.buffer)
          .resize({ width: 1400, withoutEnlargement: true })
          .webp({ quality: 85 })
          .toBuffer();

        // Upload full-res
        const { error: fullUploadErr } = await supabase.storage
          .from(SUPABASE_IMAGES_BUCKET)
          .upload(fullPath, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
          });
        if (fullUploadErr) throw new Error(`Full upload failed: ${fullUploadErr.message}`);

        // Upload thumbnail
        const { error: thumbUploadErr } = await supabase.storage
          .from(SUPABASE_THUMBS_BUCKET)
          .upload(thumbPath, thumbBuffer, {
            contentType: 'image/webp',
            upsert: false,
          });
        if (thumbUploadErr) throw new Error(`Thumb upload failed: ${thumbUploadErr.message}`);

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
      .upload(newFullPath, rotatedFullBuffer, { contentType: mimeType, upsert: false });
    if (fullUpErr) throw new Error(`Full upload failed: ${fullUpErr.message}`);

    // 9. Upload new thumbnail to new path
    const { error: thumbUpErr } = await supabase.storage
      .from(SUPABASE_THUMBS_BUCKET)
      .upload(newThumbPath, thumbBuffer, { contentType: 'image/webp', upsert: false });
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