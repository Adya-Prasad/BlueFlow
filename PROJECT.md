# 🔵 BlueFlow — Project Specification

> **Your phone is your microphone.**
>
> Turn any smartphone into a wireless PC microphone over WiFi.
> No hardware needed. No cloud. No cost.

---

## 1. What We're Building

BlueFlow is a lightweight app that lets you use your **phone's microphone as a virtual microphone on your PC** over WiFi. It also provides **real-time voice-to-text transcription** — all offline, all local, all free.

### Scope (Finalized)

| Feature | Included | Notes |
|---------|----------|-------|
| Phone → PC mic bridging over WiFi | ✅ | Core feature |
| Virtual microphone on Windows | ✅ | Via VB-Cable (existing driver) |
| Real-time voice-to-text | ✅ | Via Vosk (offline, local) |
| Copy/paste transcribed text | ✅ | In PC app UI |
| QR code for easy phone connection | ✅ | Scan and connect instantly |
| AI editing / cloud processing | ❌ | Out of scope |
| Wispr Flow integration | ❌ | Out of scope |
| Bluetooth transport | ❌ | WiFi only for MVP |
| iOS/Android native app | ❌ | Phone uses browser (zero install) |

---

## 2. Architecture

```
Phone (Browser)                    WiFi (WebSocket)                PC (Python + Web UI)
================                   ================                ====================

getUserMedia()                                                     FastAPI Server
     |                                                                  |
AudioWorklet                                                       WebSocket /ws/audio
(Float32 → Int16 PCM)                                                  |
     |                                                             ┌────┴────┐
WebSocket.send(binary) ──────── ws://pc-ip:8765/ws/audio ────────► │ Router  │
                                                                   │         ├──► sounddevice → VB-Cable Input
                                                                   │         │        |
                                                                   │         │     VB-Cable Output (Virtual Mic)
                                                                   │         │        |
                                                                   │         │     Zoom / Discord / Meet
                                                                   │         │
                                                                   │         ├──► Vosk Recognizer
                                                                   │         │        |
                                                                   └────┬────┘     Transcribed Text
                                                                        |              |
                                                                   WebSocket /ws/dashboard
                                                                        |
                                                                   PC Dashboard UI
                                                                   (live transcription, status, controls)
```

### Data Flow — Virtual Mic Mode
```
Phone Mic → AudioWorklet (PCM 16-bit, 16kHz, mono)
          → WebSocket (binary frames, ~128ms chunks)
          → Python server receives frames
          → sounddevice writes to VB-Cable "CABLE Input" (output device)
          → Windows sees "CABLE Output" as a recording device (microphone)
          → Zoom/Discord/Meet selects "CABLE Output" as mic input
```

### Data Flow — Voice-to-Text Mode (simultaneous)
```
Same PCM audio frames from WebSocket
          → Fed into Vosk KaldiRecognizer
          → Partial results streamed back to PC UI in real-time
          → Final results displayed + copyable
```

---

## 3. Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| **PC Backend** | Python 3.11+ with FastAPI | Fast async WebSocket support, great audio libs |
| **WebSocket Server** | FastAPI + websockets | Built-in, production-grade, bidirectional |
| **Audio Routing** | sounddevice (PortAudio) | Direct device selection, write PCM to VB-Cable |
| **Virtual Audio Driver** | VB-Cable (free, donationware) | Battle-tested, no kernel dev needed, just install |
| **Speech-to-Text** | vosk (offline) | Free, offline, lightweight (~50MB model), real-time streaming |
| **PC UI** | HTML + CSS + vanilla JS | Served by FastAPI, clean and lightweight |
| **Phone Client** | HTML + CSS + JS (web page) | Zero install — phone opens URL in browser |
| **Phone Mic Capture** | Web Audio API + AudioWorklet | Raw PCM capture, low latency, works in all modern browsers |
| **QR Code** | qrcode Python library | Generate connection QR for phone to scan |

### Why This Stack?

- **No Electron, no Tauri** → Python + browser UI = lightest possible
- **No native mobile app** → Phone browser = zero install, works on Android + iOS
- **No cloud** → Everything runs on your local WiFi network
- **No custom driver** → VB-Cable is trusted by millions, just works
- **Vosk not Whisper** → Vosk is designed for streaming real-time; Whisper is batch-processing

---

## 4. Prerequisites (User Must Install)

### 1. VB-Cable Virtual Audio Driver
- Download from: https://vb-audio.com/Cable/
- Run installer as Administrator
- Restart PC
- This creates two devices:
  - **CABLE Input** (playback device — we write audio here)
  - **CABLE Output** (recording device — apps read from here as a "mic")

### 2. Python 3.11+
- Download from: https://python.org
- Ensure pip is available

### 3. Vosk Model
- Download vosk-model-small-en-us-0.15 from: https://alphacephei.com/vosk/models
- Extract to models/ folder inside project
- (~50MB, English, lightweight)

### 4. Phone and PC on Same WiFi Network
- Both devices must be connected to the same local network

---

## 5. Project Structure

```
BlueFlow/
├── PROJECT.md                    # This file
├── README.md                     # User-facing documentation
├── requirements.txt              # Python dependencies
├── run.py                        # Entry point — starts the server
│
├── server/                       # Python backend
│   ├── __init__.py
│   ├── app.py                    # FastAPI app, routes, WebSocket handler
│   ├── audio_router.py           # Manages audio output to VB-Cable
│   ├── transcriber.py            # Vosk real-time speech-to-text
│   ├── device_manager.py         # Detect and list audio devices (find VB-Cable)
│   └── config.py                 # Configuration constants
│
├── ui/                           # PC Dashboard (served as static files)
│   ├── index.html                # Main dashboard page
│   ├── css/
│   │   └── dashboard.css         # Dashboard styles
│   └── js/
│       └── dashboard.js          # Dashboard logic (WebSocket client, UI updates)
│
├── mobile/                       # Phone client (served as static files)
│   ├── index.html                # Phone mic capture page
│   ├── css/
│   │   └── mobile.css            # Mobile styles
│   ├── js/
│   │   ├── mobile.js             # Main phone logic (mic, WebSocket, UI)
│   │   └── audio-processor.js    # AudioWorklet processor (PCM capture)
│   └── icons/
│       └── (app icons)
│
└── models/                       # Vosk model directory (user downloads)
    └── vosk-model-small-en-us-0.15/
        └── (model files)
```

---

## 6. Key Implementation Details

### 6.1 Audio Format
```
Format:    PCM (raw, uncompressed)
Bit depth: 16-bit signed integer (Int16)
Channels:  1 (mono)
Rate:      16000 Hz (16kHz)
Chunk:     4096 bytes per frame (~128ms per chunk)
```
- 16kHz mono is standard for speech recognition (Vosk expects this)
- PCM avoids encoding/decoding overhead = lower latency
- AudioWorklet on phone captures raw PCM directly (no MediaRecorder container overhead)

### 6.2 VB-Cable Audio Routing
```python
import sounddevice as sd
import numpy as np

# Find VB-Cable device index
def find_cable_input():
    devices = sd.query_devices()
    for i, d in enumerate(devices):
        if 'CABLE Input' in d['name'] and d['max_output_channels'] > 0:
            return i
    return None

# Open output stream to VB-Cable
cable_index = find_cable_input()
stream = sd.OutputStream(
    samplerate=16000,
    channels=1,
    dtype='int16',
    device=cable_index,
    blocksize=4096
)
stream.start()

# Write received audio frames
stream.write(audio_frame_np_array)
```

### 6.3 Vosk Real-Time Transcription
```python
from vosk import Model, KaldiRecognizer
import json

model = Model("models/vosk-model-small-en-us-0.15")
recognizer = KaldiRecognizer(model, 16000)

def process_audio(pcm_bytes):
    if recognizer.AcceptWaveform(pcm_bytes):
        result = json.loads(recognizer.Result())
        return {"type": "final", "text": result.get("text", "")}
    else:
        partial = json.loads(recognizer.PartialResult())
        return {"type": "partial", "text": partial.get("partial", "")}
```

### 6.4 Phone AudioWorklet (PCM Capture)
```javascript
// audio-processor.js — runs in AudioWorklet
class PCMProcessor extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0];
        if (input.length > 0) {
            const float32 = input[0]; // mono channel
            const int16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
                int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
            }
            this.port.postMessage(int16.buffer, [int16.buffer]);
        }
        return true;
    }
}
registerProcessor('pcm-processor', PCMProcessor);
```

---

## 7. API and WebSocket Protocol

### Server Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| / | GET | PC Dashboard UI |
| /mobile | GET | Phone client page |
| /ws/audio | WebSocket | Phone sends audio, receives status |
| /ws/dashboard | WebSocket | PC dashboard receives transcription + status |
| /api/devices | GET | List audio output devices |
| /api/status | GET | Connection status, stats |
| /api/qr | GET | QR code image for phone connection |

### WebSocket Messages

**Phone → Server (/ws/audio):**
```
Binary frame: Raw PCM Int16 audio bytes (4096 bytes per chunk)
```

**Server → Phone (/ws/audio):**
```json
{"type": "status", "connected": true, "message": "Streaming"}
{"type": "transcription", "partial": "hello how are", "final": false}
{"type": "transcription", "text": "hello how are you", "final": true}
```

**Server → Dashboard (/ws/dashboard):**
```json
{"type": "phone_connected", "ip": "192.168.1.5"}
{"type": "phone_disconnected"}
{"type": "audio_level", "level": 0.73}
{"type": "transcription", "text": "hello how are you", "final": true}
{"type": "transcription", "partial": "hello how", "final": false}
{"type": "status", "streaming": true, "device": "CABLE Input"}
```

---

## 8. Two-Day Build Plan

### Day 1 — Core Pipeline (Get Audio Flowing)

| # | Task | Time | Details |
|---|------|------|---------|
| 1 | Project setup | 30m | Create file structure, requirements.txt, config.py |
| 2 | Device manager | 30m | Detect VB-Cable, list audio devices |
| 3 | Audio router | 1h | sounddevice output stream to VB-Cable, write PCM frames |
| 4 | WebSocket server | 1h | FastAPI app, /ws/audio endpoint, receive binary frames |
| 5 | Phone client (audio) | 1.5h | getUserMedia, AudioWorklet, PCM capture, WebSocket send |
| 6 | Phone client (UI) | 1h | Mic button, status, volume meter, connection indicator |
| 7 | QR code generation | 30m | Generate QR on server start, serve at /api/qr |
| 8 | End-to-end test | 1h | Phone → PC → VB-Cable → Windows Sound Recorder |

**Day 1 Goal:** Phone mic audio plays through VB-Cable. Zoom/Discord can hear you.

---

### Day 2 — Transcription + Dashboard + Polish

| # | Task | Time | Details |
|---|------|------|---------|
| 1 | Vosk transcriber | 1h | Load model, streaming recognition, partial + final results |
| 2 | Dashboard WebSocket | 30m | /ws/dashboard endpoint, broadcast transcription + status |
| 3 | PC Dashboard UI | 2h | Connection panel, live transcription, copy button, device selector |
| 4 | Dashboard styling | 1h | Dark theme, glassmorphism, animations, premium feel |
| 5 | Mobile UI polish | 1h | Better visuals, volume animation, connection status |
| 6 | Error handling | 30m | Reconnection logic, device errors, graceful failures |
| 7 | Entry point + README | 30m | run.py startup script, user documentation |
| 8 | Full testing | 1h | Test with Zoom, Discord, Google Meet |

**Day 2 Goal:** Complete app with transcription, polished UI, tested with real apps.

---

## 9. Dependencies

### requirements.txt
```
fastapi==0.115.0
uvicorn[standard]==0.30.0
websockets==13.0
sounddevice==0.5.0
numpy==2.1.0
vosk==0.3.45
qrcode[pil]==8.0
Pillow==11.0.0
```

---

## 10. How It Will Work (User Flow)

```
1. User installs VB-Cable on PC (one-time setup)
2. User runs: python run.py
3. BlueFlow starts → shows QR code + dashboard in browser
4. User scans QR code with phone camera
5. Phone browser opens BlueFlow page
6. User taps "Start Mic" on phone
7. Phone asks for microphone permission → user grants
8. Audio streams to PC in real-time
9. PC routes audio to VB-Cable → appears as system microphone
10. User opens Zoom/Discord → selects "CABLE Output" as mic
11. Voice-to-text transcription appears live in dashboard
12. User can copy transcribed text anytime
```

---

## 11. Design Language

### Colors (Dark Theme)
```css
--bg-primary:    #0a0a0f;
--bg-secondary:  #12121a;
--bg-glass:      rgba(255,255,255,0.05);
--accent:        #3b82f6;
--accent-glow:   #60a5fa;
--success:       #22c55e;
--danger:        #ef4444;
--text-primary:  #f1f5f9;
--text-secondary:#94a3b8;
```

### Design Principles
- Dark-first: Sleek dark UI, easy on eyes
- Glassmorphism: Frosted glass cards with subtle borders
- Minimal: No clutter, only essential controls
- Responsive: Dashboard works on any screen size
- Animated: Subtle micro-animations for state changes

---

*Built to solve a real problem for people who cant afford a microphone.*
