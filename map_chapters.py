#!/usr/bin/env python3
"""
Map EPUB chapter boundaries to audio timestamps.

Reads chapters.json (from EPUB) and alignment_compact.json (from Whisper),
matches each chapter's opening text to the transcribed word stream, and
writes the chapter timestamps back into alignment_compact.json.

Usage:
    python map_chapters.py <book-directory>

Example:
    python map_chapters.py books/consider-phlebas
"""

import argparse
import json
import re
import sys
from pathlib import Path

# Minimum chapter text length (characters) to consider a real chapter
MIN_CHAPTER_TEXT_LEN = 200

# How many words from the start of each chapter to use for matching
MATCH_WINDOW = 15

# Minimum ratio of matched words to consider a valid match
MIN_MATCH_RATIO = 0.5


def normalize(word: str) -> str:
    """Normalize a word for fuzzy comparison: lowercase, strip punctuation."""
    return re.sub(r"[^a-z0-9]", "", word.lower())


def extract_words(text: str) -> list[str]:
    """Split text into normalized words."""
    return [normalize(w) for w in text.split() if normalize(w)]


def find_chapter_start(
    chapter_words: list[str],
    transcribed_words: list[list],
    search_from: int,
    search_limit: int | None = None,
) -> tuple[int, float]:
    """
    Find the best matching position for chapter_words in the transcribed word stream.

    Uses a sliding window approach: for each position in the word stream,
    count how many of the first N chapter words match the transcribed words.

    Returns (word_index, score) or (-1, 0) if no good match found.
    """
    n = min(len(chapter_words), MATCH_WINDOW)
    if n < 3:
        return -1, 0.0

    search_end = len(transcribed_words) - n
    if search_limit is not None:
        search_end = min(search_end, search_from + search_limit)

    best_idx = -1
    best_score = 0.0

    for i in range(search_from, search_end):
        matches = 0
        for j in range(n):
            tw = normalize(transcribed_words[i + j][0])
            cw = chapter_words[j]
            if tw == cw:
                matches += 1
            elif len(tw) > 2 and len(cw) > 2 and (tw.startswith(cw[:3]) or cw.startswith(tw[:3])):
                # Partial match for words that are close (handles minor transcription errors)
                matches += 0.5

        score = matches / n
        if score > best_score:
            best_score = score
            best_idx = i

    return best_idx, best_score


def main():
    parser = argparse.ArgumentParser(
        description="Map EPUB chapter boundaries to audio timestamps"
    )
    parser.add_argument(
        "book_dir",
        type=Path,
        help="Path to the book directory (e.g. books/consider-phlebas)",
    )
    args = parser.parse_args()

    book_dir = args.book_dir
    if not book_dir.is_dir():
        print(f"Error: '{book_dir}' is not a directory.", file=sys.stderr)
        sys.exit(1)

    chapters_file = book_dir / "chapters.json"
    alignment_file = book_dir / "alignment_compact.json"

    print("=" * 60)
    print("Chapter Timestamp Mapper")
    print(f"  Book directory: {book_dir}")
    print("=" * 60)

    # Load data
    if not chapters_file.exists():
        print(f"Error: {chapters_file} not found. Run preprocess.py first.")
        sys.exit(1)
    if not alignment_file.exists():
        print(f"Error: {alignment_file} not found. Run preprocess.py first.")
        sys.exit(1)

    with open(chapters_file) as f:
        chapters = json.load(f)
    with open(alignment_file) as f:
        alignment = json.load(f)

    words = alignment["words"]  # [[word, start, end], ...]
    total_duration = alignment["total_duration"]

    print(f"  Chapters from EPUB: {len(chapters)}")
    print(f"  Transcribed words:  {len(words)}")
    print(f"  Total duration:     {total_duration:.1f}s ({total_duration/3600:.1f}h)")
    print()

    # Filter to meaningful chapters (skip very short ones like copyright pages)
    filtered = []
    for ch in chapters:
        text_len = len(ch.get("text", ""))
        if text_len >= MIN_CHAPTER_TEXT_LEN:
            filtered.append(ch)
        else:
            print(f"  Skipping '{ch['title']}' (too short: {text_len} chars)")

    print(f"\n  Chapters to map: {len(filtered)}")
    print()

    # Match each chapter to the word stream
    mapped_chapters = []
    search_from = 0

    for i, ch in enumerate(filtered):
        chapter_words = extract_words(ch["text"])
        if len(chapter_words) < 3:
            print(f"  [{i+1}/{len(filtered)}] '{ch['title']}' — too few words, skipping")
            continue

        # Search with a generous window ahead (but not backwards)
        # Allow searching up to 30% of remaining words
        remaining = len(words) - search_from
        search_limit = max(remaining, 50000)

        word_idx, score = find_chapter_start(chapter_words, words, search_from, search_limit)

        if word_idx >= 0 and score >= MIN_MATCH_RATIO:
            start_time = words[word_idx][1]
            mapped_chapters.append({
                "title": ch["title"],
                "start_time": round(start_time, 3),
                "start_word_index": word_idx,
            })
            print(
                f"  [{i+1}/{len(filtered)}] '{ch['title']}' "
                f"-> word {word_idx}, time {start_time:.1f}s "
                f"({start_time/3600:.2f}h), score {score:.2f}"
            )
            # Next chapter must start after this one
            search_from = word_idx + 1
        else:
            print(
                f"  [{i+1}/{len(filtered)}] '{ch['title']}' "
                f"-> NO MATCH (best score: {score:.2f})"
            )

    print(f"\n  Successfully mapped: {len(mapped_chapters)} / {len(filtered)} chapters")

    if not mapped_chapters:
        print("\nError: No chapters could be mapped. Check that chapters.json matches the audio.")
        sys.exit(1)

    # Add end_time for each chapter (= start of next chapter, or total_duration)
    for i, ch in enumerate(mapped_chapters):
        if i + 1 < len(mapped_chapters):
            ch["end_time"] = mapped_chapters[i + 1]["start_time"]
            ch["end_word_index"] = mapped_chapters[i + 1]["start_word_index"]
        else:
            ch["end_time"] = round(total_duration, 3)
            ch["end_word_index"] = len(words)

    # Write back into alignment_compact.json
    alignment["chapters"] = mapped_chapters

    with open(alignment_file, "w") as f:
        json.dump(alignment, f)

    print(f"\n  Updated {alignment_file} with chapter data")
    print(f"  File size: {alignment_file.stat().st_size / 1024 / 1024:.1f} MB")

    # Also update meta.json if it exists
    meta_file = book_dir / "meta.json"
    if meta_file.exists():
        with open(meta_file) as f:
            meta = json.load(f)
        meta["has_chapters"] = True
        meta["chapter_count"] = len(mapped_chapters)
        with open(meta_file, "w") as f:
            json.dump(meta, f, indent=2)
        print(f"  Updated {meta_file}")

    # Print summary
    print("\n  Chapter summary:")
    print(f"  {'#':<4} {'Title':<35} {'Start':>10} {'Duration':>10}")
    print("  " + "-" * 63)
    for i, ch in enumerate(mapped_chapters):
        duration = ch["end_time"] - ch["start_time"]
        start_fmt = f"{ch['start_time']/3600:.2f}h"
        dur_fmt = f"{duration/60:.1f}m"
        print(f"  {i+1:<4} {ch['title']:<35} {start_fmt:>10} {dur_fmt:>10}")

    print("\n" + "=" * 60)
    print("Done! Chapter data is now embedded in alignment_compact.json")
    print("=" * 60)


if __name__ == "__main__":
    main()
