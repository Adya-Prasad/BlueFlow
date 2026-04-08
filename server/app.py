"""BlueFlow FastAPI application — WebSocket server, audio routing, and static file serving."""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import asyncio
import json
import threading
import queue
import logging
import os
import numpy as np

from .config import SAMPLE_RATE, CHANNELS, MODEL_PATH, BASE_DIR
from .device_manager import find_cable_input, list_output_devices
from .audio_router import AudioRouter
from .transcriber import Transcriber

logger = logging.getLogger(__name__)

app = FastAPI(title="BlueFlow", docs_url=None, redoc_url=None)


# ---------------------------------------------------------------------------
# Application state
# ---------------------------------------------------------------------------
class AppState:
    def __init__(self):
        self.audio_router: AudioRouter | None = None
        self.transcriber: Transcriber | None = None
        self.dashboard_clients: set[WebSocket] = set()
        self.phone_connected = False
        self.phone_ip: str | None = None
        self.is_streaming = False
        self.audio_device_index: int | None = None
        self.audio_device_name: str | None = None
        self.audio_queue: queue.Queue = queue.Queue()
        self.worker_thread: threading.Thread | None = None
        self.phone_websocket: WebSocket | None = None
        self.worker_running = False
        self.loop: asyncio.AbstractEventLoop | None = None


state = AppState()


# ---------------------------------------------------------------------------
# Audio processing worker (runs in a dedicated thread)
# ---------------------------------------------------------------------------
def audio_worker():
    """Process audio frames: write to VB-Cable + run Vosk transcription."""
    level_counter = 0
    while state.worker_running:
        try:
            data = state.audio_queue.get(timeout=0.1)
        except queue.Empty:
            continue

        if data is None:
            break

        # Write audio to VB-Cable
        if state.audio_router and state.audio_router.is_running:
            state.audio_router.write(data)

        # Calculate audio level (throttle to every 3rd frame)
        level_counter += 1
        level = 0.0
        if level_counter % 3 == 0:
            level = AudioRouter.get_level(data)

        # Run transcription
        result = None
        if state.transcriber and state.transcriber.is_loaded:
            result = state.transcriber.process(data)

        # Broadcast to dashboard
        if state.loop:
            msg = None
            if result:
                result["level"] = level
                msg = result
            elif level_counter % 3 == 0 and level > 0:
                msg = {"type": "audio_level", "level": level}

            if msg:
                asyncio.run_coroutine_threadsafe(
                    broadcast_to_dashboard(msg), state.loop
                )


async def broadcast_to_dashboard(message: dict):
    """Send a JSON message to all connected dashboard WebSocket clients."""
    if state.phone_websocket:
        try:
            await state.phone_websocket.send_json(message)
        except Exception:
            pass
    if not state.dashboard_clients:
        return
    dead = set()
    for client in state.dashboard_clients.copy():
        try:
            await client.send_json(message)
        except Exception:
            dead.add(client)
    state.dashboard_clients -= dead


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    state.loop = asyncio.get_event_loop()

    # Detect VB-Cable
    idx, name = find_cable_input()
    if idx is not None:
        state.audio_device_index = idx
        state.audio_device_name = name
        try:
            state.audio_router = AudioRouter(idx, SAMPLE_RATE, CHANNELS)
            state.audio_router.start()
        except Exception as e:
            logger.error(f"Could not start audio router: {e}")
    else:
        logger.warning("VB-Cable not detected — virtual mic will NOT work")

    # Load Vosk model
    state.transcriber = Transcriber(MODEL_PATH, SAMPLE_RATE)
    state.transcriber.load()

    # Start audio worker thread
    state.worker_running = True
    state.worker_thread = threading.Thread(target=audio_worker, daemon=True)
    state.worker_thread.start()
    logger.info("BlueFlow server started")


@app.on_event("shutdown")
async def shutdown():
    state.worker_running = False
    state.audio_queue.put(None)
    if state.worker_thread:
        state.worker_thread.join(timeout=2)
    if state.audio_router:
        state.audio_router.stop()
    logger.info("BlueFlow server stopped")


# ---------------------------------------------------------------------------
# Static file serving
# ---------------------------------------------------------------------------
ui_dir = os.path.join(BASE_DIR, "ui")
mobile_dir = os.path.join(BASE_DIR, "mobile")
assets_dir = os.path.join(BASE_DIR, "assets")

app.mount("/ui", StaticFiles(directory=ui_dir), name="ui")
app.mount("/mobile", StaticFiles(directory=mobile_dir), name="mobile_static")
app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


@app.get("/")
async def dashboard_page():
    return FileResponse(os.path.join(ui_dir, "index.html"))


@app.get("/phone")
async def phone_page():
    return FileResponse(os.path.join(mobile_dir, "index.html"))


# ---------------------------------------------------------------------------
# WebSocket: Phone audio stream
# ---------------------------------------------------------------------------
@app.websocket("/ws/audio")
async def audio_websocket(websocket: WebSocket):
    await websocket.accept()
    state.phone_connected = True
    state.phone_ip = websocket.client.host if websocket.client else "unknown"
    state.phone_websocket = websocket
    state.is_streaming = True
    logger.info(f"Phone connected: {state.phone_ip}")

    # Notify dashboard
    await broadcast_to_dashboard({
        "type": "phone_connected",
        "ip": state.phone_ip,
    })

    # Reset transcriber for new session
    if state.transcriber:
        state.transcriber.reset()

    try:
        while True:
            data = await websocket.receive_bytes()
            state.audio_queue.put(data)
    except WebSocketDisconnect:
        logger.info("Phone disconnected")
    except Exception as e:
        logger.error(f"Audio WebSocket error: {e}")
    finally:
        state.phone_connected = False
        state.phone_websocket = None
        state.is_streaming = False
        state.phone_ip = None
        await broadcast_to_dashboard({"type": "phone_disconnected"})


# ---------------------------------------------------------------------------
# WebSocket: PC dashboard
# ---------------------------------------------------------------------------
@app.websocket("/ws/dashboard")
async def dashboard_websocket(websocket: WebSocket):
    await websocket.accept()
    state.dashboard_clients.add(websocket)

    # Send initial status
    await websocket.send_json({
        "type": "status",
        "phone_connected": state.phone_connected,
        "phone_ip": state.phone_ip,
        "device": state.audio_device_name,
        "device_index": state.audio_device_index,
        "streaming": state.is_streaming,
        "transcription_enabled": (
            state.transcriber.is_loaded if state.transcriber else False
        ),
    })

    try:
        while True:
            msg = await websocket.receive_text()
            data = json.loads(msg)

            if data.get("type") == "change_device":
                new_idx = data.get("device_index")
                if new_idx is not None:
                    try:
                        if state.audio_router:
                            state.audio_router.stop()
                        state.audio_router = AudioRouter(new_idx, SAMPLE_RATE, CHANNELS)
                        state.audio_router.start()
                        state.audio_device_index = new_idx
                        import sounddevice as sd
                        state.audio_device_name = sd.query_devices(new_idx)["name"]
                        await websocket.send_json({
                            "type": "device_changed",
                            "device": state.audio_device_name,
                            "device_index": new_idx,
                        })
                    except Exception as e:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"Failed to switch device: {e}",
                        })

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Dashboard WebSocket error: {e}")
    finally:
        state.dashboard_clients.discard(websocket)


# ---------------------------------------------------------------------------
# REST API
# ---------------------------------------------------------------------------
@app.get("/api/logo")
async def get_logo():
    logo_path = os.path.join(assets_dir, "blueflow_logo.png")
    if os.path.exists(logo_path):
        return FileResponse(logo_path, media_type="image/png")
    return JSONResponse({"error": "Logo not found"}, status_code=404)


@app.get("/api/devices")
async def get_devices():
    return JSONResponse(list_output_devices())


@app.get("/api/status")
async def get_status():
    return JSONResponse({
        "phone_connected": state.phone_connected,
        "phone_ip": state.phone_ip,
        "device": state.audio_device_name,
        "device_index": state.audio_device_index,
        "streaming": state.is_streaming,
        "transcription_enabled": (
            state.transcriber.is_loaded if state.transcriber else False
        ),
    })


@app.get("/api/qr")
async def get_qr():
    qr_path = os.path.join(BASE_DIR, "certs", "qr.png")
    if os.path.exists(qr_path):
        return FileResponse(qr_path, media_type="image/png")
    return JSONResponse({"error": "QR not generated"}, status_code=404)
