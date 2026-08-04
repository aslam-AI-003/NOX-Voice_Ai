#!/usr/bin/env node
// ============================================================
// Namma Ooru Express — Voice AI Pipeline Test Script
// Interactive CLI to test the voice ordering AI
// ============================================================
// 
// USAGE:
//   1. Start the server:  OPENAI_API_KEY=sk-xxx node server/index.js
//   2. Run this test:     node scripts/test-voice-pipeline.js
//
// This lets you type messages as if you're a customer on the phone,
// and see the AI responses (text mode — no microphone needed).
// ============================================================

const readline = require('readline');
const http = require('http');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3001';
const CALL_ID = `test_${Date.now().toString(36)}`;
const CALLER_PHONE = '+919876543210';

// ─── HTTP Helper ─────────────────────────────────────────────

function apiCall(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ─── MAIN TEST ───────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║  🎙️  NOE AI Voice Ordering — Interactive Test           ║');
  console.log('║  Type messages as a Tamil customer ordering groceries   ║');
  console.log('║  Type "quit" to exit                                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // Step 1: Check server health
  try {
    const health = await apiCall('GET', '/api/health');
    console.log(`✅ Server: ${health.message}\n`);
  } catch (e) {
    console.error('❌ Server not running! Start it first:');
    console.error(`   OPENAI_API_KEY=your_key node server/index.js\n`);
    process.exit(1);
  }

  // Step 2: Start a voice session
  console.log('📞 Starting voice session...');
  const sessionResult = await apiCall('POST', '/api/pipeline/start-session', {
    callId: CALL_ID,
    callerPhone: CALLER_PHONE,
  });

  if (!sessionResult.success) {
    console.error('❌ Failed to start session:', sessionResult.error);
    process.exit(1);
  }

  console.log(`✅ Session started: ${CALL_ID}`);
  console.log(`🤖 AI Greeting: "${sessionResult.greeting}"\n`);
  console.log('─'.repeat(60));
  console.log('💡 Try saying things like:');
  console.log('   • "Thanjavur-la oru shop la irundhu rice venum"');
  console.log('   • "Milk 2 packet, bread 1, eggs 12"');
  console.log('   • "Last order maadhiri same order podu"');
  console.log('   • "How much total?"');
  console.log('   • "Confirm pannu"');
  console.log('─'.repeat(60) + '\n');

  // Step 3: Interactive conversation
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '👤 You: ',
  });

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
      // End session
      await apiCall('POST', '/api/pipeline/end-session', { callId: CALL_ID });
      console.log('\n📞 Call ended. Vanakkam! 🙏\n');
      rl.close();
      process.exit(0);
    }

    // Detect language
    const language = /[அ-ஹ]/.test(input) ? 'ta' 
      : /[a-zA-Z]/.test(input) && (/illa|venum|podu|pannu|sollu|enna|vanakkam/i.test(input)) ? 'tanglish'
      : 'en';

    try {
      const startTime = Date.now();
      const result = await apiCall('POST', '/api/pipeline/process-text', {
        callId: CALL_ID,
        text: input,
        language,
      });

      const elapsed = Date.now() - startTime;

      if (result.success) {
        console.log(`\n🤖 AI (${elapsed}ms): ${result.aiText}`);
        if (result.toolCalled) {
          console.log(`   🔧 [Used tool: ${result.toolCalled}]`);
        }
        if (!result.sessionActive) {
          console.log('\n📞 Session ended by AI (transferred to human or call complete)');
          rl.close();
          process.exit(0);
        }
      } else {
        console.log(`\n❌ Error: ${result.error}`);
      }
    } catch (error) {
      console.log(`\n❌ Request failed: ${error.message}`);
    }

    console.log('');
    rl.prompt();
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
