# Speed AudioReader

A synchronized audiobook speed reader that displays one word at a time, perfectly synced to the audio playback. Combines the RSVP (Rapid Serial Visual Presentation) reading technique with audiobook narration.

## How it works

1. **Preprocessing**: Whisper AI transcribes your audiobook with word-level timestamps using GPU acceleration
2. **Playback**: A web-based reader plays the audio and highlights each word at the exact moment it's spoken
3. **Speed control**: Adjust playback speed from 0.25× to 3.0× — the audio pitch-corrects automatically

## Features

- **Book library** — browse and switch between multiple audiobooks
- One-word-at-a-time display synced to audiobook audio
- ORP (Optimal Recognition Point) focus letter highlighting
- Adjustable playback speed (0.25× – 3.0×)
- Progress bar with scrubbing / seeking
- **Chapter navigation** — chapter list, prev/next buttons, progress bar markers
- Multi-part audiobook support (seamless transitions)
- Per-book position memory (resumes where you left off)
- Customizable colors, font size, and focus letter color
- Optional context words (previous/next words displayed faintly)
- Keyboard-driven controls

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` / `→` | Seek ±5 seconds |
| `↑` / `↓` | Speed ±0.1× |
| `[` / `]` | Seek ±30 seconds |
| `P` / `N` | Previous / Next chapter |
| `L` | Toggle chapter list |
| `R` | Reset to beginning |
| `M` | Mute / Unmute |
| `C` | Toggle context words |
| `Esc` | Back to library |

## Setup

### Requirements

- Python 3.11+ (3.12 recommended)
- NVIDIA GPU with CUDA support (for Whisper transcription)
- ffmpeg
- An audiobook (`.m4b`, `.mp3`, etc.) and its corresponding `.epub`

### 1. Install dependencies

```bash
# Create virtual environment (Python 3.12 recommended for ML compatibility)
uv venv --python 3.12 .venv
source .venv/bin/activate

# Install Python packages
uv pip install -r requirements.txt
```

### 2. Add your audiobook

Place your audiobook files in `books/<book-name>/`:

```
books/
  your-book/
    your-book-part1.m4b
    your-book-part2.m4b   # optional, for multi-part audiobooks
    your-book.epub
```

### 3. Preprocess your book

The preprocessing scripts auto-detect audio files and EPUB in the book directory. No configuration file editing needed.

Choose your Whisper model based on your GPU:

| Model | VRAM | Speed | Quality |
|-------|------|-------|---------|
| `base` | ~1 GB | ~10-20× realtime | Good timestamps |
| `small` | ~2 GB | ~5-10× realtime | Better timestamps |
| `medium` | ~5 GB | ~2-5× realtime | Great timestamps |
| `large-v3` | ~10 GB | ~1-3× realtime | Best timestamps |

Then run:

```bash
source .venv/bin/activate

# If your CUDA version differs from what ctranslate2 expects,
# you may need to set LD_LIBRARY_PATH to your CUDA 12 libs:
# export LD_LIBRARY_PATH=/path/to/cuda12/libs:$LD_LIBRARY_PATH

python preprocess.py books/your-book
```

This will:
- Auto-detect audio files and EPUB in the directory
- Extract title/author from EPUB metadata
- Convert audio to WAV (temporary)
- Transcribe with word-level timestamps via Whisper
- Output alignment data to `books/your-book/`

Then map chapter boundaries to audio timestamps:

```bash
python map_chapters.py books/your-book
```

This matches EPUB chapter text to the Whisper transcription to find where each chapter starts/ends in the audio. The chapter data is embedded into `alignment_compact.json`.

You can add as many books as you want — just repeat for each book directory.

### 4. Run the reader

```bash
python serve.py
```

Open **http://localhost:8080/app/** in your browser.

## Project Structure

```
├── app/
│   ├── index.html          # Main web page (library + reader)
│   ├── styles.css           # Dark theme UI
│   └── app.js               # Core reader + library + audio sync logic
├── books/                   # Place audiobooks here
│   ├── your-book/
│   │   ├── *.m4b / *.mp3   # Audio files (gitignored)
│   │   ├── *.epub           # EPUB file (gitignored)
│   │   ├── alignment_compact.json  # Generated word timestamps
│   │   ├── chapters.json           # Generated chapter data
│   │   └── meta.json               # Book metadata for library
│   └── another-book/
│       └── ...
├── preprocess.py            # Whisper transcription pipeline
├── map_chapters.py          # Chapter-to-timestamp mapper
├── serve.py                 # HTTP server with /api/books endpoint
└── requirements.txt         # Python dependencies
```

## Tech Stack

- **Whisper** (via faster-whisper + CTranslate2) — speech-to-text with word timestamps
- **CUDA / GPU** — hardware-accelerated transcription
- **Vanilla JS + Canvas** — zero-dependency web frontend
- **Python http.server** — lightweight server with Range request support for audio seeking

## License

MIT
