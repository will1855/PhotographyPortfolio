'use strict';
/**
 * scripts/migrate-local-images.js
 * ─────────────────────────────────
 * One-time import script: reads local image files, uploads to Supabase Storage,
 * generates WebP thumbnails with sharp, and inserts metadata into portfolio_images.
 *
 * USAGE:
 *   1. Edit IMPORT_MAP below — list each image with its local path, target section,
 *      and desired sort order.
 *   2. Make sure .env is populated with real Supabase credentials.
 *   3. Run: node scripts/migrate-local-images.js
 *
 * Safe to re-run — already-uploaded images (matched by storage_path_full) are skipped.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');
const { createClient } = require('@supabase/supabase-js');

// =============================================================================
// Configuration — edit this before running
// =============================================================================

/**
 * Map each local image to a section and sort order.
 * Paths are relative to the project root (where server.js lives).
 *
 * section must match a slug already seeded in portfolio_sections.
 * sort_order controls display order in the public gallery (0 = first).
 */
const IMPORT_MAP = [
  // ── Archive images ──────────────────────────────────────────────────────
  // { localPath: 'images/interrailing-15.png', section: 'archive', sortOrder: 0 },
  // { localPath: 'images/interrailing-18.jpg', section: 'archive', sortOrder: 1 },
  // { localPath: 'images/interrailing-19.jpg', section: 'archive', sortOrder: 2 },
  // { localPath: 'images/interrailing-21.jpg', section: 'archive', sortOrder: 3 },
  // { localPath: 'images/interrailing-14.jpg', section: 'archive', sortOrder: 4 },
  // { localPath: 'images/geneva-32.jpg',       section: 'archive', sortOrder: 5 },
  // { localPath: 'images/geneva-40.jpg',       section: 'archive', sortOrder: 6 },
  // { localPath: 'images/scandinaviaWill-21.jpg', section: 'archive', sortOrder: 7 },
  // { localPath: 'images/maltaWill-15.jpg',    section: 'archive', sortOrder: 8 },
  // { localPath: 'images/wales5.jpg',          section: 'archive', sortOrder: 9 },
  // { localPath: 'images/wales2.png',          section: 'archive', sortOrder: 10 },
  // { localPath: 'images/wales3.png',          section: 'archive', sortOrder: 11 },
  // { localPath: 'images/tennis-29.jpg',       section: 'archive', sortOrder: 12 },
  // { localPath: 'images/tennis-30.jpg',       section: 'archive', sortOrder: 13 },
  // { localPath: 'images/tennis-46.jpg',       section: 'archive', sortOrder: 14 },
  // { localPath: 'images/tennis-47.jpg',       section: 'archive', sortOrder: 15 },

  // ── Studies images ──────────────────────────────────────────────────────
  // { localPath: 'images/home11.jpg',  section: 'studies', sortOrder: 0 },
  // { localPath: 'images/home10.jpg',  section: 'studies', sortOrder: 1 },
  // { localPath: 'images/home5.png',   section: 'studies', sortOrder: 2 },
  // { localPath: 'images/home-25.jpg', section: 'studies', sortOrder: 3 },
  // { localPath: 'images/home-28.jpg', section: 'studies', sortOrder: 4 },
  // { localPath: 'images/home-32.jpg', section: 'studies', sortOrder: 5 },
  // { localPath: 'images/home-35.jpg', section: 'studies', sortOrder: 6 },
  // { localPath: 'images/home-37.jpg', section: 'studies', sortOrder: 7 },
  // { localPath: 'images/Interrailing3.jpg', section: 'studies', sortOrder: 8 },
];

// =============================================================================
// Script — do not edit below unless you know what you're doing
// =============================================================================

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_IMAGES_BUCKET = 'portfolio-images',
  SUPABASE_THUMBS_BUCKET  = 'portfolio-thumbs',
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌  Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ROOT = path.join(__dirname, '..');

function sanitiseFilename(original) {
  const ext  = path.extname(original).toLowerCase();
  const base = path.basename(original, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${Date.now()}-${base}${ext}`;
}

async function migrateImage(entry) {
  const { localPath, section: sectionSlug, sortOrder } = entry;
  const absPath = path.join(ROOT, localPath);

  if (!fs.existsSync(absPath)) {
    console.warn(`  ⚠  File not found, skipping: ${localPath}`);
    return;
  }

  const originalFilename = path.basename(localPath);
  const safeFilename     = sanitiseFilename(originalFilename);
  const nameWithoutExt   = path.basename(safeFilename, path.extname(safeFilename));

  const fullStoragePath  = `${sectionSlug}/full/${safeFilename}`;
  const thumbStoragePath = `${sectionSlug}/thumbs/${nameWithoutExt}.webp`;

  // Check for existing entry in DB
  const { data: existing } = await supabase
    .from('portfolio_images')
    .select('id')
    .eq('storage_path_full', fullStoragePath)
    .maybeSingle();

  if (existing) {
    console.log(`  ⚠  Already imported, skipping: ${originalFilename}`);
    return;
  }

  // Resolve section id
  const { data: sectionRow, error: sectionErr } = await supabase
    .from('portfolio_sections')
    .select('id')
    .eq('slug', sectionSlug)
    .single();

  if (sectionErr || !sectionRow) {
    console.error(`  ✗  Section '${sectionSlug}' not found in database for: ${originalFilename}`);
    return;
  }

  const fileBuffer = fs.readFileSync(absPath);
  let mimeType = 'image/jpeg';
  const ext = path.extname(originalFilename).toLowerCase();
  if (ext === '.png')  mimeType = 'image/png';
  if (ext === '.webp') mimeType = 'image/webp';

  // Get dimensions
  const metadata = await sharp(fileBuffer).metadata();

  // Generate WebP thumbnail in memory
  const thumbBuffer = await sharp(fileBuffer)
    .resize({ width: 900, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  // Upload full-res
  const { error: fullErr } = await supabase.storage
    .from(SUPABASE_IMAGES_BUCKET)
    .upload(fullStoragePath, fileBuffer, { contentType: mimeType, upsert: false });

  if (fullErr) {
    if (fullErr.message?.includes('already exists')) {
      console.warn(`  ⚠  Already in storage, will still insert DB row: ${originalFilename}`);
    } else {
      console.error(`  ✗  Full upload failed for ${originalFilename}: ${fullErr.message}`);
      return;
    }
  }

  // Upload thumbnail
  const { error: thumbErr } = await supabase.storage
    .from(SUPABASE_THUMBS_BUCKET)
    .upload(thumbStoragePath, thumbBuffer, { contentType: 'image/webp', upsert: false });

  if (thumbErr && !thumbErr.message?.includes('already exists')) {
    console.error(`  ✗  Thumb upload failed for ${originalFilename}: ${thumbErr.message}`);
    return;
  }

  // Insert DB row
  const { error: insertErr } = await supabase
    .from('portfolio_images')
    .insert({
      section_id:         sectionRow.id,
      original_filename:  originalFilename,
      safe_filename:      safeFilename,
      storage_path_full:  fullStoragePath,
      storage_path_thumb: thumbStoragePath,
      width:              metadata.width  || null,
      height:             metadata.height || null,
      sort_order:         sortOrder,
      is_visible:         true,
    });

  if (insertErr) {
    console.error(`  ✗  DB insert failed for ${originalFilename}: ${insertErr.message}`);
    return;
  }

  console.log(`  ✓  ${originalFilename}  →  ${sectionSlug} (order: ${sortOrder})`);
}

async function main() {
  if (IMPORT_MAP.length === 0 || IMPORT_MAP.every(e => e.localPath?.startsWith('//'))) {
    console.log('');
    console.log('📋  IMPORT_MAP is empty or all entries are commented out.');
    console.log('    Edit scripts/migrate-local-images.js, uncomment the images you want');
    console.log('    to import, then run: node scripts/migrate-local-images.js');
    console.log('');
    return;
  }

  const activeEntries = IMPORT_MAP.filter(e => e && e.localPath);

  console.log('');
  console.log(`🚀  Starting migration — ${activeEntries.length} image(s) to process`);
  console.log('');

  for (const entry of activeEntries) {
    await migrateImage(entry);
  }

  console.log('');
  console.log('✅  Migration complete');
  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
