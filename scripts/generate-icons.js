#!/usr/bin/env node

/**
 * �?logo.png 生成 logo.ico �?logo.icns
 * 
 * 使用方法�?
 *   npm run generate-icons
 * 
 * 或直接运行：
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
  console.log('📦 生成 logo.ico (Windows 图标)...');
  
  // ICO 文件需要多个尺寸：16x16, 32x32, 48x48, 64x64, 128x128, 256x256
  const sizes = [16, 32, 48, 64, 128, 256];
  const tempDir = path.join(__dirname, '../temp-ico');
  
  // 创建临时目录
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  // 生成各个尺寸�?PNG
  for (const size of sizes) {
    await sharp(LOGO_PNG)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(tempDir, `icon-${size}.png`));
  }
  
  console.log('  �?生成了各个尺寸的图标');
  
  // 检查是否安装了 ImageMagick
  try {
    // 尝试使用 magick (ImageMagick v7) �?convert (v6)
    let convertCmd = 'convert';
    try {
      execSync('magick -version', { stdio: 'ignore' });
      convertCmd = 'magick';
    } catch {
      execSync('convert -version', { stdio: 'ignore' });
    }
    
    // 使用 ImageMagick 合并�?ICO
    const pngFiles = sizes.map(s => path.join(tempDir, `icon-${s}.png`)).join(' ');
    execSync(`${convertCmd} ${pngFiles} ${LOGO_ICO}`, { stdio: 'ignore' });
    console.log('  �?使用 ImageMagick 生成 logo.ico');
  } catch (error) {
    // 如果没有 ImageMagick，尝试使�?python+pillow 生成多尺�?ICO
    console.log('  ⚠️  未安�?ImageMagick，尝试使�?Python(pillow) 生成多尺�?ICO');
    try {
      const pyBin = 'python';
      const pyScript = path.join(__dirname, 'generate-windows-ico.py');
      execSync(`"${pyBin}" "${pyScript}"`, { stdio: 'ignore' });
      console.log('  �?使用 Python(pillow) 生成 logo.ico');
    } catch (pythonError) {
      // 最后兜底：只用最大的尺寸作为 ICO
      console.log('  ⚠️  Python(pillow) 生成失败，退化为 256x256 PNG 作为 ICO');
      fs.copyFileSync(path.join(tempDir, 'icon-256.png'), LOGO_ICO);
    }
  }
  
  // 清理临时文件
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('�?logo.ico 生成完成\n');
}

async function generateIcns() {
  console.log('📦 生成 logo.icns (macOS 图标)...');
  
  // ICNS 需要的尺寸
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
  
  // 创建 iconset 目录
  if (!fs.existsSync(iconsetDir)) {
    fs.mkdirSync(iconsetDir, { recursive: true });
  }
  
  // 生成各个尺寸�?PNG
  for (const { size, name } of sizes) {
    await sharp(LOGO_PNG)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(iconsetDir, `${name}.png`));
  }
  
  console.log('  �?生成了各个尺寸的图标');
  
  // 检查是否在 macOS 上并且有 iconutil
  if (process.platform === 'darwin') {
    try {
      execSync(`iconutil -c icns ${iconsetDir} -o ${LOGO_ICNS}`);
      console.log('  �?使用 iconutil 生成 logo.icns');
    } catch (error) {
      console.log('  ⚠️  iconutil 执行失败，请手动转换');
      console.log(`  iconset 目录: ${iconsetDir}`);
      return;
    }
  } else {
    console.log('  ⚠️  �?macOS 系统，无法使�?iconutil');
    console.log('  请在 macOS 上运行以下命令生�?.icns:');
    console.log(`  iconutil -c icns ${iconsetDir} -o ${LOGO_ICNS}`);
    return;
  }
  
  // 清理临时文件
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  console.log('�?logo.icns 生成完成\n');
}

async function main() {
  console.log('🎨 �?logo.png 生成应用图标\n');
  
  // 检�?logo.png 是否存在
  if (!fs.existsSync(LOGO_PNG)) {
    console.error('�?错误: logo.png 不存�?);
    console.error(`   路径: ${LOGO_PNG}`);
    process.exit(1);
  }
  
  try {
    await generateIco();
    await generateIcns();
    
    console.log('🎉 所有图标生成完成！');
    console.log(`   - ${LOGO_ICO}`);
    console.log(`   - ${LOGO_ICNS}`);
  } catch (error) {
    console.error('�?生成图标时出�?', error.message);
    process.exit(1);
  }
}

main();
