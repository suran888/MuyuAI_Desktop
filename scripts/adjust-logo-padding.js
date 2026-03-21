#!/usr/bin/env node

/**
 * 调整 logo.png 的边距
 * 将图标内容缩小到 85% 左右,四周留出透明边距
 */

const sharp = require('sharp');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, '../src/ui/assets');
const LOGO_PNG = path.join(ASSETS_DIR, 'logo.png');
const LOGO_BACKUP = path.join(ASSETS_DIR, 'logo-backup.png');

async function adjustLogoPadding() {
  console.log('🎨 调整 logo.png 的边距...\n');
  
  // 备份原始文件
  const fs = require('fs');
  fs.copyFileSync(LOGO_PNG, LOGO_BACKUP);
  console.log('✓ 已备份原始文件到 logo-backup.png');
  
  // 读取原始图片
  const image = sharp(LOGO_PNG);
  const metadata = await image.metadata();
  
  console.log(`✓ 原始尺寸: ${metadata.width}x${metadata.height}`);
  
  // 计算新尺寸 (缩小到 85%)
  const originalSize = 512;
  const contentSize = Math.round(originalSize * 0.85); // 约 435px
  const padding = Math.round((originalSize - contentSize) / 2); // 约 38px
  
  console.log(`✓ 内容尺寸: ${contentSize}x${contentSize}`);
  console.log(`✓ 边距: ${padding}px\n`);
  
  // 调整图片:先缩小内容,然后添加透明边距
  await sharp(LOGO_PNG)
    .resize(contentSize, contentSize, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toFile(path.join(ASSETS_DIR, 'logo-temp.png'));
  
  // 替换原文件
  fs.renameSync(path.join(ASSETS_DIR, 'logo-temp.png'), LOGO_PNG);
  
  console.log('✅ logo.png 调整完成!');
  console.log('   - 原始文件已备份为 logo-backup.png');
  console.log('   - 如需恢复,请手动重命名备份文件\n');
  console.log('💡 建议运行 npm run generate-icons 重新生成图标文件');
}

adjustLogoPadding().catch(error => {
  console.error('❌ 调整失败:', error.message);
  process.exit(1);
});
