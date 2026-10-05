#!/usr/bin/env python3
"""Serve the app only, for a private Tailscale HTTPS preview."""
import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--google-origin', help='Exact authorised HTTPS preview origin')
    args = parser.parse_args()
    config = None
    if args.google_origin:
        origin = urlsplit(args.google_origin)
        if origin.scheme != 'https' or not origin.hostname or origin.path or origin.query or origin.fragment or origin.username:
            parser.error('--google-origin must be an HTTPS origin without a path')
        config = json.loads((ROOT / 'assets/google-drive-config.local.json').read_text())
        config['origins'] = list(dict.fromkeys([*config.get('origins', []), args.google_origin]))

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(ROOT), **kw)

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            super().end_headers()

        def do_GET(self):
            path = unquote(urlsplit(self.path).path)
            parts = path.strip('/').split('/')
            allowed = path in ('/', '/index.html') or (parts[0] in ('assets', 'docs'))
            target = (ROOT / path.lstrip('/')).resolve()
            if (not allowed or any(p.startswith('.') for p in parts) or
                    '.local.' in path or not target.is_relative_to(ROOT) or
                    (path != '/' and not target.is_file())):
                self.send_error(404)
                return
            if config is not None and path == '/assets/google-drive-config.json':
                data = json.dumps(config).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                if self.command != 'HEAD':
                    self.wfile.write(data)
                return
            if path == '/':
                self.path = '/index.html'
            if self.command == 'HEAD':
                super().do_HEAD()
            else:
                super().do_GET()

        def do_HEAD(self):
            self.do_GET()

        def log_message(self, fmt, *values):
            # Do not retain query strings or sharing identifiers in logs.
            pass

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'App-only preview listening on 127.0.0.1:{args.port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
