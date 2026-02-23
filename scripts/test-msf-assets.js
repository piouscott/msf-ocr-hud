/**
 * Test MSF Assets CDN - Explore available icons and UI assets
 * Usage: node scripts/test-msf-assets.js
 */

const https = require('https');

const BASE_URL = 'https://assets.marvelstrikeforce.com';

// Patterns à tester
const TEST_PATTERNS = [
  // Icônes potentielles
  '/imgs/icons/war.png',
  '/imgs/icons/raid.png',
  '/imgs/icons/calendar.png',
  '/imgs/icons/events.png',
  '/imgs/icons/event.png',
  '/imgs/icons/shield.png',
  '/imgs/icons/defense.png',
  '/imgs/icons/campaign.png',
  '/imgs/icons/farm.png',
  '/imgs/icons/battle.png',
  '/imgs/icons/counter.png',
  '/imgs/icons/star.png',
  '/imgs/icons/gold_star.png',
  '/imgs/icons/red_star.png',
  '/imgs/icons/power.png',
  '/imgs/icons/settings.png',
  '/imgs/icons/gear.png',
  '/imgs/icons/sync.png',
  '/imgs/icons/window.png',

  // Variantes avec underscores
  '/imgs/icons/war_icon.png',
  '/imgs/icons/raid_icon.png',
  '/imgs/icons/event_icon.png',

  // UI backgrounds
  '/imgs/ui/header_bg.png',
  '/imgs/ui/panel_bg.png',
  '/imgs/ui/button_bg.png',
  '/imgs/ui/card_bg.png',

  // Teams icons (peut-être)
  '/imgs/teams/xmen.png',
  '/imgs/teams/avengers.png',
  '/imgs/teams/darkhold.png',

  // SVG variants
  '/imgs/icons/war.svg',
  '/imgs/icons/raid.svg'
];

function testUrl(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      const status = res.statusCode;
      const contentType = res.headers['content-type'] || '';
      const contentLength = res.headers['content-length'] || '?';

      resolve({
        url,
        status,
        contentType,
        size: contentLength,
        exists: status === 200
      });
    }).on('error', (err) => {
      resolve({
        url,
        status: 'ERROR',
        error: err.message,
        exists: false
      });
    });
  });
}

async function exploreAssets() {
  console.log('🔍 Exploration du CDN MSF...\n');
  console.log(`Base URL: ${BASE_URL}\n`);

  const results = {
    found: [],
    notFound: [],
    errors: []
  };

  // Test en parallèle avec limite
  const BATCH_SIZE = 10;
  for (let i = 0; i < TEST_PATTERNS.length; i += BATCH_SIZE) {
    const batch = TEST_PATTERNS.slice(i, i + BATCH_SIZE);
    const promises = batch.map(pattern => testUrl(BASE_URL + pattern));
    const batchResults = await Promise.all(promises);

    batchResults.forEach(result => {
      if (result.exists) {
        results.found.push(result);
        console.log(`✓ ${result.url.replace(BASE_URL, '')}`);
        console.log(`  Type: ${result.contentType}, Size: ${result.size} bytes\n`);
      } else if (result.status === 'ERROR') {
        results.errors.push(result);
      } else {
        results.notFound.push(result);
        console.log(`✗ ${result.url.replace(BASE_URL, '')} (${result.status})`);
      }
    });

    // Petite pause pour ne pas flood le serveur
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`Résumé:`);
  console.log(`  ✓ Trouvés: ${results.found.length}`);
  console.log(`  ✗ Introuvables: ${results.notFound.length}`);
  console.log(`  ⚠ Erreurs: ${results.errors.length}`);

  if (results.found.length > 0) {
    console.log('\n📦 Assets trouvés:\n');
    results.found.forEach(r => {
      const path = r.url.replace(BASE_URL, '');
      console.log(`  "${path.split('/').pop().replace('.png', '').replace('.svg', '')}": "${path}",`);
    });
  }

  if (results.errors.length > 0) {
    console.log('\n⚠ Erreurs:\n');
    results.errors.forEach(r => {
      console.log(`  ${r.url}: ${r.error}`);
    });
  }
}

exploreAssets();
