# Multimodal AI Companion Hub

A real-time, locally-run AI assistant that processes **text**, **voice**, and **vision** simultaneously. Talk to it, show it objects via webcam or your screen, and it responds with text and natural-sounding speech — all while remembering your past conversations.

---

## ✨ Features

| Feature | Technology |
|---|---|
| 💬 Text Chat | React + FastAPI WebSockets |
| 🎙️ Speech-to-Text | OpenAI Whisper (local) |
| 🔊 Text-to-Speech | ElevenLabs |
| 👁️ Webcam Vision | OpenCV → Gemini Vision |
| 🖥️ Screen Capture | Browser `getDisplayMedia` → Gemini Vision |
| 🧠 AI Brain | Google Gemini 1.5 Pro |
| 💾 Long-term Memory | MongoDB + OpenAI Embeddings |
| 🎭 3D Avatar | Three.js + morph targets |

---

## 🏗️ Architecture

```
Browser (React)
  ├── Text input
  ├── 🎙️ Mic (MediaRecorder → WebM)
  ├── 📸 Webcam / 🖥️ Screen capture toggle
  └── 3D Avatar (Three.js)
         │  WebSocket (JSON)
         ▼
FastAPI Backend (Python)
  ├── Whisper → transcription
  ├── OpenAI ada-002 → embedding
  ├── MongoDB → retrieve top-3 past context
  ├── OpenCV / Screen frame → JPEG
  ├── Gemini 1.5 Pro → AI reply
  ├── MongoDB → store interaction
  └── ElevenLabs → audio reply
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.10+
- Node.js 18+
- Docker Desktop (for local MongoDB)
- FFmpeg (`winget install ffmpeg` on Windows)

### 1. Clone the repo
```bash
git clone <your-repo-url>
cd ai-companion-hub
```

### 2. Set up API Keys
```bash
cp backend/.env.example backend/.env
```
Open `backend/.env` and fill in:
```
GEMINI_API_KEY=...        # https://aistudio.google.com
ELEVENLABS_API_KEY=...    # https://elevenlabs.io
OPENAI_API_KEY=...        # https://platform.openai.com
MONGODB_URI=mongodb://mongo:27017
```

### 3. Start MongoDB (Docker)
```bash
docker-compose up -d
```

### 4. Start the backend
```bash
cd backend
python -m venv venv
# Windows:
.\venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload
```

### 5. Start the frontend
```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

---

## 🎮 Usage

| Action | How |
|---|---|
| Type a message | Use the text box at the bottom |
| Speak | Hold the 🎙️ **Hold to Speak** button, release to send |
| Show webcam | Check **👁️ Enable Vision** → backend grabs a snapshot each message |
| Share screen | Click **🖥️ Share Screen** → pick a window, backend grabs a frame |

---

## 📁 Project Structure

```
ai-companion-hub/
├── backend/
│   ├── main.py          # FastAPI server, WebSocket, orchestration
│   ├── db.py            # MongoDB async helpers
│   ├── react_agent.py   # ReAct reasoning framework
│   ├── test_memory.py   # Verify MongoDB storage
│   ├── requirements.txt
│   └── .env             # (gitignored) API keys
├── frontend/
│   └── src/
│       ├── App.jsx       # Main chat + controls
│       ├── Avatar.jsx    # 3D avatar (Three.js)
│       └── App.css
├── docker-compose.yml    # Local MongoDB
├── .gitignore
└── README.md
```

---

## 🛠️ Tech Stack

- **Frontend**: React 18, Vite, Three.js, WebRTC
- **Backend**: Python 3.12, FastAPI, Uvicorn
- **AI**: Google Gemini 1.5 Pro, OpenAI Whisper, ElevenLabs
- **Memory**: MongoDB 7.0, Motor (async driver), OpenAI text-embedding-ada-002
- **Vision**: OpenCV, Browser Screen Capture API

---

## 🔑 Environment Variables

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS API key |
| `OPENAI_API_KEY` | OpenAI embeddings API key |
| `MONGODB_URI` | MongoDB connection string |
| `MONGODB_DB` | Database name (default: `ai_companion`) |
| `MONGODB_COLLECTION` | Collection name (default: `conversations`) |

---

## 📜 License
MIT
