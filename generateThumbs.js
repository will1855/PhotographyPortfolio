const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const INPUT = path.join(__dirname, "images");
const OUTPUT = path.join(__dirname, "thumbs");

const VALID_EXTENSIONS = /\.(jpg|jpeg|png|webp)$/i;

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function generateThumb(inputPath, outputPath) {
  try {
    if (fs.existsSync(outputPath)) {
      return;
    }

    ensureDir(path.dirname(outputPath));

    await sharp(inputPath)
      .resize({ width: 1200, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toFile(outputPath);

    console.log("done:", path.relative(INPUT, inputPath));
  } catch (err) {
    console.error("error:", path.relative(INPUT, inputPath), err.message);
  }
}

async function walkAndGenerate(currentInputDir) {
  const entries = fs.readdirSync(currentInputDir, { withFileTypes: true });

  for (const entry of entries) {
    const inputPath = path.join(currentInputDir, entry.name);
    const relativePath = path.relative(INPUT, inputPath);
    const outputPath = path.join(OUTPUT, relativePath);

    if (entry.isDirectory()) {
      ensureDir(outputPath);
      await walkAndGenerate(inputPath);
      continue;
    }

    if (!VALID_EXTENSIONS.test(entry.name)) {
      continue;
    }

    await generateThumb(inputPath, outputPath);
  }
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error("images folder not found.");
    process.exit(1);
  }

  ensureDir(OUTPUT);
  await walkAndGenerate(INPUT);
  console.log("thumbnail generation complete.");
}

main();