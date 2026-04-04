"""BlueFlow configuration constants."""

import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Audio settings
SAMPLE_RATE = 16000
CHANNELS = 1
DTYPE = "int16"
CHUNK_SIZE = 4096  # bytes per WebSocket frame

# Server
HOST = "0.0.0.0"
PORT = 8765

# Vosk model
MODEL_PATH = os.path.join(BASE_DIR, "models")

# SSL certificates
CERT_DIR = os.path.join(BASE_DIR, "certs")
