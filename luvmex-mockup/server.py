"""
Simple server for the Promethea fashion website.
Run:  python server.py
Then open http://localhost:8080
For LAN access, open http://<your-ip>:8080 from any device on the same network.
"""
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = int(os.environ.get('PORT', 8080))

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.address_string()} — {fmt % args}")

    def end_headers(self):
        # Allow cross-origin requests for Shopify API calls
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

os.chdir(os.path.dirname(os.path.abspath(__file__)))

print(f"\n  PROMETHEA — Dev Server")
print(f"  Local:   http://localhost:{PORT}")
print(f"  Network: http://0.0.0.0:{PORT}")
print(f"  Press Ctrl+C to stop\n")

HTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
