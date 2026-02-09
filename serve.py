#!/usr/bin/env python3
"""Simple HTTP server for the Speed AudioReader app."""

import http.server
import os
import sys

PORT = 8080


class CORSHandler(http.server.SimpleHTTPRequestHandler):
    """HTTP handler with proper MIME types for audio files and range request support."""

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".m4b": "audio/mp4",
        ".m4a": "audio/mp4",
        ".mp4": "audio/mp4",
        ".json": "application/json",
        ".woff2": "font/woff2",
    }

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range")
        self.end_headers()

    def do_GET(self):
        """Handle GET with support for Range requests (needed for audio seeking)."""
        # Parse the path
        path = self.translate_path(self.path)

        if not os.path.isfile(path):
            return super().do_GET()

        # Check for Range header
        range_header = self.headers.get("Range")
        if not range_header:
            return super().do_GET()

        # Parse range
        try:
            file_size = os.path.getsize(path)
            range_spec = range_header.replace("bytes=", "")
            parts = range_spec.split("-")
            start = int(parts[0]) if parts[0] else 0
            end = int(parts[1]) if parts[1] else file_size - 1
            end = min(end, file_size - 1)
            length = end - start + 1

            self.send_response(206)
            ctype = self.guess_type(path)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(length))
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache")
            http.server.SimpleHTTPRequestHandler.end_headers(self)

            with open(path, "rb") as f:
                f.seek(start)
                remaining = length
                buf_size = 64 * 1024
                while remaining > 0:
                    chunk = f.read(min(buf_size, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except Exception:
            return super().do_GET()


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    # Serve from app/ but with access to parent for audio files
    # We serve from the project root so audio files are accessible
    handler = CORSHandler
    server = http.server.HTTPServer(("0.0.0.0", PORT), handler)

    print(f"\n  Speed AudioReader Server")
    print(f"  ─────────────────────────")
    print(f"  Open: http://localhost:{PORT}/app/")
    print(f"  Press Ctrl+C to stop\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.shutdown()


if __name__ == "__main__":
    main()
