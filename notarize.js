const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 60000; // 60 seconds

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isNetworkError(error) {
  const msg = error.message || error.toString();
  return msg.includes('offline') || 
         msg.includes('NSURLErrorDomain') || 
         msg.includes('network') ||
         msg.includes('No network route');
}

/**
 * Use xcrun notarytool directly instead of @electron/notarize
 * to avoid network issues with the library
 */
async function notarizeWithXcrun(appPath, appleId, password, teamId) {
  // Create a zip file for notarization
  const appName = path.basename(appPath, '.app');
  const zipPath = path.join(path.dirname(appPath), `${appName}.zip`);
  
  console.log(`📦 Creating zip archive: ${zipPath}`);
  execSync(`ditto -c -k --keepParent "${appPath}" "${zipPath}"`, { stdio: 'inherit' });
  
  try {
    console.log('📤 Submitting to Apple notary service...');
    
    let lastError;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`🔄 Notarization attempt ${attempt}/${MAX_RETRIES}...`);
        
        // Submit for notarization and wait for result
        const result = execSync(
          `xcrun notarytool submit "${zipPath}" --apple-id "${appleId}" --password "${password}" --team-id "${teamId}" --wait`,
          { encoding: 'utf8', stdio: 'inherit', timeout: 30 * 60 * 1000 } // 30 min timeout
        );
        
        if (result) console.log(result);
        
        // Staple the notarization ticket to the app
        console.log('📎 Stapling notarization ticket...');
        execSync(`xcrun stapler staple "${appPath}"`, { stdio: 'inherit' });
        
        console.log('✅ Notarization and stapling complete!');
        return; // Success!
        
      } catch (error) {
        lastError = error;
        console.error(`❌ Attempt ${attempt} failed:`, error.message);
        
        if (isNetworkError(error) && attempt < MAX_RETRIES) {
          console.log(`⏳ Network error detected. Waiting ${RETRY_DELAY_MS / 1000}s before retry...`);
          await sleep(RETRY_DELAY_MS);
        } else if (attempt >= MAX_RETRIES) {
          throw error;
        } else {
          throw error; // Non-network error, don't retry
        }
      }
    }
    
    throw lastError;
  } finally {
    // Clean up zip file
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
  }
}

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  console.log('🔐 Checking for notarization credentials...');

  const { appOutDir } = context;
  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
    console.log('⚠️  Skipping notarization: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID environment variables are not set.');
    console.log('⚠️  The app will not be notarized. Users will need to bypass Gatekeeper manually.');
    return;
  }

  console.log('🔐 Notarizing macOS build using xcrun notarytool...');

  await notarizeWithXcrun(
    appPath,
    process.env.APPLE_ID,
    process.env.APPLE_APP_SPECIFIC_PASSWORD,
    process.env.APPLE_TEAM_ID
  );

  console.log(`✅ Successfully notarized ${appName}`);
}; 