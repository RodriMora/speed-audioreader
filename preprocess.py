#!/usr/bin/env python3
"""
Preprocess audiobook: extract EPUB text and generate word-level timestamps
using faster-whisper with GPU acceleration.

Outputs a JSON alignment file used by the web reader.

Usage:
    python preprocess.py <book-directory>

Example:
    python preprocess.py books/consider-phlebas

The book directory should contain:
    - One or more audio files (.m4b, .m4a, .mp3)
    - An EPUB file (.epub)

Output files are written to the book directory:
    - alignment.json          Full word-level alignment
    - alignment_compact.json  Compact format for the web reader
    - chapters.json           Extracted EPUB chapters
    - meta.json               Book metadata for the library
"""

import argparse
import json
import os
import sys
import re
import subprocess
from pathlib import Path

# Force unbuffered output
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

from ebooklib import epub
from bs4 import BeautifulSoup
from faster_whisper import WhisperModel


# ── Configuration ──────────────────────────────────────────────────────────────

# Whisper model: "large-v3" for best quality, "base" for fast processing
# "base" provides good word-level timestamps at 10-20x realtime speed
WHISPER_MODEL = "base"
DEVICE = "cuda"
COMPUTE_TYPE = "float16"  # Use float16 for RTX 4060

AUDIO_EXTENSIONS = {".m4b", ".m4a", ".mp3", ".mp4", ".ogg", ".flac", ".wav"}


# ── EPUB Text Extraction ──────────────────────────────────────────────────────

def extract_epub_text(epub_path: Path) -> list[dict]:
    """Extract text from EPUB, returning a list of chapters with title and text."""
    book = epub.read_epub(str(epub_path))
    chapters = []

    for item in book.get_items_of_type(9):  # ITEM_DOCUMENT
        soup = BeautifulSoup(item.get_content(), "lxml")

        # Remove scripts, styles
        for tag in soup.find_all(["script", "style", "noscript"]):
            tag.decompose()

        text = soup.get_text(separator=" ", strip=True)
        if not text or len(text.strip()) < 50:
            continue

        # Try to extract chapter title
        title = None
        for heading in soup.find_all(["h1", "h2", "h3"]):
            t = heading.get_text(strip=True)
            if t:
                title = t
                break

        chapters.append({
            "title": title or f"Chapter {len(chapters) + 1}",
            "text": text,
            "filename": item.get_name(),
        })

    return chapters


# ── Audio Conversion ──────────────────────────────────────────────────────────

def convert_m4b_to_wav(m4b_path: Path, wav_path: Path) -> Path:
    """Convert M4B to WAV using ffmpeg for processing."""
    if wav_path.exists():
        print(f"  WAV already exists: {wav_path}", flush=True)
        return wav_path

    print(f"  Converting {m4b_path.name} -> {wav_path.name}...", flush=True)
    subprocess.run(
        [
            "ffmpeg", "-i", str(m4b_path),
            "-ar", "16000",  # 16kHz for Whisper
            "-ac", "1",      # mono
            "-c:a", "pcm_s16le",
            str(wav_path),
        ],
        check=True,
        capture_output=True,
    )
    print(f"  Done: {wav_path}", flush=True)
    return wav_path


# ── Transcription with Word Timestamps ────────────────────────────────────────

def transcribe_audio(model: WhisperModel, audio_path: Path, time_offset: float = 0.0) -> list[dict]:
    """
    Transcribe audio file and return word-level timestamps.
    time_offset is added to all timestamps (for multi-part audiobooks).
    """
    print(f"  Transcribing {audio_path.name}...", flush=True)
    print(f"  (This may take a while for long audiobooks)", flush=True)

    segments, info = model.transcribe(
        str(audio_path),
        beam_size=1,
        word_timestamps=True,
        language="en",
        vad_filter=True,
        vad_parameters=dict(
            min_silence_duration_ms=300,
        ),
    )

    words = []
    segment_count = 0

    for segment in segments:
        segment_count += 1
        if segment_count % 50 == 0:
            print(f"    Processed {segment_count} segments ({segment.end:.1f}s / {segment.end/3600:.2f}h)...", flush=True)

        if segment.words:
            for w in segment.words:
                words.append({
                    "word": w.word.strip(),
                    "start": round(w.start + time_offset, 3),
                    "end": round(w.end + time_offset, 3),
                })

    print(f"  Transcription complete: {len(words)} words, {segment_count} segments", flush=True)
    return words


def get_audio_duration(audio_path: Path) -> float:
    """Get the duration of an audio file in seconds using ffprobe."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(result.stdout.strip())


# ── Book Directory Discovery ─────────────────────────────────────────────────

def discover_book_files(book_dir: Path) -> tuple[list[Path], Path | None]:
    """
    Auto-detect audio files and EPUB in the book directory.
    Returns (audio_files, epub_file).
    Audio files are sorted by name for consistent ordering.
    """
    audio_files = sorted(
        f for f in book_dir.iterdir()
        if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS
    )

    epub_files = sorted(
        f for f in book_dir.iterdir()
        if f.is_file() and f.suffix.lower() == ".epub"
    )

    epub_file = epub_files[0] if epub_files else None

    return audio_files, epub_file


def extract_book_metadata(epub_file: Path | None, book_dir: Path) -> dict:
    """Extract title and author from the EPUB, or derive from directory name."""
    title = book_dir.name.replace("-", " ").replace("_", " ").title()
    author = "Unknown Author"

    if epub_file and epub_file.exists():
        try:
            book = epub.read_epub(str(epub_file))
            meta_title = book.get_metadata("DC", "title")
            meta_author = book.get_metadata("DC", "creator")
            if meta_title:
                title = meta_title[0][0]
            if meta_author:
                author = meta_author[0][0]
        except Exception as e:
            print(f"  Warning: Could not read EPUB metadata: {e}", flush=True)

    return {"title": title, "author": author}


# ── Main Processing Pipeline ─────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Preprocess audiobook for Speed AudioReader"
    )
    parser.add_argument(
        "book_dir",
        type=Path,
        help="Path to the book directory (e.g. books/consider-phlebas)",
    )
    parser.add_argument(
        "--title",
        type=str,
        default=None,
        help="Override book title (otherwise extracted from EPUB)",
    )
    parser.add_argument(
        "--author",
        type=str,
        default=None,
        help="Override author name (otherwise extracted from EPUB)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=WHISPER_MODEL,
        help=f"Whisper model to use (default: {WHISPER_MODEL})",
    )
    parser.add_argument(
        "--device",
        type=str,
        default=DEVICE,
        help=f"Device to use (default: {DEVICE})",
    )
    args = parser.parse_args()

    book_dir = args.book_dir.resolve() if not args.book_dir.is_absolute() else args.book_dir
    # Keep the relative path for use in the alignment data
    book_dir_rel = args.book_dir

    if not book_dir.is_dir():
        print(f"Error: '{book_dir}' is not a directory.", file=sys.stderr)
        sys.exit(1)

    print("=" * 60, flush=True)
    print("Speed AudioReader - Preprocessing Pipeline", flush=True)
    print(f"  Book directory: {book_dir}", flush=True)
    print("=" * 60, flush=True)

    # Discover files
    audio_files, epub_file = discover_book_files(book_dir)

    if not audio_files:
        print(f"Error: No audio files found in '{book_dir}'.", file=sys.stderr)
        print(f"  Supported formats: {', '.join(sorted(AUDIO_EXTENSIONS))}", file=sys.stderr)
        sys.exit(1)

    print(f"\n  Audio files found: {len(audio_files)}", flush=True)
    for f in audio_files:
        print(f"    - {f.name}", flush=True)

    if epub_file:
        print(f"  EPUB found: {epub_file.name}", flush=True)
    else:
        print("  No EPUB found (chapters will not be available)", flush=True)

    # Extract metadata
    meta = extract_book_metadata(epub_file, book_dir)
    if args.title:
        meta["title"] = args.title
    if args.author:
        meta["author"] = args.author

    book_slug = book_dir.name
    meta["slug"] = book_slug

    print(f"\n  Title:  {meta['title']}", flush=True)
    print(f"  Author: {meta['author']}", flush=True)
    print(f"  Slug:   {meta['slug']}", flush=True)

    # Step 1: Extract EPUB text (if available)
    chapters = []
    if epub_file:
        print("\n[1/4] Extracting text from EPUB...", flush=True)
        chapters = extract_epub_text(epub_file)
        print(f"  Found {len(chapters)} chapters", flush=True)
        for i, ch in enumerate(chapters):
            word_count = len(ch["text"].split())
            print(f"    {i+1}. {ch['title']} ({word_count} words)", flush=True)

        # Save chapters to book directory
        chapters_file = book_dir / "chapters.json"
        with open(chapters_file, "w") as f:
            json.dump(chapters, f, indent=2)
        print(f"  Saved to {chapters_file}", flush=True)
    else:
        print("\n[1/4] Skipping EPUB extraction (no EPUB file found)", flush=True)

    # Step 2: Convert audio files to WAV
    print("\n[2/4] Converting audiobook files...", flush=True)
    wav_files = []
    for af in audio_files:
        if af.suffix.lower() == ".wav":
            wav_files.append(af)
        else:
            wav = af.with_suffix(".wav")
            convert_m4b_to_wav(af, wav)
            wav_files.append(wav)

    # Step 3: Get durations for offset calculation
    print("\n[3/4] Getting audio durations...", flush=True)
    durations = []
    for af in audio_files:
        dur = get_audio_duration(af)
        durations.append(dur)
        print(f"  {af.name}: {dur:.1f}s ({dur/3600:.1f}h)", flush=True)

    # Step 4: Transcribe with word timestamps
    whisper_model = args.model
    device = args.device
    print(f"\n[4/4] Loading Whisper model and transcribing...", flush=True)
    print(f"  Model: {whisper_model}, Device: {device}, Compute: {COMPUTE_TYPE}", flush=True)

    model = WhisperModel(whisper_model, device=device, compute_type=COMPUTE_TYPE)
    print("  Model loaded!", flush=True)

    all_words = []
    time_offset = 0.0

    for i, (wav, af) in enumerate(zip(wav_files, audio_files)):
        part_num = i + 1
        print(f"\n  == Part {part_num}/{len(wav_files)} ==", flush=True)
        words = transcribe_audio(model, wav, time_offset=time_offset)
        all_words.extend(words)
        time_offset += durations[i]

    # Save word-level alignment to book directory
    alignment_file = book_dir / "alignment.json"
    alignment_data = {
        "title": meta["title"],
        "author": meta["author"],
        "slug": meta["slug"],
        "audio_files": [str(f) for f in audio_files],
        "total_duration": sum(durations),
        "parts": [
            {
                "file": str(book_dir_rel / audio_files[i].name),
                "duration": durations[i],
                "offset": sum(durations[:i]),
            }
            for i in range(len(audio_files))
        ],
        "word_count": len(all_words),
        "words": all_words,
    }

    with open(alignment_file, "w") as f:
        json.dump(alignment_data, f)
    print(f"\n  Alignment saved to {alignment_file}", flush=True)
    print(f"  Total words: {len(all_words)}", flush=True)
    print(f"  File size: {os.path.getsize(alignment_file) / 1024 / 1024:.1f} MB", flush=True)

    # Also save a compact version for faster loading
    compact_file = book_dir / "alignment_compact.json"
    compact_data = {
        "title": alignment_data["title"],
        "author": alignment_data["author"],
        "slug": alignment_data["slug"],
        "total_duration": alignment_data["total_duration"],
        "parts": alignment_data["parts"],
        "word_count": alignment_data["word_count"],
        # Compact format: [word, start, end] arrays
        "words": [[w["word"], w["start"], w["end"]] for w in all_words],
    }
    with open(compact_file, "w") as f:
        json.dump(compact_data, f)
    print(f"  Compact alignment saved to {compact_file}", flush=True)
    print(f"  Compact size: {os.path.getsize(compact_file) / 1024 / 1024:.1f} MB", flush=True)

    # Save book metadata
    meta_file = book_dir / "meta.json"
    meta["total_duration"] = sum(durations)
    meta["word_count"] = len(all_words)
    meta["parts_count"] = len(audio_files)
    meta["has_chapters"] = len(chapters) > 0
    with open(meta_file, "w") as f:
        json.dump(meta, f, indent=2)
    print(f"  Book metadata saved to {meta_file}", flush=True)

    print("\n" + "=" * 60, flush=True)
    print("Preprocessing complete!", flush=True)
    print(f"Next step: python map_chapters.py {book_dir_rel}", flush=True)
    print("=" * 60, flush=True)


if __name__ == "__main__":
    main()
