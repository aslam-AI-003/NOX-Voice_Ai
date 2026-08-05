// ============================================================
// Namma Ooru Express — Voice Pipeline HTTP/WebSocket Routes
// Exposes the voice pipeline as REST + WebSocket endpoints
// ============================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const {
  startSession,
  endSession,
  getSession,
  getActiveSessions,
  processVoiceTurn,
  processCustomerInput,
  textToSpeech,
  speechToText,
} = require('./voice-pipeline');

// Multer config for audio upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// ─── REST ENDPOINTS ──────────────────────────────────────────

/**
 * POST /api/pipeline/start-session
 * Start a new voice AI session (called when phone connects)
 */
router.post('/start-session', (req, res) => {
  try {
    const { callId, callerPhone, voiceProfile } = req.body;

    if (!callId || !callerPhone) {
      return res.status(400).json({ success: false, error: 'callId and callerPhone required' });
    }

    const session = startSession(callId, callerPhone, voiceProfile);
    const greeting = session.getGreeting();

    res.json({
      success: true,
      callId: session.callId,
      greeting,
      language: session.detectedLanguage,
    });
  } catch (error) {
    console.error('❌ Start session error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/pipeline/process-audio
 * Full pipeline: Upload audio → get audio response
 * Use multipart/form-data with field 'audio'
 */
router.post('/process-audio', upload.single('audio'), async (req, res) => {
  try {
    const { callId } = req.body;
    const audioBuffer = req.file?.buffer;

    if (!callId || !audioBuffer) {
      return res.status(400).json({ success: false, error: 'callId and audio file required' });
    }

    const session = getSession(callId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found. Start a session first.' });
    }

    // Process the full pipeline
    const result = await processVoiceTurn(callId, audioBuffer);

    // Send back both text and audio
    res.json({
      success: true,
      customerText: result.customerText,
      aiText: result.text,
      audioBase64: result.audioBuffer.toString('base64'),
      audioFormat: 'mp3',
      confidence: result.confidence,
      language: result.language,
      toolCalled: result.toolCalled,
      sessionActive: result.sessionActive,
      processingTime: result.totalTime,
    });
  } catch (error) {
    console.error('❌ Process audio error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/pipeline/process-voice
 * Alias for process-audio (browser voice UI uses this)
 */
router.post('/process-voice', upload.single('audio'), async (req, res) => {
  try {
    const { callId, language } = req.body;
    const audioBuffer = req.file?.buffer;

    if (!callId || !audioBuffer) {
      return res.status(400).json({ success: false, error: 'callId and audio file required' });
    }

    const session = getSession(callId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found. Start a session first.' });
    }

    // Process the full pipeline
    const result = await processVoiceTurn(callId, audioBuffer);

    res.json({
      success: true,
      customerText: result.customerText,
      text: result.text,
      audioBase64: result.audioBuffer && result.audioBuffer.length > 0 ? result.audioBuffer.toString('base64') : null,
      confidence: result.confidence,
      language: result.language,
      toolCalled: result.toolCalled,
      sessionActive: result.sessionActive,
      processingTime: result.totalTime,
    });
  } catch (error) {
    console.error('❌ Process voice error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/pipeline/process-text
 * Text-only pipeline: Send text → get text + audio response
 * For testing without microphone
 */
router.post('/process-text', async (req, res) => {
  try {
    const { callId, text, language } = req.body;

    if (!callId || !text) {
      return res.status(400).json({ success: false, error: 'callId and text required' });
    }

    const session = getSession(callId);
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    // Process text through GPT-4o
    const aiResult = await processCustomerInput(callId, text, language || 'ta');

    // Generate audio for response
    let audioBase64 = null;
    try {
      const audioBuffer = await textToSpeech(aiResult.text, session.detectedLanguage);
      audioBase64 = audioBuffer.toString('base64');
    } catch (ttsError) {
      console.warn('TTS failed, returning text only:', ttsError.message);
    }

    res.json({
      success: true,
      customerText: text,
      text: aiResult.text,
      aiText: aiResult.text,
      audioBase64,
      audioFormat: 'mp3',
      toolCalled: aiResult.toolCalled,
      sessionActive: aiResult.sessionActive,
    });
  } catch (error) {
    console.error('❌ Process text error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/pipeline/tts
 * Generate speech from text (standalone TTS)
 */
router.post('/tts', async (req, res) => {
  try {
    const { text, language } = req.body;

    if (!text) {
      return res.status(400).json({ success: false, error: 'text required' });
    }

    const audioBuffer = await textToSpeech(text, language || 'ta');

    // Return as audio file
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
    });
    res.send(audioBuffer);
  } catch (error) {
    console.error('❌ TTS error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/pipeline/stt
 * Transcribe audio (standalone STT)
 */
router.post('/stt', upload.single('audio'), async (req, res) => {
  try {
    const audioBuffer = req.file?.buffer;
    const { language } = req.body;

    if (!audioBuffer) {
      return res.status(400).json({ success: false, error: 'audio file required' });
    }

    const result = await speechToText(audioBuffer, language || 'ta');

    res.json({
      success: true,
      text: result.text,
      language: result.language,
      confidence: result.confidence,
      duration: result.duration,
    });
  } catch (error) {
    console.error('❌ STT error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/pipeline/end-session
 * End a voice session
 */
router.post('/end-session', (req, res) => {
  try {
    const { callId } = req.body;

    if (!callId) {
      return res.status(400).json({ success: false, error: 'callId required' });
    }

    const session = endSession(callId);

    res.json({
      success: true,
      callId,
      turnCount: session?.turnCount || 0,
      message: 'Session ended',
    });
  } catch (error) {
    console.error('❌ End session error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/pipeline/active-sessions
 * Get all active voice sessions (admin)
 */
router.get('/active-sessions', (req, res) => {
  const sessions = getActiveSessions();
  res.json({ success: true, sessions, count: sessions.length });
});

// ─── WEBSOCKET SETUP ─────────────────────────────────────────

/**
 * Setup WebSocket handlers on Socket.IO instance
 * For real-time streaming voice conversations
 */
function setupVoiceWebSocket(io) {
  const voiceNamespace = io.of('/voice');

  voiceNamespace.on('connection', (socket) => {
    console.log(`🎙️ Voice WebSocket connected: ${socket.id}`);

    let currentCallId = null;

    // Start a voice session
    socket.on('start-session', ({ callId, callerPhone, voiceProfile }) => {
      try {
        const session = startSession(callId, callerPhone, voiceProfile);
        currentCallId = callId;
        const greeting = session.getGreeting();

        socket.emit('session-started', { callId, greeting, language: session.detectedLanguage });

        // Generate greeting audio
        textToSpeech(greeting, session.detectedLanguage).then(audioBuffer => {
          socket.emit('ai-audio', {
            audioBase64: audioBuffer.toString('base64'),
            text: greeting,
            format: 'mp3',
          });
        }).catch(err => console.error('Greeting TTS error:', err));

      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Process audio chunk (full turn)
    socket.on('audio-turn', async ({ callId, audioBase64 }) => {
      try {
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        const result = await processVoiceTurn(callId || currentCallId, audioBuffer);

        socket.emit('ai-response', {
          audioBase64: result.audioBuffer.toString('base64'),
          text: result.text,
          customerText: result.customerText,
          confidence: result.confidence,
          language: result.language,
          toolCalled: result.toolCalled,
          sessionActive: result.sessionActive,
          processingTime: result.totalTime,
          format: 'mp3',
        });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // Process text input (for testing)
    socket.on('text-input', async ({ callId, text, language }) => {
      try {
        const aiResult = await processCustomerInput(callId || currentCallId, text, language || 'ta');
        const session = getSession(callId || currentCallId);

        let audioBase64 = null;
        try {
          const audioBuffer = await textToSpeech(aiResult.text, session?.detectedLanguage || 'ta');
          audioBase64 = audioBuffer.toString('base64');
        } catch (e) { /* TTS optional */ }

        socket.emit('ai-response', {
          audioBase64,
          text: aiResult.text,
          customerText: text,
          toolCalled: aiResult.toolCalled,
          sessionActive: aiResult.sessionActive,
          format: 'mp3',
        });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    // End session
    socket.on('end-session', ({ callId }) => {
      endSession(callId || currentCallId);
      socket.emit('session-ended', { callId: callId || currentCallId });
    });

    socket.on('disconnect', () => {
      if (currentCallId) {
        endSession(currentCallId);
      }
      console.log(`🎙️ Voice WebSocket disconnected: ${socket.id}`);
    });
  });

  return voiceNamespace;
}

module.exports = { router, setupVoiceWebSocket };
