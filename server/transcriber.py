"""Real-time speech-to-text using Vosk (offline)."""

import json
import os
import logging

logger = logging.getLogger(__name__)


class Transcriber:
    """Streaming speech recognizer using Vosk."""

    def __init__(self, model_path, sample_rate=16000):
        self.model = None
        self.recognizer = None
        self.sample_rate = sample_rate
        self.model_path = model_path
        self.is_loaded = False

    def load(self):
        """Load the Vosk model and initialize the recognizer."""
        try:
            from vosk import Model, KaldiRecognizer, SetLogLevel
            SetLogLevel(-1)  # Suppress verbose Vosk logs

            # Find the model directory
            model_dir = self._find_model_dir()
            if model_dir is None:
                logger.warning(
                    "Vosk model not found in 'models/' directory. "
                    "Download from https://alphacephei.com/vosk/models"
                )
                return False

            logger.info(f"Loading Vosk model from: {model_dir}")
            self.model = Model(model_dir)
            self.recognizer = KaldiRecognizer(self.model, self.sample_rate)
            self.is_loaded = True
            logger.info("Vosk model loaded — transcription enabled")
            return True

        except ImportError:
            logger.warning("Vosk package not installed. Transcription disabled.")
            return False
        except Exception as e:
            logger.error(f"Failed to load Vosk model: {e}")
            return False

    def _find_model_dir(self):
        """Search for a valid Vosk model in the models directory."""
        if not os.path.isdir(self.model_path):
            return None

        # Check if model_path itself is a model (has 'conf' subfolder)
        if os.path.exists(os.path.join(self.model_path, "conf")):
            return self.model_path

        # Look for model subdirectory
        for entry in sorted(os.listdir(self.model_path)):
            full = os.path.join(self.model_path, entry)
            if os.path.isdir(full) and os.path.exists(os.path.join(full, "conf")):
                return full

        return None

    def process(self, pcm_bytes):
        """Feed PCM audio bytes and return transcription result or None."""
        if not self.is_loaded or self.recognizer is None:
            return None

        try:
            if self.recognizer.AcceptWaveform(pcm_bytes):
                result = json.loads(self.recognizer.Result())
                text = result.get("text", "").strip()
                if text:
                    return {"type": "transcription", "text": text, "final": True}
            else:
                partial = json.loads(self.recognizer.PartialResult())
                text = partial.get("partial", "").strip()
                if text:
                    return {"type": "transcription", "text": text, "final": False}
        except Exception as e:
            logger.warning(f"Transcription error: {e}")

        return None

    def reset(self):
        """Reset the recognizer for a new session."""
        if self.is_loaded and self.model:
            from vosk import KaldiRecognizer
            self.recognizer = KaldiRecognizer(self.model, self.sample_rate)
            logger.info("Transcriber reset for new session")
