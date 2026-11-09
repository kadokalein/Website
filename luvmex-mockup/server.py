"""
Promethea fashion website server.
Serves the static site + exposes /api/images/<folder> so the browser
can discover which images exist in each subfolder.

Run:   python server.py
Open:  http://localhost:8080
LAN:   http://<your-ip>:8080  (anyone on your WiFi can visit)
"""
import os, json
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT  = int(os.environ.get('PORT', 8080))
ROOT  = os.path.dirname(os.path.abspath(__file__))
IMG_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif'}

os.chdir(ROOT)


class Handler(SimpleHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} {fmt % args}")

    def do_GET(self):
        # ── Image directory API ──────────────────────────────────────────
        if self.path.startswith('/api/images/'):
            folder_rel = self.path[len('/api/images/'):].split('?')[0].strip('/')
            self._serve_image_list(folder_rel)
            return

        # ── Everything else: static files ───────────────────────────────
        super().do_GET()

    def _serve_image_list(self, folder_rel):
        # Safety: only allow reading inside the images/ directory
        safe = os.path.normpath(os.path.join(ROOT, 'images', folder_rel))
        if not safe.startswith(os.path.join(ROOT, 'images')):
            self._json(403, {'error': 'Forbidden'})
            return

        if not os.path.isdir(safe):
            self._json(404, {'error': f'Folder not found: {folder_rel}'})
            return

        images = sorted([
            f'/images/{folder_rel}/{f}'
            for f in os.listdir(safe)
            if os.path.splitext(f)[1].lower() in IMG_EXTS
        ])

        # Also list subfolders so the browser can discover the tree
        subfolders = sorted([
            f for f in os.listdir(safe)
            if os.path.isdir(os.path.join(safe, f))
        ])

        self._json(200, {
            'folder': folder_rel,
            'images': images,
            'subfolders': subfolders,
        })

    def _json(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type',  'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()


print(f"\n  PROMETHEA — Server")
print(f"  Local:   http://localhost:{PORT}")
print(f"  Network: http://0.0.0.0:{PORT}")
print(f"  Image API: http://localhost:{PORT}/api/images/men/tops")
print(f"  Press Ctrl+C to stop\n")

HTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
