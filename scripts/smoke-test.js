// Smoke Test - 自动验证系统关键功能
const http = require('http');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const TIMEOUT = 10000;

function request(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: 10000,
    };

    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runSmokeTest() {
  console.log('🚀 Starting Smoke Test...\n');
  
  let passed = 0;
  let failed = 0;
  let sessionToken = null;
  let sessionCookie = null;

  // Get password from environment
  const accessPassword = process.env.SITE_ACCESS_PASSWORD || 'please-change-this';
  console.log(`Using access password: ${accessPassword ? 'configured' : 'not configured'}`);

  // Step 0: Login
  try {
    console.log('[0/4] Testing login...');
    const res = await request('/api/session/login', 'POST', {
      password: accessPassword,
      studentId: 'smoke001',
      name: 'Smoke Test User',
      role: 'teacher'
    });
    if (res.status === 200 && res.data.token) {
      sessionToken = res.data.token;
      // Extract cookie from response headers
      const setCookie = res.headers['set-cookie'];
      if (setCookie) {
        sessionCookie = Array.isArray(setCookie)
          ? setCookie.map(v => v.split(';')[0]).join('; ')
          : setCookie.split(';')[0];
      }
      console.log('✅ Login successful');
      passed++;
    } else {
      throw new Error(`Login failed: ${JSON.stringify(res)}`);
    }
  } catch (e) {
    console.error('❌ Login failed:', e.message);
    console.error('💡 Hint: Make sure SITE_ACCESS_PASSWORD is set in .env file');
    failed++;
    return; // Exit early if login fails
  }

  console.log('');

  // Test 1: Health Check
  try {
    console.log('[1/4] Testing /api/system/health...');
    const res = await request('/api/system/health');
    if (res.status === 200 && res.data.status === 'ok') {
      console.log('✅ Health check passed');
      console.log(`   Status: ${res.data.status}`);
      console.log(`   AI Enabled: ${res.data.aiEnabled}`);
      passed++;
    } else {
      throw new Error(`Unexpected response: ${JSON.stringify(res)}`);
    }
  } catch (e) {
    console.error('❌ Health check failed:', e.message);
    failed++;
  }

  console.log('');

  // Test 2: Create Room
  let roomCode = null;
  try {
    console.log('[2/4] Testing room creation...');
    const res = await request('/api/room/create', 'POST', {}, {
      'Cookie': sessionCookie
    });
    if (res.status === 200 && res.data.roomCode) {
      roomCode = res.data.roomCode;
      console.log(`✅ Room created successfully`);
      console.log(`   Room Code: ${roomCode}`);
      passed++;
    } else {
      throw new Error(`Failed to create room: ${JSON.stringify(res)}`);
    }
  } catch (e) {
    console.error('❌ Room creation failed:', e.message);
    failed++;
  }

  console.log('');

  // Test 3: Check Room Exists
  if (roomCode) {
    try {
      console.log('[3/4] Testing room check...');
      const res = await request(`/api/room/check/${roomCode}`);
      if (res.status === 200 && res.data.exists === true) {
        console.log('✅ Room check passed');
        console.log(`   Room exists: ${res.data.exists}`);
        passed++;
      } else {
        throw new Error(`Room not found: ${JSON.stringify(res)}`);
      }
    } catch (e) {
      console.error('❌ Room check failed:', e.message);
      failed++;
    }
  } else {
    console.log('[3/4] ⏭️  Skipped (no room code from test 2)');
    failed++;
  }

  console.log('');

  // Test 4: Test Records API
  try {
    console.log('[4/4] Testing records API...');
    const res = await request('/api/records?limit=1', 'GET', null, {
      'Cookie': sessionCookie
    });
    if (res.status === 200 && res.data.ok === true) {
      console.log('✅ Records API passed');
      console.log(`   Records count: ${res.data.records ? res.data.records.length : 0}`);
      passed++;
    } else {
      throw new Error(`Records API failed: ${JSON.stringify(res)}`);
    }
  } catch (e) {
    console.error('❌ Records API failed:', e.message);
    failed++;
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 Smoke Test Results');
  console.log('='.repeat(50));
  console.log(`✅ Passed: ${passed}/5`);
  console.log(`❌ Failed: ${failed}/5`);
  console.log('='.repeat(50));

  if (failed > 0) {
    console.log('\n❌ Smoke test FAILED - Please check the errors above');
    process.exit(1);
  } else {
    console.log('\n✅ All smoke tests PASSED - System is healthy!');
    process.exit(0);
  }
}

// 等待服务器启动
console.log('⏳ Waiting for server to be ready...\n');
setTimeout(() => {
  runSmokeTest().catch((err) => {
    console.error('\n💥 Smoke test crashed:', err);
    process.exit(1);
  });
}, 2000);
