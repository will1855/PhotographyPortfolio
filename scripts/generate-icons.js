const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT_DIR = path.join(__dirname, '..');
const INPUT_LOGO = path.join(ROOT_DIR, 'logo.png');

async function main() {
  if (!fs.existsSync(INPUT_LOGO)) {
    console.error(`[error] Input logo.png not found at: ${INPUT_LOGO}`);
    process.exit(1);
  }

  const logoStats = fs.statSync(INPUT_LOGO);
  console.log(`[info] Original logo.png size: ${(logoStats.size / 1024 / 1024).toFixed(2)} MB`);

  // Backup original logo.png in case we need it
  const backupLogo = path.join(ROOT_DIR, 'logo-original-backup.png');
  if (!fs.existsSync(backupLogo)) {
    fs.copyFileSync(INPUT_LOGO, backupLogo);
    console.log(`[info] Created original backup at: ${backupLogo}`);
  }

  try {
    // 1. Generate favicon.png (32x32)
    const faviconPath = path.join(ROOT_DIR, 'favicon.png');
    await sharp(INPUT_LOGO)
      .resize(32, 32)
      .png({ compressionLevel: 9 })
      .toFile(faviconPath);
    console.log(`[success] Generated favicon.png (${(fs.statSync(faviconPath).size / 1024).toFixed(2)} KB)`);

    // 2. Generate apple-touch-icon.png (180x180)
    const appleTouchIconPath = path.join(ROOT_DIR, 'apple-touch-icon.png');
    await sharp(INPUT_LOGO)
      .resize(180, 180)
      .png({ compressionLevel: 9 })
      .toFile(appleTouchIconPath);
    console.log(`[success] Generated apple-touch-icon.png (${(fs.statSync(appleTouchIconPath).size / 1024).toFixed(2)} KB)`);

    // 3. Generate a highly compressed logo.png (512x512) to replace the 1.3MB file
    const tempLogoPath = path.join(ROOT_DIR, 'logo-temp.png');
    await sharp(INPUT_LOGO)
      .resize(512, 512)
      .png({ compressionLevel: 9 })
      .toFile(tempLogoPath);

    // Overwrite original logo.png
    fs.renameSync(tempLogoPath, INPUT_LOGO);
    console.log(`[success] Overwrote logo.png with compressed 512x512 version (${(fs.statSync(INPUT_LOGO).size / 1024).toFixed(2)} KB)`);

  } catch (err) {
    console.error('[error] Processing failed:', err);
    process.exit(1);
  }
}

main();
