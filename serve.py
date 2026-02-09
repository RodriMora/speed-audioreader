#!/usr/bin/env python3
"""Simple HTTP server for the Speed AudioReader app."""

import http.server
import json
import os
import re
import sys
from pathlib import Path

PORT = 8080


def scan_books(books_dir: str = "books") -> list[dict]:
    """Scan the books directory for processed books and return their metadata."""
    books = []
    books_path = Path(books_dir)

    if not books_path.is_dir():
        return books

    for entry in sorted(books_path.iterdir()):
        if not entry.is_dir():
            continue

        # A book is "ready" if it has alignment_compact.json
        alignment_file = entry / "alignment_compact.json"
        meta_file = entry / "meta.json"

        if not alignment_file.exists():
            continue

        # Read metadata
        meta = {
            "slug": entry.name,
            "title": entry.name.replace("-", " ").replace("_", " ").title(),
            "author": "Unknown Author",
            "total_duration": 0,
            "word_count": 0,
            "has_chapters": False,
        }

        if meta_file.exists():
            try:
                with open(meta_file) as f:
                    file_meta = json.load(f)
                meta.update(file_meta)
            except Exception:
                pass
        else:
            # Try to read basic info from alignment_compact.json header
            try:
                with open(alignment_file) as f:
                    # Only read the first part to avoid loading the huge words array
                    raw = f.read(2048)
                    # Find title and author from the beginning of the JSON
                    title_match = re.search(r'"title"\s*:\s*"([^"]*)"', raw)
                    author_match = re.search(r'"author"\s*:\s*"([^"]*)"', raw)
                    duration_match = re.search(r'"total_duration"\s*:\s*([\d.]+)', raw)
                    word_count_match = re.search(r'"word_count"\s*:\s*(\d+)', raw)
                    if title_match:
                        meta["title"] = title_match.group(1)
                    if author_match:
                        meta["author"] = author_match.group(1)
                    if duration_match:
                        meta["total_duration"] = float(duration_match.group(1))
                    if word_count_match:
                        meta["word_count"] = int(word_count_match.group(1))
            except Exception:
                pass

        books.append(meta)

    return books


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
        """Handle GET with support for Range requests and API endpoints."""

        # ── API: List available books ──
        if self.path == "/api/books":
            books = scan_books()
            data = json.dumps(books).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache")
            http.server.SimpleHTTPRequestHandler.end_headers(self)
            self.wfile.write(data)
            return

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
