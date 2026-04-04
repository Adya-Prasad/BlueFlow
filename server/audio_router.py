"""Audio routing — writes received PCM audio to VB-Cable virtual device."""

import sounddevice as sd
import numpy as np
import threading
import logging

logger = logging.getLogger(__name__)


class AudioRouter:
    """Routes PCM audio data to a specific audio output device (VB-Cable)."""

    def __init__(self, device_index, sample_rate=16000, channels=1):
        self.device_index = device_index
        self.sample_rate = sample_rate
        self.channels = channels
        self.stream = None
        self.lock = threading.Lock()
        self.is_running = False

    def start(self):
        """Open the output stream to VB-Cable."""
        if self.is_running:
            return

        try:
            self.stream = sd.OutputStream(
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype="int16",
                device=self.device_index,
                blocksize=1024,
                latency="low",
            )
            self.stream.start()
            self.is_running = True
            logger.info(f"Audio router started → device index {self.device_index}")
        except Exception as e:
            logger.error(f"Failed to start audio router: {e}")
            raise

    def write(self, pcm_bytes):
        """Write raw PCM bytes to the audio output device."""
        if not self.is_running or self.stream is None:
            return

        try:
            np_data = np.frombuffer(pcm_bytes, dtype=np.int16).copy()
            np_data = np_data.reshape(-1, self.channels)
            with self.lock:
                self.stream.write(np_data)
        except sd.PortAudioError as e:
            # Buffer underflow/overflow — skip silently
            pass
        except Exception as e:
            logger.warning(f"Audio write error: {e}")

    def stop(self):
        """Stop and close the audio stream."""
        self.is_running = False
        if self.stream:
            try:
                self.stream.stop()
                self.stream.close()
            except Exception:
                pass
            self.stream = None
        logger.info("Audio router stopped")

    @staticmethod
    def get_level(pcm_bytes):
        """Calculate audio level (0.0 to 1.0) from PCM bytes."""
        try:
            np_data = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32)
            if len(np_data) == 0:
                return 0.0
            rms = np.sqrt(np.mean(np_data ** 2))
            level = min(rms / 8000.0, 1.0)
            return round(level, 3)
        except Exception:
            return 0.0
