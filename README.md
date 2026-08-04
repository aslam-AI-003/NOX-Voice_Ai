# 🎙️ NOX Voice AI

**Namma Ooru Express — AI Voice Ordering System**

A standalone Node.js microservice that handles AI-powered voice ordering for Namma Ooru Express hyperlocal delivery platform. Customers call a phone number, speak in Tamil/Tanglish, and the AI takes their order — no app needed!

---

## 🏗️ Architecture

```
📞 Customer calls
     ↓
┌─────────────────────────────────────┐
│       NOX VOICE AI (this repo)       │
│                                     │
│  Telephony Webhook                  │
│       ↓                             │
│  STT (Speech-to-Text)               │
│       ↓                             │
│  GPT-4 (AI Agent + Tool Calls)      │
│       ↓                             │
│  TTS (Text-to-Speech)               │
│       ↓                             │
│  Creates order in Firestore          │
└─────────────────┬───────────────────┘
                  │
                  ↓ (Firebase Firestore - shared)
    ┌─────────────┼─────────────┐
    ↓             ↓             ↓
┌────────┐  ┌─────────┐  ┌──────────┐
│Vendor  │  │ Rider   │  │  Admin   │
│App     │  │ App     │  │  Panel   │
│(accept)│  │(deliver)│  │(monitor) │
└────────┘  └─────────┘  └──────────┘
```

---

## 📦 Project Structure

```
NOX-Voice_Ai/
├── src/
│   ├── index.js              # Express server + Socket.IO
│   ├── firebase-admin.js     # Firebase Admin SDK connection
│   ├── voice-routes.js       # Telephony webhooks + order tools
│   ├── voice-pipeline.js     # STT → GPT-4 → TTS pipeline
│   ├── voice-api-routes.js   # Pipeline API endpoints
│   └── voice-agent-config.js # System prompt + tool definitions
├── scripts/
│   ├── seed-firestore.js     # Seed test data
│   └── test-voice-pipeline.js # Test the pipeline
├── .env.example              # Environment variables template
├── Dockerfile                # Container deployment
├── package.json
└── README.md
```

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/aslam-AI-003/NOX-Voice_Ai.git
cd NOX-Voice_Ai

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your Firebase + OpenAI credentials

# 4. Seed test data (first time only)
npm run seed

# 5. Start server
npm run dev
```

Server runs at `http://localhost:4000`

---

## 🔌 API Endpoints

### Voice Pipeline
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pipeline/start-session` | POST | Start a new voice session |
| `/api/pipeline/process-turn` | POST | Process one conversation turn |
| `/api/pipeline/end-session` | POST | End a voice session |

### Voice Tools (used by AI internally)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/voice/search-shops` | POST | Find shops by area + category |
| `/api/voice/search-item` | POST | Search items in a shop |
| `/api/voice/create-order` | POST | Place an order |
| `/api/voice/last-order/:phone` | GET | Get customer's last order |
| `/api/voice/vendor-action` | POST | Vendor accepts/rejects order |
| `/api/voice/rider-action` | POST | Rider accepts/rejects delivery |

### Admin
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/voice/admin/calls` | GET | List all voice calls |
| `/api/voice/admin/analytics` | GET | Voice analytics dashboard |
| `/api/voice/admin/live-calls` | GET | Currently active calls |
| `/api/voice/admin/escalations` | GET | Human escalation queue |

### Health
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Server health check |

---

## 📞 Order Flow

```
1. Customer calls → AI greets in Tanglish
2. AI asks: "Enga area la irukkeenga?"
3. Customer: "Thanjavur"
4. AI asks: "Enna items venum?"
5. Customer: "Arisi 5 kilo, oil 1 litre"
6. AI: [searches Firestore → finds shop → checks items]
7. AI: "Sri Murugan la Rice ₹349, Oil ₹320. Total ₹669. Confirm?"
8. Customer: "OK"
9. AI: [creates order in Firestore] "Order placed! SMS varum. Nandri!"
10. 📞 CALL ENDS

--- After call (async via Firestore) ---
11. Vendor app shows new order → Vendor taps "Accept"
12. Rider app gets notification → Rider picks up & delivers
13. Customer gets SMS at each step
```

---

## 🔗 Connected Apps

All apps share the same Firebase project (`noed-4008d`):

| App | Repo | Port | Role |
|-----|------|------|------|
| Customer | [noe-customer](https://github.com/aslam-AI-003/noe-customer) | 3000 | Browse & order |
| Vendor | [noe-vendor](https://github.com/aslam-AI-003/noe-vendor) | 3001 | Accept orders |
| Rider | [noe-rider](https://github.com/aslam-AI-003/noe-rider) | 3002 | Deliver orders |
| Admin | [noe-admin](https://github.com/aslam-AI-003/noe-admin) | 3003 | Monitor all |
| **Voice AI** | **This repo** | **4000** | **AI phone ordering** |

---

## 🧪 Testing

```bash
# Run the test pipeline (simulates a voice conversation)
npm test

# Or manually test with curl:
curl -X POST http://localhost:4000/api/pipeline/start-session \
  -H "Content-Type: application/json" \
  -d '{"callId": "test-1", "callerPhone": "+919876543210"}'
```

---

## 🐳 Docker Deployment

```bash
docker build -t nox-voice-ai .
docker run -p 4000:4000 --env-file .env nox-voice-ai
```

---

## 📋 Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **AI**: OpenAI GPT-4 (function calling)
- **STT**: Google Cloud Speech-to-Text (Tamil support)
- **TTS**: Google Cloud Text-to-Speech (Tamil)
- **Database**: Firebase Firestore
- **Real-time**: Socket.IO
- **Telephony**: Exotel/Twilio (Phase 2)

---

## 📄 License

MIT © Namma Ooru Express
