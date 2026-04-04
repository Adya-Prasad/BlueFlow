"""Audio device detection and management."""

import sounddevice as sd
import logging

logger = logging.getLogger(__name__)


def list_output_devices():
    """List all available audio output (playback) devices."""
    devices = sd.query_devices()
    output_devices = []
    for i, d in enumerate(devices):
        if d["max_output_channels"] > 0:
            output_devices.append({
                "index": i,
                "name": d["name"],
                "channels": d["max_output_channels"],
                "sample_rate": int(d["default_samplerate"]),
            })
    return output_devices


def find_cable_input():
    """Find VB-Cable Input device (the playback device we write audio to).
    
    Returns (device_index, device_name) or (None, None) if not found.
    """
    devices = sd.query_devices()
    for i, d in enumerate(devices):
        name_lower = d["name"].lower()
        if "cable input" in name_lower and d["max_output_channels"] > 0:
            logger.info(f"Found VB-Cable: '{d['name']}' at index {i}")
            return i, d["name"]
    
    # Fallback: look for any virtual cable variant
    for i, d in enumerate(devices):
        name_lower = d["name"].lower()
        if ("virtual" in name_lower or "vb-audio" in name_lower) and d["max_output_channels"] > 0:
            logger.info(f"Found virtual audio device: '{d['name']}' at index {i}")
            return i, d["name"]
    
    logger.warning("VB-Cable not found. Install from https://vb-audio.com/Cable/")
    return None, None


def get_device_info(index):
    """Get detailed info for a specific device."""
    try:
        return sd.query_devices(index)
    except Exception:
        return None
