"""Voice notes: what was said, as text. Runs on this machine; nothing is sent anywhere.

English only. The speech model (VOICE_MODEL, default small.en) is fetched once on first use and kept
in memory after that. A note that cannot be made out comes back as None rather than as a guess.
"""
import io
import logging
import os
import threading

logger = logging.getLogger(__name__)

MODEL = os.getenv("VOICE_MODEL", "small.en")
MAX_SECONDS = 120
MIN_CONFIDENCE = -0.8  # average log-probability below this is the model making words up
SILENCE = 0.6
# Words the household is likely to say, so the model leans towards them.
_HINT = "A note about household money: euros, cash, paid, groceries, Albert Heijn, Jumbo, Lidl, parking, refund."

_lock = threading.Lock()
_model = None


class TooLong(Exception):
    pass


def _samples(data: bytes):
    """The recording as 16 kHz mono floats, whatever Telegram sent (OGG/Opus as a rule)."""
    import av
    import numpy as np

    with av.open(io.BytesIO(data)) as container:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
        chunks = []
        for frame in container.decode(audio=0):
            chunks += [f.to_ndarray().reshape(-1) for f in resampler.resample(frame)]
        chunks += [f.to_ndarray().reshape(-1) for f in resampler.resample(None)]
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32) / 32768.0


def transcribe(data: bytes) -> str | None:
    """What the note says, or None when it cannot be understood. Raises TooLong for a long recording."""
    global _model
    try:
        audio = _samples(data)
    except Exception as e:  # not a recording at all
        logger.info("[voice] a recording could not be read: %s", type(e).__name__)
        return None
    if len(audio) > MAX_SECONDS * 16000:
        raise TooLong()
    if len(audio) < 1600:
        return None
    with _lock:
        if _model is None:
            from faster_whisper import WhisperModel

            _model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=min(8, os.cpu_count() or 2))
        segments, _ = _model.transcribe(audio, language="en", beam_size=5, vad_filter=True, initial_prompt=_HINT)
        segments = list(segments)
    heard = [s for s in segments if s.no_speech_prob < SILENCE and s.text.strip()]
    if not heard:
        return None
    if sum(s.avg_logprob for s in heard) / len(heard) < MIN_CONFIDENCE:
        return None
    return " ".join(s.text.strip() for s in heard)
