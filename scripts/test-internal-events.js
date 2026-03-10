/**
 * Script pour tester les endpoints events de l'API interne MSF
 * Usage: node scripts/test-internal-events.js <x-titan-token>
 */

const token = process.argv[2];

if (!token) {
  console.log('Usage: node scripts/test-internal-events.js <x-titan-token>');
  console.log('Recuperez le token depuis le storage de l\'extension ou les DevTools');
  process.exit(1);
}

const BASE_URL = 'https://api-prod.marvelstrikeforce.com';

const endpoints = [
  '/services/api/getEvents',
  '/services/api/events',
  '/services/api/getMilestones',
  '/services/api/milestones',
  '/services/api/getActiveEvents',
  '/services/api/getEventInfo',
  '/services/api/getEventCampaign',
  '/services/api/getEventCampaigns',
  '/services/api/getBlitz',
  '/services/api/getWarInfo',
  '/services/api/getCurrentEvents',
];

async function testEndpoint(endpoint) {
  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      headers: {
        'x-titan-token': token,
        'x-app-version': '9.6.0-hp2',
        'Accept': 'application/json'
      }
    });

    const status = response.status;
    let data = null;

    try {
      data = await response.json();
    } catch (e) {
      data = await response.text();
    }

    return { endpoint, status, data };
  } catch (err) {
    return { endpoint, status: 'error', error: err.message };
  }
}

async function main() {
  console.log('Testing internal API endpoints for events...\n');

  for (const endpoint of endpoints) {
    const result = await testEndpoint(endpoint);
    console.log(`${endpoint}`);
    console.log(`  Status: ${result.status}`);
    if (result.status === 200) {
      const preview = JSON.stringify(result.data).substring(0, 200);
      console.log(`  Data: ${preview}...`);
    } else if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
    console.log('');
  }
}

main();
