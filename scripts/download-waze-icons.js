#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');

const ICONS = {
  'accident': 'https://web-assets.waze.com/livemap/stg/accident-major-77533cae62f7b143d7da09ef164b30eb.svg',
  'closure': 'https://web-assets.waze.com/livemap/stg/closure-60cedd129f0979f68901a6eae498cfca.svg',
  'hazard': 'https://web-assets.waze.com/livemap/stg/hazard-6f4014190cae4f1e2f348845aa5ebb39.svg',
  'object-on-road': 'https://web-assets.waze.com/livemap/stg/object-on-road-b0e123b9b77f783ea2b8e160adeab371.svg',
  'police': 'https://web-assets.waze.com/livemap/stg/police-c6e927d3b03d9fb6c9166bccbb1d6558.svg',
};

const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');

// Create icons directory if it doesn't exist
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  console.log('✓ Created public/icons directory');
}

function downloadFile(url, filename) {
  return new Promise((resolve, reject) => {
    const filepath = path.join(ICONS_DIR, filename);
    const file = fs.createWriteStream(filepath);
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        https.get(response.headers.location, (redirectResponse) => {
          redirectResponse.pipe(file);
          file.on('finish', () => {
            file.close();
            console.log(`✓ Downloaded ${filename}`);
            resolve();
          });
        }).on('error', reject);
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log(`✓ Downloaded ${filename}`);
          resolve();
        });
      }
    }).on('error', (err) => {
      fs.unlink(filepath, () => {}); // Delete partial file
      reject(err);
    });
  });
}

async function main() {
  console.log('Downloading Waze icons...\n');
  
  const downloads = Object.entries(ICONS).map(([name, url]) => 
    downloadFile(url, `${name}.svg`)
  );
  
  try {
    await Promise.all(downloads);
    console.log('\n✅ All icons downloaded successfully!');
    console.log(`   Location: ${ICONS_DIR}`);
  } catch (error) {
    console.error('\n❌ Error downloading icons:', error.message);
    process.exit(1);
  }
}

main();

