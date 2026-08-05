// ============================================================
// NOX Voice AI — Namma Ooru Express Voice Ordering Server
// Standalone microservice for AI-powered voice ordering
// ============================================================

// Load environment variables
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Make io globally available for real-time notifications
global.io = io;

// ━━━━ CORS Configuration ━━━━
const ALLOWED_ORIGINS = [
  'http://localhost:3000',  // noe-customer
  'http://localhost:3001',  // noe-vendor
  'http://localhost:3002',  // noe-rider
  'http://localhost:3003',  // noe-admin
  'https://nammaooru.express',
  'https://vendor.nammaooru.express',
  'https://rider.nammaooru.express',
  'https://admin.nammaooru.express',
  process.env.CUSTOMER_APP_URL,
  process.env.VENDOR_APP_URL,
  process.env.RIDER_APP_URL,
  process.env.ADMIN_APP_URL,
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (curl, mobile apps, server-to-server)
    if (!origin) return callback(null, true);
    // Allow all Vercel preview/production deployments
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    // Allow all Render deployments
    if (origin.endsWith('.onrender.com')) return callback(null, true);
    // Allow configured origins
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// Serve Browser Voice UI (static files)
const path = require('path');
app.use(express.static(path.join(__dirname, '..', 'public')));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROUTES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Voice Call Ordering Routes (telephony webhooks + tool endpoints)
const voiceRoutes = require('./voice-routes');
app.use('/api/voice', voiceRoutes);

// Voice AI Pipeline Routes (STT → LLM → TTS pipeline)
const { router: pipelineRoutes, setupVoiceWebSocket } = require('./voice-api-routes');
app.use('/api/pipeline', pipelineRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'NOX Voice AI',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SOCKET.IO — Real-time connections
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Join rooms based on role/userId
  socket.on('join-room', ({ userId, role }) => {
    if (userId) socket.join(`user-${userId}`);
    if (role) socket.join(`role-${role}`);
    console.log(`  → ${socket.id} joined: user-${userId}, role-${role}`);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Socket disconnected: ${socket.id}`);
  });
});

// Setup Voice WebSocket namespace
if (setupVoiceWebSocket) {
  setupVoiceWebSocket(io);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// START SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║        🎙️  NOX VOICE AI SERVER RUNNING              ║
╠══════════════════════════════════════════════════════╣
║  Port:      ${PORT}                                       ║
║  Health:    http://localhost:${PORT}/api/health            ║
║  Voice API: http://localhost:${PORT}/api/voice             ║
║  Pipeline:  http://localhost:${PORT}/api/pipeline          ║
║  WebSocket: ws://localhost:${PORT}/voice                   ║
╠══════════════════════════════════════════════════════╣
║  📱 Connected Apps (via Firebase):                   ║
║    • noe-vendor → receives orders                    ║
║    • noe-rider  → gets delivery assignments          ║
║    • noe-admin  → monitors calls & analytics         ║
╚══════════════════════════════════════════════════════╝
  `);
});

module.exports = { app, server, io };
