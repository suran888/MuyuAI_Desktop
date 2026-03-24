#!/usr/bin/env node

/**
 * 从 src/ui/assets/logo.png 生成 logo.ico（Windows）和 logo.icns（macOS）
 *
 * 使用方式：
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
  console.log('[图标生成] 开始生成 logo.ico（Windows）');

  // ICO 常见尺寸
  const sizes = [16, 32, 48, 64, 128, 256];
  const tempDir = path.join(__dirname, '../temp-ico');

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // 生成不同尺寸的 PNG
  for (const size of sizes) {
    await sharp(LOGO_PNG)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(path.join(tempDir, `icon-${size}.png`));
  }

  console.log('[图标生成] 已生成多尺寸 PNG');

  try {
    let convertCmd = 'convert';

    try {
      execSync('magick -version', { stdio: 'ignore' });
      convertCmd = 'magick';
    } catch {
      execSync('convert -version', { stdio: 'ignore' });
    }

    const pngFiles = sizes.map((s) =>
      path.join(tempDir, `icon-${s}.png`)
    ).join(' ');

    execSync(`${convertCmd} ${pngFiles} ${LOGO_ICO}`, { stdio: 'ignore' });

    console.log('[图标生成] 使用 ImageMagick 成功生成 logo.ico');
  } catch (error) {
    console.log('[图标生成] 未检测到 ImageMagick，尝试使用 Python（Pillow）');

    try {
      const pyBin = 'python';
      const pyScript = path.join(__dirname, 'generate-windows-ico.py');

      execSync(`"${pyBin}" "${pyScript}"`, { stdio: 'ignore' });

      console.log('[图标生成] 使用 Python（Pillow）成功生成 logo.ico');
    } catch (pythonError) {
      console.log('[图标生成] Pillow 失败，退化为使用 256x256 PNG 作为 ICO');

      fs.copyFileSync(
        path.join(tempDir, 'icon-256.png'),
        LOGO_ICO
      );
    }
  }

  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log('[图标生成] logo.ico 生成完成\n');
}

async function generateIcns() {
  console.log('[图标生成] 开始生成 logo.icns（macOS）');

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

  // 生成 iconset PNG
  for (const { size, name } of sizes) {
    await sharp(LOGO_PNG)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(path.join(iconsetDir, `${name}.png`));
  }

  console.log('[图标生成] 已生成 iconset PNG');

  if (process.platform === 'darwin') {
    try {
      execSync(`iconutil -c icns ${iconsetDir} -o ${LOGO_ICNS}`);
      console.log('[图标生成] 使用 iconutil 成功生成 logo.icns');
    } catch (error) {
      console.log('[图标生成] iconutil 执行失败，请手动转换');
      console.log('iconset 目录:', iconsetDir);
      return;
    }
  } else {
    console.log('[图标生成] 当前不是 macOS，无法执行 iconutil');
    console.log('请在 macOS 执行以下命令生成 .icns：');
    console.log(`iconutil -c icns ${iconsetDir} -o ${LOGO_ICNS}`);
    return;
  }

  fs.rmSync(iconsetDir, { recursive: true, force: true });

  console.log('[图标生成] logo.icns 生成完成\n');
}

async function main() {
  console.log('[图标生成] 使用 logo.png 生成应用图标\n');

  if (!fs.existsSync(LOGO_PNG)) {
    console.error('[图标生成] 错误：未找到 logo.png');
    console.error('路径：', LOGO_PNG);
    process.exit(1);
  }

  try {
    await generateIco();
    await generateIcns();

    console.log('[图标生成] 全部完成');
    console.log(' ', LOGO_ICO);
    console.log(' ', LOGO_ICNS);
  } catch (error) {
    console.error('[图标生成] 执行失败：', error.message);
    process.exit(1);
  }
}

main();