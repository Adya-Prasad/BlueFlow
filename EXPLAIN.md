# BlueFlow — Architecture Explained

> A complete guide to how BlueFlow works, how to run it, how to test it, and what's next.

---

## 1. What BlueFlow Does (Simple Version)

```
Your Phone's Mic  ──WiFi──▶  Your PC  ──▶  Apps think you have a real microphone
```

BlueFlow turns your smartphone into a wireless microphone for your PC.
- **No hardware** to buy
- **No cloud** — everything stays on your local WiFi
- **No app to install on phone** — just open a web page in your browser

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          YOUR WiFi NETWORK                             │
│                                                                        │
│  ┌──────────────────────┐              ┌─────────────────────────────┐ │
│  │    📱 YOUR PHONE      │              │    💻 YOUR PC               │ │
│  │                      │              │                             │ │
│  │  Chrome Browser      │   WebSocket  │  Python Server (FastAPI)    │ │
│  │  opens /phone page   │──────────────│  running on port 8765      │ │
│  │                      │  wss://...   │                             │ │
│  │  ┌────────────────┐  │   binary     │  ┌───────────────────────┐ │ │
│  │  │  getUserMedia() │  │   audio     │  │  WebSocket Handler    │ │ │
│  │  │  captures mic   │──┼─────────────┼─▶│  receives audio bytes │ │ │
│  │  └────────────────┘  │   frames     │  └────────┬──────────────┘ │ │
│  │         │            │              │           │                │ │
│  │  ┌──────▼─────────┐  │              │    ┌──────▼──────────┐     │ │
│  │  │  AudioWorklet   │  │              │    │  Audio Queue    │     │ │
│  │  │  Float32 → Int16│  │              │    │  (thread-safe)  │     │ │
│  │  │  PCM conversion │  │              │    └──────┬──────────┘     │ │
│  │  └────────────────┘  │              │           │                │ │
│  │                      │              │    ┌──────▼──────────┐     │ │
│  └──────────────────────┘              │    │  Worker Thread  │     │ │
│                                        │    │                 │     │ │
│                                        │    │  ┌─────────┐    │     │ │
│                                        │    │  │ Audio    │────┼─────┼─▶ VB-Cable
│                                        │    │  │ Router   │    │     │   (Virtual Mic)
│                                        │    │  └─────────┘    │     │       │
│                                        │    │                 │     │       ▼
│                                        │    │  ┌─────────┐    │     │   Zoom, Discord,
│                                        │    │  │ Vosk    │    │     │   Google Meet
│                                        │    │  │ (STT)   │    │     │   see "CABLE Output"
│                                        │    │  └────┬────┘    │     │   as a microphone
│                                        │    └───────┼─────────┘     │
│                                        │           │                │
│                                        │    ┌──────▼──────────┐     │
│                                        │    │  Dashboard WS   │     │
│                                        │    │  broadcasts to  │     │
│                                        │    │  PC browser UI  │     │
│                                        │    └─────────────────┘     │
│                                        │                            │
│                                        └────────────────────────────┘ │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. File-by-File Explanation

### Server (Python Backend)

```
server/
├── config.py          # Constants: sample rate (16kHz), port (8765), paths
├── device_manager.py  # Finds VB-Cable in Windows audio devices
├── audio_router.py    # Writes PCM audio bytes to VB-Cable via sounddevice
├── transcriber.py     # Vosk offline speech-to-text (real-time streaming)
├── ssl_manager.py     # Generates self-signed HTTPS cert (needed for mic access)
├── app.py             # FastAPI app — routes, WebSockets, ties everything together
└── __init__.py
```

| File | What it does | Why it's needed |
|------|-------------|-----------------|
| **config.py** | Stores constants like `SAMPLE_RATE=16000`, `PORT=8765`, file paths | Central config, easy to change settings |
| **device_manager.py** | Scans all Windows audio devices, finds one named "CABLE Input" | We need to know which device index is VB-Cable to write audio to it |
| **audio_router.py** | Opens a `sounddevice.OutputStream` pointed at VB-Cable, writes PCM bytes to it | This is the core — makes phone audio appear as a real microphone |
| **transcriber.py** | Loads a Vosk model, feeds PCM audio, returns partial/final text | Real-time speech-to-text, fully offline |
| **ssl_manager.py** | Generates a self-signed SSL certificate with your PC's LAN IP | Phone browsers require HTTPS to access the microphone (getUserMedia) |
| **app.py** | FastAPI server with WebSocket endpoints, static file serving, audio processing thread | The "brain" that connects everything together |

### Entry Point

```
run.py    # Starts everything: generates SSL cert, QR code, prints banner, runs uvicorn
```

### Mobile Client (Phone — runs in browser)

```
mobile/
├── index.html              # Phone UI: mic button, status bar, transcription, permission modal
├── css/mobile.css          # Dark blue theme, mic button animations, modal styles
└── js/
    ├── mobile.js           # Connection logic, mic capture, permission handling
    └── audio-processor.js  # AudioWorklet: captures raw PCM from mic
```

| File | What it does |
|------|-------------|
| **audio-processor.js** | Runs in a dedicated audio thread (AudioWorklet). Captures Float32 mic samples, converts to Int16 PCM, posts to main thread |
| **mobile.js** | Connects WebSocket to PC, starts/stops mic, sends binary audio frames, shows transcription, handles permission errors with browser-specific instructions |
| **mobile.css** | Styling — the big blue mic button, pulse animations, glassmorphism cards, permission modal |

### PC Dashboard (runs in browser on PC)

```
ui/
├── index.html          # Dashboard: QR code, device selector, status, transcription area
├── css/dashboard.css   # Dark theme, two-column layout, animated indicators
└── js/dashboard.js     # WebSocket client, receives live transcription + status updates
```

---

## 4. The Audio Pipeline (Step by Step)

### Step 1: Phone captures microphone
```javascript
// mobile.js
navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000, channelCount: 1 } })
```
The browser asks for mic permission. Once granted, we get a MediaStream.

### Step 2: AudioWorklet converts to PCM
```javascript
// audio-processor.js — runs in audio thread (not main thread)
// Captures Float32 samples from mic → converts to Int16 PCM
int16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
// Posts Int16 buffer to main thread
this.port.postMessage(int16.buffer, [int16.buffer]);
```

### Step 3: WebSocket sends binary frames
```javascript
// mobile.js
workletNode.port.onmessage = (event) => {
    ws.send(event.data);  // Send raw PCM bytes to PC
};
```
Each frame is 2048 samples × 2 bytes = 4096 bytes (~128ms of audio at 16kHz).

### Step 4: Python server receives audio
```python
# app.py
data = await websocket.receive_bytes()  # Raw PCM
state.audio_queue.put(data)             # Into thread-safe queue
```

### Step 5: Worker thread processes audio
```python
# app.py — audio_worker() runs in its own thread
data = state.audio_queue.get()

# 5a. Write to VB-Cable
state.audio_router.write(data)

# 5b. Transcribe with Vosk
result = state.transcriber.process(data)

# 5c. Broadcast transcription to dashboard
asyncio.run_coroutine_threadsafe(broadcast_to_dashboard(result), state.loop)
```

### Step 6: VB-Cable makes it a "microphone"
```
sounddevice writes to "CABLE Input" (a playback device)
    ↓
VB-Cable internally loops it to "CABLE Output" (a recording device)
    ↓
Any app that selects "CABLE Output" as its mic input hears your voice
```

### Step 7: Dashboard shows transcription
```javascript
// dashboard.js
ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "transcription") {
        // Show text on screen with copy button
    }
};
```

---

## 5. Why HTTPS? (The SSL Certificate)

**Problem:** Phone browsers block microphone access (`getUserMedia`) on non-HTTPS pages.
This is a browser security policy — no way around it.

**Solution:** BlueFlow generates a self-signed SSL certificate on first run.

```
run.py starts
  → ssl_manager.py checks: do certs/cert.pem and certs/key.pem exist?
  → NO → generates a self-signed cert with your LAN IP as SAN
  → uvicorn starts with ssl_keyfile and ssl_certfile
  → Phone opens https://192.168.x.x:8765/phone
  → Browser shows "Not secure" warning (expected for self-signed)
  → User taps "Proceed anyway" (one-time)
  → getUserMedia now works!
```

---

## 6. How VB-Cable Works

VB-Cable is a free virtual audio driver that creates two fake audio devices:

```
┌──────────────────────────────┐
│         VB-Cable              │
│                              │
│  "CABLE Input"               │    "CABLE Output"
│  (shows as a SPEAKER)    ───────▶  (shows as a MICROPHONE)
│                              │
│  We PLAY audio here          │    Apps RECORD from here
│  using sounddevice           │    (Zoom, Discord, etc.)
│                              │
└──────────────────────────────┘
```

It's a loopback: whatever you "play" to CABLE Input appears as "recorded" from CABLE Output.

---

## 7. How to Run

### Prerequisites (one-time setup)
1. Install **Python 3.11+** from python.org
2. Install **VB-Cable** from https://vb-audio.com/Cable/ (run as admin, restart PC)
3. Download **Vosk model** from https://alphacephei.com/vosk/models
   - Recommended: `vosk-model-small-en-us-0.15` (~40MB)
   - Extract to `BlueFlow/models/` folder

### Start the server
```bash
cd BlueFlow
python -m venv .venv            # Create virtual environment (first time only)
.\.venv\Scripts\activate        # Activate it (Windows)
pip install -r requirements.txt # Install dependencies (first time only)
python run.py                   # Start BlueFlow!
```

### Connect your phone
1. Make sure phone and PC are on the **same WiFi network**
2. Open the **BlueFlow dashboard** that auto-opens in your browser
3. **Scan the QR code** with your phone's camera
4. Phone browser opens → tap **"Advanced" → "Proceed"** (SSL warning, one-time)
5. Tap the **🎙 mic button**
6. Grant microphone permission
7. **Start speaking!**

### Use as microphone in apps
1. Open Zoom / Discord / Google Meet / any app
2. Go to audio/mic settings
3. Select **"CABLE Output (VB-Audio Virtual Cable)"** as your microphone
4. Your phone's voice will come through!

---

## 8. How to Test

### Test 1: Basic audio flow
1. Run BlueFlow, connect phone, start streaming
2. Open **Windows Sound Settings → Input devices**
3. Select "CABLE Output" — you should see the volume bar moving as you speak

### Test 2: With Voice Recorder
1. Open Windows **Voice Recorder** (or Sound Recorder)
2. Set input to "CABLE Output"
3. Speak on phone → record → play back → hear yourself

### Test 3: With a video call
1. Open Zoom/Discord/Meet
2. Set mic to "CABLE Output"
3. Join a meeting — others should hear you through your phone

### Test 4: Transcription
1. Dashboard shows live transcription as you speak
2. Click **Copy** to copy all text
3. Click **Clear** to reset

---

## 9. Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Phone client as web page | No native app | Zero install, works on Android+iOS instantly |
| WiFi instead of Bluetooth | WebSocket over WiFi | Lower latency (20-50ms vs 100-200ms), simpler |
| AudioWorklet for capture | Not MediaRecorder | Raw PCM = lower latency, no container overhead |
| 16kHz sample rate | Not 44.1kHz/48kHz | Speech-optimized, less bandwidth, Vosk expects 16kHz |
| VB-Cable for virtual mic | Not custom driver | No kernel dev, no driver signing, no BSOD risk |
| Vosk for STT | Not Whisper | Vosk supports streaming (real-time partials), Whisper is batch-only |
| Dedicated worker thread | Not async | Vosk is synchronous and blocks; thread keeps event loop free |
| Self-signed HTTPS | Not HTTP | getUserMedia requires secure context on mobile browsers |

---

## 10. What's Next

### Immediate fixes / polish
- [ ] Test with real phone over WiFi and fix any connection issues
- [ ] Handle phone screen lock (keep audio streaming when screen off)
- [ ] Add a "keep alive" ping to prevent WebSocket timeout
- [ ] Better error messages when VB-Cable is not installed
- [ ] Auto-select CABLE Input device on startup (done) + fallback if unavailable

### Phase 2 features
- [ ] USB connection support (lower latency than WiFi)
- [ ] Audio recording + playback in dashboard
- [ ] Download transcription as .txt file
- [ ] Multiple language support for Vosk (user selects language)
- [ ] Noise cancellation / audio enhancement on PC side

### Phase 3 features
- [ ] Bluetooth connection support
- [ ] System-wide text injection (type transcription into any text field)
- [ ] Android native app (for background audio + battery optimization)
- [ ] Auto-install script for VB-Cable + Vosk model
- [ ] Tray icon — run BlueFlow in system tray

---

## 11. Troubleshooting

| Problem | Solution |
|---------|----------|
| "Mic permission denied" on phone | Tap lock icon in address bar → Permissions → Microphone → Allow |
| "CABLE Input not found" in server | Install VB-Cable, restart PC, run BlueFlow again |
| No audio in Zoom/Discord | Select "CABLE Output" as mic in the app's settings |
| Phone can't connect | Ensure both devices are on same WiFi. Try the URL manually. |
| SSL certificate error on phone | Tap "Advanced" → "Proceed to site" (safe — it's your own PC) |
| Transcription not working | Check that Vosk model is in `models/` folder with a `conf/` subfolder |
| High latency | Move phone closer to WiFi router. Use 5GHz WiFi if available. |

---

*Built with Python, FastAPI, Vosk, sounddevice, VB-Cable, and vanilla JS.*
*No cloud. No AI. No tracking. Just your voice, flowing from phone to PC.*
