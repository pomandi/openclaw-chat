#!/usr/bin/env python3
"""
Lightweight Whisper transcription HTTP server using faster-whisper.
Accepts POST /transcribe with audio (base64 data URL), returns JSON { "text": "..." }
Runs on port 18791 on the host machine.

Uses faster-whisper (CTranslate2) for ~5-8x speedup over openai-whisper on CPU.
Model is loaded once at startup and kept in memory.
"""

import http.server
import json
import tempfile
import os
import subprocess
import base64
import sys
import threading

PORT = 18791
TOKEN = os.environ.get('OPENCLAW_GATEWAY_TOKEN', '')
MODEL_SIZE = os.environ.get('WHISPER_MODEL', 'tiny')
COMPUTE_TYPE = os.environ.get('WHISPER_COMPUTE_TYPE', 'int8')

# Global model — loaded once at startup
_model = None
_model_lock = threading.Lock()


def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        print(f"[Whisper] Loading faster-whisper model={MODEL_SIZE} compute_type={COMPUTE_TYPE}...",
              file=sys.stderr, flush=True)
        _model = WhisperModel(MODEL_SIZE, device="cpu", compute_type=COMPUTE_TYPE)
        print(f"[Whisper] Model loaded successfully.", file=sys.stderr, flush=True)
    return _model


class TranscriptionHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "model": MODEL_SIZE,
                "compute_type": COMPUTE_TYPE,
                "engine": "faster-whisper",
                "model_loaded": _model is not None,
            }).encode())
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        # Auth check
        auth = self.headers.get('Authorization', '')
        token = auth.replace('Bearer ', '') if auth.startswith('Bearer ') else ''
        if TOKEN and token != TOKEN:
            self.send_response(401)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Unauthorized"}).encode())
            return

        if self.path != '/transcribe':
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0 or content_length > 25 * 1024 * 1024:  # 25MB max
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Invalid content length"}).encode())
            return

        body = self.rfile.read(content_length)

        try:
            data = json.loads(body)
            audio_b64 = data.get('audio', '')
            language = data.get('language', 'tr')

            # Remove data URL prefix if present
            if ',' in audio_b64:
                audio_b64 = audio_b64.split(',', 1)[1]

            audio_bytes = base64.b64decode(audio_b64)
        except Exception as e:
            self.send_response(400)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": f"Invalid request: {str(e)}"}).encode())
            return

        print(f"[Whisper] Received {len(audio_bytes)} bytes, language={language}",
              file=sys.stderr, flush=True)

        temp_path = None
        wav_path = None

        try:
            # Save to temp file
            with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as f:
                f.write(audio_bytes)
                temp_path = f.name

            # Convert to wav (faster-whisper/ffmpeg works better with wav)
            wav_path = temp_path.replace('.webm', '.wav')
            ffmpeg_result = subprocess.run(
                ['ffmpeg', '-i', temp_path, '-ar', '16000', '-ac', '1', '-y', wav_path],
                capture_output=True, timeout=30
            )

            if ffmpeg_result.returncode != 0:
                stderr_msg = ffmpeg_result.stderr.decode()[:300]
                print(f"[Whisper] ffmpeg failed (rc={ffmpeg_result.returncode}): {stderr_msg}",
                      file=sys.stderr, flush=True)
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "error": "Audio conversion failed",
                    "text": ""
                }).encode())
                return

            # Transcribe with faster-whisper (in-memory model, no subprocess)
            with _model_lock:
                model = get_model()
                segments, info = model.transcribe(
                    wav_path,
                    language=language,
                    beam_size=3,
                    vad_filter=True,  # Skip silence for speed
                )
                text = " ".join(segment.text.strip() for segment in segments)

            detected_lang = info.language
            lang_prob = info.language_probability

            print(f"[Whisper] Result: lang={detected_lang} (p={lang_prob:.2f}) "
                  f"text='{text[:100]}'", file=sys.stderr, flush=True)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                "text": text,
                "language": detected_lang,
                "language_probability": round(lang_prob, 2),
            }).encode())

        except Exception as e:
            print(f"[Whisper] Error: {e}", file=sys.stderr, flush=True)
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e), "text": ""}).encode())

        finally:
            # Cleanup temp files
            for p in [temp_path, wav_path]:
                if p:
                    try:
                        os.unlink(p)
                    except OSError:
                        pass

    def log_message(self, format, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (
            self.client_address[0], self.log_date_time_string(), format % args))
        sys.stderr.flush()


if __name__ == '__main__':
    # Pre-load model at startup so first request is fast
    print(f"[Whisper] Starting server on port {PORT}...", file=sys.stderr, flush=True)
    get_model()

    server = http.server.HTTPServer(('0.0.0.0', PORT), TranscriptionHandler)
    print(f"[Whisper] Transcription server ready on port {PORT} "
          f"(model={MODEL_SIZE}, compute={COMPUTE_TYPE})",
          file=sys.stderr, flush=True)
    server.serve_forever()
