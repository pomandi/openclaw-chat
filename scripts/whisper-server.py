#!/usr/bin/env python3
"""
Lightweight Whisper transcription HTTP server.
Accepts POST /transcribe with audio file, returns JSON { "text": "..." }
Runs on port 18791 on the host machine.
"""

import http.server
import json
import tempfile
import os
import subprocess
import base64
from urllib.parse import urlparse, parse_qs

PORT = 18791
TOKEN = os.environ.get('OPENCLAW_GATEWAY_TOKEN', '')

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
            self.wfile.write(json.dumps({"ok": True}).encode())
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
            language = data.get('language', 'tr')  # Default Turkish
            
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

        # Save to temp file
        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as f:
            f.write(audio_bytes)
            temp_path = f.name

        import sys
        print(f"[Whisper] Received {len(audio_bytes)} bytes, language={language}", file=sys.stderr, flush=True)

        try:
            # Convert to wav first (Whisper works better with wav)
            wav_path = temp_path.replace('.webm', '.wav')
            ffmpeg_result = subprocess.run(
                ['ffmpeg', '-i', temp_path, '-ar', '16000', '-ac', '1', '-y', wav_path],
                capture_output=True, timeout=30
            )
            print(f"[Whisper] ffmpeg rc={ffmpeg_result.returncode}, wav exists={os.path.exists(wav_path)}", file=sys.stderr, flush=True)
            if ffmpeg_result.returncode != 0:
                print(f"[Whisper] ffmpeg stderr: {ffmpeg_result.stderr.decode()[:300]}", file=sys.stderr, flush=True)

            # Run Whisper (use full path since systemd may not have ~/.local/bin in PATH)
            whisper_bin = os.path.expanduser('~/.local/bin/whisper')
            if not os.path.exists(whisper_bin):
                whisper_bin = 'whisper'  # fallback to PATH
            result = subprocess.run(
                [whisper_bin, wav_path, '--language', language, '--model', 'base',
                 '--output_format', 'txt', '--output_dir', '/tmp/whisper_out'],
                capture_output=True, text=True, timeout=60
            )
            print(f"[Whisper] whisper rc={result.returncode}", file=sys.stderr, flush=True)
            if result.stderr:
                print(f"[Whisper] whisper stderr: {result.stderr[:300]}", file=sys.stderr, flush=True)

            # Read output
            txt_path = wav_path.replace('.wav', '.txt').split('/')[-1]
            txt_full = os.path.join('/tmp/whisper_out', txt_path)
            
            print(f"[Whisper] Looking for output: {txt_full}, exists={os.path.exists(txt_full)}", file=sys.stderr, flush=True)
            
            if os.path.exists(txt_full):
                with open(txt_full) as f:
                    text = f.read().strip()
                os.unlink(txt_full)
            else:
                # Try stderr/stdout for text
                text = result.stdout.strip() if result.stdout else ''
                if not text:
                    text = f"[Transcription failed: {result.stderr[:200]}]"
            
            print(f"[Whisper] Result text: '{text[:100]}'", file=sys.stderr, flush=True)

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"text": text, "language": language}).encode())

        except subprocess.TimeoutExpired:
            self.send_response(504)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Transcription timeout"}).encode())
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())
        finally:
            # Cleanup
            for p in [temp_path, temp_path.replace('.webm', '.wav')]:
                try: os.unlink(p)
                except: pass

    def log_message(self, format, *args):
        import sys
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), format%args))
        sys.stderr.flush()

if __name__ == '__main__':
    os.makedirs('/tmp/whisper_out', exist_ok=True)
    server = http.server.HTTPServer(('0.0.0.0', PORT), TranscriptionHandler)
    print(f'Whisper transcription server listening on port {PORT}')
    server.serve_forever()
