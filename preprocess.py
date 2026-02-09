#!/usr/bin/env python3
"""
Preprocess audiobook: extract EPUB text and generate word-level timestamps
using faster-whisper with GPU acceleration.

Outputs a JSON alignment file used by the web reader.
"""

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

BOOK_DIR = Path("books/consider-phlebas")
AUDIO_FILES = [
    BOOK_DIR / "consider-phlebas-1.m4b",
    BOOK_DIR / "consider-phlebas-2.m4b",
]
EPUB_FILE = BOOK_DIR / "consider-phlebas.epub"
OUTPUT_DIR = Path("app/data")

# Whisper model: "large-v3" for best quality, "base" for fast processing
# "base" provides good word-level timestamps at 10-20x realtime speed
WHISPER_MODEL = "base"
DEVICE = "cuda"
COMPUTE_TYPE = "float16"  # Use float16 for RTX 4060


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


# ── Main Processing Pipeline ─────────────────────────────────────────────────

def main():
    print("=" * 60, flush=True)
    print("Speed AudioReader - Preprocessing Pipeline", flush=True)
    print("=" * 60, flush=True)

    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Step 1: Extract EPUB text
    print("\n[1/4] Extracting text from EPUB...", flush=True)
    chapters = extract_epub_text(EPUB_FILE)
    print(f"  Found {len(chapters)} chapters", flush=True)
    for i, ch in enumerate(chapters):
        word_count = len(ch["text"].split())
        print(f"    {i+1}. {ch['title']} ({word_count} words)", flush=True)

    # Save chapters
    chapters_file = OUTPUT_DIR / "chapters.json"
    with open(chapters_file, "w") as f:
        json.dump(chapters, f, indent=2)
    print(f"  Saved to {chapters_file}", flush=True)

    # Step 2: Convert M4B files to WAV
    print("\n[2/4] Converting audiobook files...", flush=True)
    wav_files = []
    for m4b in AUDIO_FILES:
        wav = m4b.with_suffix(".wav")
        convert_m4b_to_wav(m4b, wav)
        wav_files.append(wav)

    # Step 3: Get durations for offset calculation
    print("\n[3/4] Getting audio durations...", flush=True)
    durations = []
    for m4b in AUDIO_FILES:
        dur = get_audio_duration(m4b)
        durations.append(dur)
        print(f"  {m4b.name}: {dur:.1f}s ({dur/3600:.1f}h)", flush=True)

    # Step 4: Transcribe with word timestamps
    print("\n[4/4] Loading Whisper model and transcribing...", flush=True)
    print(f"  Model: {WHISPER_MODEL}, Device: {DEVICE}, Compute: {COMPUTE_TYPE}", flush=True)

    model = WhisperModel(WHISPER_MODEL, device=DEVICE, compute_type=COMPUTE_TYPE)
    print("  Model loaded!", flush=True)

    all_words = []
    time_offset = 0.0

    for i, (wav, m4b) in enumerate(zip(wav_files, AUDIO_FILES)):
        part_num = i + 1
        print(f"\n  == Part {part_num}/{len(wav_files)} ==", flush=True)
        words = transcribe_audio(model, wav, time_offset=time_offset)
        all_words.extend(words)
        time_offset += durations[i]

    # Save word-level alignment
    alignment_file = OUTPUT_DIR / "alignment.json"
    alignment_data = {
        "title": "Consider Phlebas",
        "author": "Iain M. Banks",
        "audio_files": [str(f) for f in AUDIO_FILES],
        "total_duration": sum(durations),
        "parts": [
            {
                "file": str(AUDIO_FILES[i]),
                "duration": durations[i],
                "offset": sum(durations[:i]),
            }
            for i in range(len(AUDIO_FILES))
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
    compact_file = OUTPUT_DIR / "alignment_compact.json"
    compact_data = {
        "title": alignment_data["title"],
        "author": alignment_data["author"],
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

    print("\n" + "=" * 60, flush=True)
    print("Preprocessing complete!", flush=True)
    print("=" * 60, flush=True)


if __name__ == "__main__":
    main()
