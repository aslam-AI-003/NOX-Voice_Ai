// ============================================================
// Namma Ooru Express — AI Voice Pipeline (100% FREE)
// Provider: Groq (LLM + STT) + edge-tts (TTS)
// Cost: ₹0 — No payment, no card, completely free!
// ============================================================

const crypto = require('crypto');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Load system prompt and tools
const VOICE_AGENT_SYSTEM_PROMPT = require('./voice-agent-config').SYSTEM_PROMPT;
const VOICE_AGENT_TOOLS = require('./voice-agent-config').TOOLS;

// ━━━━ CONFIGURATION ━━━━

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_LLM_MODEL = 'llama-3.3-70b-versatile'; // Best available for function calling + Tamil
const GROQ_STT_MODEL = 'whisper-large-v3'; // Best for Tamil speech recognition
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

// Active conversation sessions
const sessions = new Map();

// ━━━━ VOICE SESSION CLASS ━━━━

class VoiceSession {
  constructor(callId, callerPhone, voiceProfile = null) {
    this.callId = callId;
    this.callerPhone = callerPhone;
    this.voiceProfile = voiceProfile;
    this.conversationHistory = [];
    this.createdAt = new Date().toISOString();
    this.detectedLanguage = voiceProfile?.preferredLanguage || 'ta';
    this.turnCount = 0;
    this.isActive = true;
    this.partialOrder = null;

    // Initialize with system prompt
    this.conversationHistory.push({
      role: 'system',
      content: this._buildSystemPrompt(),
    });
  }

  _buildSystemPrompt() {
    let prompt = VOICE_AGENT_SYSTEM_PROMPT;

    if (this.voiceProfile) {
      prompt += `\n\nCALLER CONTEXT (from previous interactions):
- Phone: ${this.callerPhone}
- Name: ${this.voiceProfile.knownName || 'Unknown'}
- Preferred Language: ${this.voiceProfile.preferredLanguage || 'Tamil'}
- Total previous voice orders: ${this.voiceProfile.totalVoiceOrders || 0}
- Default area: ${this.voiceProfile.defaultArea || 'Not set'}
- Last order: ${this.voiceProfile.lastOrderId || 'None'}`;
    }

    return prompt;
  }

  getGreeting() {
    if (this.voiceProfile?.knownName) {
      return `Vanakkam ${this.voiceProfile.knownName}! Namma Ooru Express. Enga area la irukkeenga?`;
    }
    return 'Vanakkam! Namma Ooru Express. Enga area la irukkeenga?';
  }
}

// ━━━━ GROQ LLM (Llama 3.3 70B — FREE) ━━━━

/**
 * Call Groq LLM with OpenAI-compatible API
 */
async function callGroqLLM(messages, tools = null) {
  const requestBody = {
    model: GROQ_LLM_MODEL,
    messages,
    temperature: 0.7,
    max_tokens: 300,
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools.map(tool => ({
      type: 'function',
      function: tool.function,
    }));
    requestBody.tool_choice = 'auto';
    requestBody.parallel_tool_calls = false; // Prevents format issues with Llama
  }

  // Retry logic for intermittent tool_use_failed errors
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await axios.post(`${GROQ_BASE_URL}/chat/completions`, requestBody, {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      return response.data;
    } catch (error) {
      lastError = error;
      const errMsg = error.response?.data?.error?.code || '';
      if (errMsg === 'tool_use_failed' && attempt < 2) {
        console.log(`  ⚠️ Tool format error, retrying (attempt ${attempt + 1})...`);
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

// ━━━━ MAIN PIPELINE FUNCTIONS ━━━━

function startSession(callId, callerPhone, voiceProfile = null) {
  const session = new VoiceSession(callId, callerPhone, voiceProfile);
  sessions.set(callId, session);
  console.log(`🎙️ Voice session started: ${callId} for ${callerPhone}`);
  return session;
}

/**
 * Process customer text through Groq (Llama 3.3 70B)
 */
async function processCustomerInput(callId, customerText, language = 'ta') {
  const session = sessions.get(callId);
  if (!session || !session.isActive) {
    throw new Error(`No active session for callId: ${callId}`);
  }

  session.turnCount++;
  session.detectedLanguage = language;

  // Add user message
  session.conversationHistory.push({
    role: 'user',
    content: customerText,
  });

  console.log(`👤 [${callId}] Customer (${language}): ${customerText}`);

  try {
    console.log(`  → Using: Groq/${GROQ_LLM_MODEL} (FREE)`);

    const response = await callGroqLLM(session.conversationHistory, VOICE_AGENT_TOOLS);
    const message = response.choices[0].message;

    // Handle tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      return await handleToolCalls(callId, message);
    }

    // Regular text response
    const aiResponse = message.content || '';
    session.conversationHistory.push({
      role: 'assistant',
      content: aiResponse,
    });

    console.log(`🤖 [${callId}] AI: ${aiResponse}`);

    return {
      text: aiResponse,
      toolCalled: null,
      sessionActive: session.isActive,
    };
  } catch (error) {
    console.error(`❌ [${callId}] Groq LLM error:`, error.response?.data || error.message);

    const fallback = language === 'en'
      ? "Sorry, I had a small technical issue. Could you please repeat that?"
      : "Sorry, oru small technical problem. Thiruppi sollunga please?";

    return {
      text: fallback,
      toolCalled: null,
      sessionActive: true,
      error: error.message,
    };
  }
}

/**
 * Handle tool/function calls
 */
async function handleToolCalls(callId, assistantMessage) {
  const session = sessions.get(callId);

  // Add assistant message with tool calls to history
  session.conversationHistory.push(assistantMessage);

  const toolResults = [];

  for (const toolCall of assistantMessage.tool_calls) {
    const functionName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments);

    console.log(`🔧 [${callId}] Tool call: ${functionName}(${JSON.stringify(args)})`);

    const result = await executeToolCall(callId, functionName, args);
    toolResults.push({
      tool_call_id: toolCall.id,
      role: 'tool',
      content: JSON.stringify(result),
    });

    console.log(`🔧 [${callId}] Tool result: ${JSON.stringify(result).slice(0, 200)}`);
  }

  // Add tool results to history
  session.conversationHistory.push(...toolResults);

  // Get follow-up response
  const followUp = await callGroqLLM(session.conversationHistory, VOICE_AGENT_TOOLS);
  const followUpMessage = followUp.choices[0].message;

  // Handle chained tool calls
  if (followUpMessage.tool_calls && followUpMessage.tool_calls.length > 0 && session.turnCount < 20) {
    return await handleToolCalls(callId, followUpMessage);
  }

  const aiResponse = followUpMessage.content || '';
  session.conversationHistory.push({
    role: 'assistant',
    content: aiResponse,
  });

  console.log(`🤖 [${callId}] AI (after tool): ${aiResponse}`);

  return {
    text: aiResponse,
    toolCalled: assistantMessage.tool_calls[0]?.function?.name,
    sessionActive: session.isActive,
  };
}

/**
 * Execute tool calls — calls our backend API endpoints
 */
async function executeToolCall(callId, functionName, args) {
  const session = sessions.get(callId);
  const baseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`;

  try {
    switch (functionName) {
      case 'search_shops': {
        const response = await axios.post(`${baseUrl}/api/voice/search-shops`, {
          area: args.area,
          item_category: args.item_category,
          item_name: args.item_name,
        });
        return response.data;
      }

      case 'search_item': {
        const response = await axios.post(`${baseUrl}/api/voice/search-item`, {
          shop_id: args.shop_id,
          item_query: args.item_query,
        });
        return response.data;
      }

      case 'get_last_order': {
        const response = await axios.get(`${baseUrl}/api/voice/last-order/${encodeURIComponent(args.caller_phone)}`);
        return response.data;
      }

      case 'create_order': {
        const response = await axios.post(`${baseUrl}/api/voice/create-order`, {
          shop_id: args.shop_id,
          items: args.items,
          customer_phone: args.customer_phone || session.callerPhone,
          delivery_address: args.delivery_address,
          customer_name: args.customer_name || session.voiceProfile?.knownName,
          call_id: callId,
        });
        if (response.data.success) session.partialOrder = response.data;
        return response.data;
      }

      case 'transfer_to_human': {
        const response = await axios.post(`${baseUrl}/api/voice/transfer-human`, {
          call_id: callId,
          reason: args.reason,
          context_summary: args.context_summary,
        });
        session.isActive = false;
        return response.data;
      }

      case 'send_sms_confirmation': {
        const response = await axios.post(`${baseUrl}/api/voice/send-sms`, {
          customer_phone: args.customer_phone || session.callerPhone,
          order_summary: args.order_summary,
          order_id: args.order_id,
        });
        return response.data;
      }

      default:
        return { success: false, error: `Unknown tool: ${functionName}` };
    }
  } catch (error) {
    console.error(`❌ Tool execution error (${functionName}):`, error.message);
    return { success: false, error: error.message };
  }
}

// ━━━━ GROQ WHISPER STT (FREE — Tamil supported) ━━━━

/**
 * Transcribe audio using Groq Whisper (OpenAI-compatible API)
 */
async function speechToText(audioBuffer, language = 'ta') {
  try {
    const FormData = require('form-data');
    const form = new FormData();

    // Write buffer to temp file (Groq requires file upload)
    const tmpFile = path.join(os.tmpdir(), `noe_stt_${Date.now()}.webm`);
    fs.writeFileSync(tmpFile, audioBuffer);

    form.append('file', fs.createReadStream(tmpFile));
    form.append('model', GROQ_STT_MODEL);
    form.append('language', language === 'ta' ? 'ta' : 'en');
    form.append('response_format', 'verbose_json');
    form.append('prompt', 'Tamil grocery ordering conversation. Common words: arisi, paal, muttai, ennai, kari, kaai, venum, venaam, packet, kilo');

    const response = await axios.post(`${GROQ_BASE_URL}/audio/transcriptions`, form, {
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        ...form.getHeaders(),
      },
      timeout: 15000,
    });

    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch (e) {}

    const detectedLang = response.data.language === 'tamil' ? 'ta'
      : response.data.language === 'english' ? 'en'
      : 'tanglish';

    return {
      text: response.data.text || '',
      language: detectedLang,
      confidence: 85, // Whisper doesn't give confidence directly
      duration: response.data.duration || 0,
    };
  } catch (error) {
    console.error('❌ Groq STT error:', error.response?.data || error.message);
    throw new Error(`Speech-to-Text failed: ${error.message}`);
  }
}

async function speechToTextFromFile(filePath, language = 'ta') {
  const audioBuffer = fs.readFileSync(filePath);
  return await speechToText(audioBuffer, language);
}

// ━━━━ EDGE-TTS (Microsoft FREE — Tamil voices via Python CLI) ━━━━

/**
 * Convert text to speech using edge-tts Python CLI (pip install edge-tts)
 * Tamil voice: ta-IN-PallaviNeural (female, excellent quality)
 * English voice: en-IN-NeerjaNeural (female, Indian English)
 * Install: pip install edge-tts
 */
async function textToSpeech(text, language = 'ta') {
  const voice = language === 'ta' || language === 'tanglish'
    ? 'ta-IN-PallaviNeural'
    : 'en-IN-NeerjaNeural';

  const tmpFile = path.join(os.tmpdir(), `noe_tts_${Date.now()}.mp3`);

  try {
    // Escape text for shell (remove quotes, limit length)
    const safeText = text.replace(/["`$\\]/g, '').slice(0, 500);

    await new Promise((resolve, reject) => {
      const cmd = `edge-tts --voice "${voice}" --text "${safeText}" --write-media "${tmpFile}"`;
      exec(cmd, { timeout: 15000 }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });

    const audioBuffer = fs.readFileSync(tmpFile);
    try { fs.unlinkSync(tmpFile); } catch (e) {}

    console.log(`🔊 TTS (${voice}): ${text.slice(0, 50)}... (${audioBuffer.length} bytes)`);
    return audioBuffer;
  } catch (error) {
    console.error('❌ edge-tts error:', error.message);
    console.warn('⚠️ TTS unavailable — install with: pip install edge-tts');
    // Return empty buffer (browser UI will use Web Speech API as fallback)
    try { fs.unlinkSync(tmpFile); } catch (e) {}
    return Buffer.alloc(0);
  }
}

// ━━━━ FULL PIPELINE: Audio In → Audio Out ━━━━

async function processVoiceTurn(callId, audioBuffer) {
  const session = sessions.get(callId);
  if (!session) throw new Error(`No session found for: ${callId}`);

  const startTime = Date.now();

  // Step 1: Speech-to-Text (Groq Whisper — FREE)
  console.log(`\n━━━ TURN ${session.turnCount + 1} ━━━`);
  const sttResult = await speechToText(audioBuffer, session.detectedLanguage);
  console.log(`📝 STT (${Date.now() - startTime}ms): "${sttResult.text}" [${sttResult.language}]`);

  if (!sttResult.text || sttResult.text.trim() === '') {
    const repeatText = session.detectedLanguage === 'en'
      ? "I didn't catch that. Could you please repeat?"
      : "Puriyala, thiruppi sollunga please?";
    const audioOut = await textToSpeech(repeatText, session.detectedLanguage);
    return { audioBuffer: audioOut, text: repeatText, customerText: '', confidence: 0 };
  }

  // Step 2: Process through Groq LLM (Llama 3.3 70B — FREE)
  const aiResult = await processCustomerInput(callId, sttResult.text, sttResult.language);
  console.log(`🤖 LLM (${Date.now() - startTime}ms): "${aiResult.text.slice(0, 100)}"`);

  // Step 3: Text-to-Speech (edge-tts — FREE Tamil voice)
  const audioOut = await textToSpeech(aiResult.text, session.detectedLanguage);
  console.log(`🔊 TTS (${Date.now() - startTime}ms): ${audioOut.length} bytes`);
  console.log(`⏱️ Total turn time: ${Date.now() - startTime}ms`);

  // Emit to admin dashboard
  if (global.io) {
    global.io.to('role-admin').emit('voice-transcript-update', {
      callId,
      turns: [
        { speaker: 'customer', text: sttResult.text, language: sttResult.language, confidence: sttResult.confidence },
        { speaker: 'ai', text: aiResult.text, toolCalled: aiResult.toolCalled },
      ],
    });
  }

  return {
    audioBuffer: audioOut,
    text: aiResult.text,
    customerText: sttResult.text,
    confidence: sttResult.confidence,
    language: sttResult.language,
    toolCalled: aiResult.toolCalled,
    sessionActive: aiResult.sessionActive,
    totalTime: Date.now() - startTime,
  };
}

// ━━━━ SESSION MANAGEMENT ━━━━

function endSession(callId) {
  const session = sessions.get(callId);
  if (session) {
    session.isActive = false;
    console.log(`🔚 Session ended: ${callId} (${session.turnCount} turns)`);
  }
  sessions.delete(callId);
  return session;
}

function getSession(callId) {
  return sessions.get(callId);
}

function getActiveSessions() {
  return Array.from(sessions.values()).filter(s => s.isActive).map(s => ({
    callId: s.callId,
    callerPhone: s.callerPhone,
    turnCount: s.turnCount,
    language: s.detectedLanguage,
    startedAt: s.createdAt,
    duration: Math.floor((Date.now() - new Date(s.createdAt).getTime()) / 1000),
  }));
}

// ━━━━ EXPORTS ━━━━

module.exports = {
  startSession,
  endSession,
  getSession,
  getActiveSessions,
  processVoiceTurn,
  processCustomerInput,
  speechToText,
  textToSpeech,
  speechToTextFromFile,
  VoiceSession,
};
