#!/usr/bin/env node

/**
 * Generate logo.ico (Windows) and logo.icns (macOS) from src/ui/assets/logo.png
 *
 * Usage:
 *   npm run generate-icons
 *   node scripts/generate-icons.js
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ASSETS_DIR = path.join(__dirname, '../src/ui/assets');
const LOGO_PNG = path.join(ASSETS_DIR, 'logo.png');
const LOGO_ICO = path.join(ASSETS_DIR, 'logo.ico');
const LOGO_ICNS = path.join(ASSETS_DIR, 'logo.icns');

async function generateIco() {
  console.log('[generate-icons] Building logo.ico (Windows)...');

  // ICO: 16, 32, 48, 64, 128, 256
  const sizes = [16, 32, 48, 64, 128, 256];
  const tempDir = path.join(__dirname, '../temp-ico');

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  for (const size of sizes) {
    await sharp(LOGO_PNG)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(tempDir, `icon-${size}.png`));
  }

  console.log('[generate-icons] PNG sizes generated.');

  try {
    let convertCmd = 'convert';
    try {
      execSync('magick -version', { stdio: 'ignore' });
      convertCmd = 'magick';
    } catch {
      execSync('convert -version', { stdio: 'ignore' });
    }

    const pngFiles = sizes.map((s) => path.join(tempDir, `icon-${s}.png`)).join(' ');
    execSync(`${convertCmd} ${pngFiles} ${LOGO_ICO}`, { stdio: 'ignore' });
    console.log('[generate-icons] logo.ico created via ImageMagick.');
  } catch (error) {
    console.log('[generate-icons] ImageMagick not available; trying Python (Pillow)...');
    try {
      const pyBin = 'python';
      const pyScript = path.join(__dirname, 'generate-windows-ico.py');
      execSync(`"${pyBin}" "${pyScript}"`, { stdio: 'ignore' });
      console.log('[generate-icons] logo.ico created via Python (Pillow).');
    } catch (pythonError) {
      console.log('[generate-icons] Pillow failed; falling back to 256x256 PNG renamed as .ico');
      fs.copyFileSync(path.join(tempDir, 'icon-256.png'), LOGO_ICO);
    }
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('[generate-icons] Done: logo.ico\n');
}

async function generateIcns() {
  console.log('[generate-icons] Building logo.icns (macOS)...');

  const sizes = [
    { size: 16, name: 'icon_16x16' },
    { size: 32, name: 'icon_16x16@2x' },
    { size: 32, name: 'icon_32x32' },
    { size: 64, name: 'icon_32x32@2x' },
    { size: 128, name: 'icon_128x128' },
    { size: 256, name: 'icon_128x128@2x' },
    { size: 256, name: 'icon_256x256' },
    { size: 512, name: 'icon_256x256@2x' },
    { size: 512, name: 'icon_512x512' },
    { size: 1024, name: 'icon_512x512@2x' },
  ];

  const iconsetDir = path.join(__dirname, '../temp.iconset');

  if (!fs.existsSync(iconsetDir)) {
    fs.mkdirSync(iconsetDir, { recursive: true });
  }

  for (const { size, name } of sizes) {
    await sharp(LOGO_PNG)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(iconsetDir, `${name}.png`));
  }

  console.log('[generate-icons] iconset PNGs generated.');

  if (process.platform === 'darwin') {
    try {
      execSync(`iconutil -c icns ${iconsetDir} -o ${LOGO_ICNS}`);
      console.log('[generate-icons] logo.icns created via iconutil.');
    } catch (error) {
      console.log('[generate-icons] iconutil failed; fix manually. iconset:', iconsetDir);
      return;
    }
  } else {
    console.log('[generate-icons] Not macOS: cannot run iconutil. Generate .icns on a Mac.');
    console.log(`  iconutil -c icns ${iconsetDir} -o ${LOGO_ICNS}`);
    return;
  }

  fs.rmSync(iconsetDir, { recursive: true, force: true });
  console.log('[generate-icons] Done: logo.icns\n');
}

async function main() {
  console.log('[generate-icons] Source: logo.png\n');

  if (!fs.existsSync(LOGO_PNG)) {
    console.error('[generate-icons] ERROR: missing file:', LOGO_PNG);
    process.exit(1);
  }

  try {
    await generateIco();
    await generateIcns();

    console.log('[generate-icons] All done.');
    console.log('  ', LOGO_ICO);
    console.log('  ', LOGO_ICNS);
  } catch (error) {
    console.error('[generate-icons] ERROR:', error.message);
    process.exit(1);
  }
}

main();
