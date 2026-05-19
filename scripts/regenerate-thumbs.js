'use strict';
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const sharp = require('sharp');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_IMAGES_BUCKET = 'portfolio-images',
  SUPABASE_THUMBS_BUCKET  = 'portfolio-thumbs',
} = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function regenerate() {
  console.log('Fetching all images...');
  const { data: images, error } = await supabase
    .from('portfolio_images')
    .select('*');

  if (error) {
    console.error('Error fetching images:', error);
    return;
  }

  console.log(`Found ${images.length} images. Starting regeneration...`);

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    console.log(`[${i + 1}/${images.length}] Processing: ${img.storage_path_full}`);

    try {
      // 1. Download full image
      const { data: fileData, error: downloadErr } = await supabase.storage
        .from(SUPABASE_IMAGES_BUCKET)
        .download(img.storage_path_full);

      if (downloadErr) throw downloadErr;

      const buffer = Buffer.from(await fileData.arrayBuffer());

      // 2. Generate new standard thumbnail (1600px)
      const thumbBuffer = await sharp(buffer)
        .resize({ width: 1600, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();

      // 3. Generate new grid thumbnail (600px)
      const gridThumbBuffer = await sharp(buffer)
        .resize({ width: 600, withoutEnlargement: true })
        .webp({ quality: 72 })
        .toBuffer();

      // 4. Upload standard thumbnail (overwrite)
      const { error: uploadErr } = await supabase.storage
        .from(SUPABASE_THUMBS_BUCKET)
        .upload(img.storage_path_thumb, thumbBuffer, {
          contentType: 'image/webp',
          upsert: true,
          cacheControl: '31536000',
        });

      if (uploadErr) throw uploadErr;

      // 5. Upload grid thumbnail (overwrite)
      const gridThumbPath = img.storage_path_thumb.replace('.webp', '-grid.webp');
      const { error: gridUploadErr } = await supabase.storage
        .from(SUPABASE_THUMBS_BUCKET)
        .upload(gridThumbPath, gridThumbBuffer, {
          contentType: 'image/webp',
          upsert: true,
          cacheControl: '31536000',
        });

      if (gridUploadErr) throw gridUploadErr;
      console.log(`  Done: ${img.storage_path_thumb} & ${gridThumbPath}`);

    } catch (err) {
      console.error(`  Failed: ${img.storage_path_full}`, err.message);
    }
  }

  console.log('Regeneration complete!');
}

regenerate();
