(() => {
  "use strict";

  // ══════════════════════════════════════════════════════════════════════════
  // State
  // ══════════════════════════════════════════════════════════════════════════

  let words = [];           // Array of [word, start, end]
  let currentIndex = 0;
  let currentWord = "";
  let isPlaying = false;
  let audioReady = false;

  // Audio state
  let audioParts = [];      // Array of { audio: HTMLAudioElement, offset, duration }
  let activePartIndex = 0;
  let totalDuration = 0;

  // Chapter state
  let chapters = [];        // Array of { title, start_time, end_time, start_word_index, end_word_index }
  let currentChapterIndex = -1;

  // Current book
  let currentBookSlug = null;

  // Bookmarks
  let bookmarks = [];  // Array of { id, position, label, word, chapter, createdAt }

  // Settings
  let playbackSpeed = 1.0;
  let volume = 1.0;
  let fontScale = 1.0;
  let showContext = false;

  // Colors
  let colors = {
    bg: "#0a0a0f",
    fg: "#e8e8ed",
    red: "#ff3b3b",
  };

  // Timing
  let syncRAF = null;
  let fontSizePx = 64;

  // ══════════════════════════════════════════════════════════════════════════
  // DOM
  // ══════════════════════════════════════════════════════════════════════════

  // Views
  const libraryView = document.getElementById("libraryView");
  const readerView = document.getElementById("readerView");
  const libraryGrid = document.getElementById("libraryGrid");
  const libraryEmpty = document.getElementById("libraryEmpty");
  const libraryLoading = document.getElementById("libraryLoading");
  const libraryBtn = document.getElementById("libraryBtn");

  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");

  const playBtn = document.getElementById("playBtn");
  const playIcon = document.getElementById("playIcon");
  const pauseIcon = document.getElementById("pauseIcon");
  const resetBtn = document.getElementById("resetBtn");
  const back10Btn = document.getElementById("back10Btn");
  const fwd10Btn = document.getElementById("fwd10Btn");
  const settingsBtn = document.getElementById("settingsBtn");

  const speedRange = document.getElementById("speedRange");
  const speedLabel = document.getElementById("speedLabel");
  const speedDown = document.getElementById("speedDown");
  const speedUp = document.getElementById("speedUp");
  const volumeRange = document.getElementById("volumeRange");
  const volumeLabel = document.getElementById("volumeLabel");

  const progressBar = document.getElementById("progressBar");
  const progressFill = document.getElementById("progressFill");
  const currentTimeEl = document.getElementById("currentTime");
  const timeLeftEl = document.getElementById("timeLeft");
  const bookTitleEl = document.getElementById("bookTitle");
  const wordCounterEl = document.getElementById("wordCounter");
  const statusMsgEl = document.getElementById("statusMsg");

  const settingsBackdrop = document.getElementById("settingsBackdrop");
  const closeSettingsBtn = document.getElementById("closeSettings");
  const bgColor = document.getElementById("bgColor");
  const fgColor = document.getElementById("fgColor");
  const focusColor = document.getElementById("focusColor");
  const bgHex = document.getElementById("bgHex");
  const fgHex = document.getElementById("fgHex");
  const focusHex = document.getElementById("focusHex");
  const fontScaleRange = document.getElementById("fontScaleRange");
  const fontScaleLabel = document.getElementById("fontScaleLabel");
  const contextToggle = document.getElementById("contextToggle");
  const themeResetBtn = document.getElementById("themeResetBtn");
  const themeApplyBtn = document.getElementById("themeApplyBtn");

  const loadingOverlay = document.getElementById("loadingOverlay");
  const loadingText = document.getElementById("loadingText");

  // Chapter DOM
  const chaptersBtn = document.getElementById("chaptersBtn");
  const chaptersBackdrop = document.getElementById("chaptersBackdrop");
  const closeChaptersBtn = document.getElementById("closeChapters");
  const chapterList = document.getElementById("chapterList");
  const chapterNameEl = document.getElementById("chapterName");
  const prevChapterBtn = document.getElementById("prevChapterBtn");
  const nextChapterBtn = document.getElementById("nextChapterBtn");
  const chapterMarkers = document.getElementById("chapterMarkers");

  // Bookmark DOM
  const bookmarkBtn = document.getElementById("bookmarkBtn");
  const bookmarksListBtn = document.getElementById("bookmarksListBtn");
  const bookmarksBackdrop = document.getElementById("bookmarksBackdrop");
  const closeBookmarksBtn = document.getElementById("closeBookmarks");
  const bookmarkList = document.getElementById("bookmarkList");
  const bookmarkEmpty = document.getElementById("bookmarkEmpty");
  const bookmarkMarkers = document.getElementById("bookmarkMarkers");
  const bookmarkNameBackdrop = document.getElementById("bookmarkNameBackdrop");
  const closeBookmarkNameBtn = document.getElementById("closeBookmarkName");
  const bookmarkNameInput = document.getElementById("bookmarkNameInput");
  const bookmarkNamePreview = document.getElementById("bookmarkNamePreview");
  const bookmarkNameCancel = document.getElementById("bookmarkNameCancel");
  const bookmarkNameSave = document.getElementById("bookmarkNameSave");

  // ══════════════════════════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════════════════════════

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const s = Math.floor(seconds) % 60;
    const m = Math.floor(seconds / 60) % 60;
    const h = Math.floor(seconds / 3600);
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function clampHex(v) {
    const s = String(v || "").trim();
    const m = s.match(/^#?([0-9a-fA-F]{6})$/);
    return m ? "#" + m[1].toLowerCase() : null;
  }

  function setCssVar(name, value) {
    document.documentElement.style.setProperty(name, value);
  }

  function hexToRgb(hex) {
    const h = clampHex(hex);
    if (!h) return null;
    const n = parseInt(h.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function middleIndex(s) {
    // ORP (Optimal Recognition Point) - slightly left of center
    const len = s.length;
    if (len <= 1) return 0;
    if (len <= 3) return 0;
    if (len <= 5) return 1;
    if (len <= 9) return 2;
    if (len <= 13) return 3;
    return Math.floor(len * 0.3);
  }

  function setStatus(msg) {
    statusMsgEl.textContent = msg || "";
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Chapter Navigation
  // ══════════════════════════════════════════════════════════════════════════

  function findChapterAtTime(time) {
    if (!chapters.length) return -1;
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (time >= chapters[i].start_time) return i;
    }
    return 0;
  }

  function updateCurrentChapter(time) {
    if (!chapters.length) return;
    const idx = findChapterAtTime(time);
    if (idx !== currentChapterIndex) {
      currentChapterIndex = idx;
      const ch = chapters[idx];
      if (ch && chapterNameEl) {
        chapterNameEl.textContent = ch.title;
        chapterNameEl.title = ch.title;
      }
      updateChapterListHighlight();
    }
  }

  function seekToChapter(index) {
    if (index < 0 || index >= chapters.length) return;
    seekToGlobalTime(chapters[index].start_time);
    updateCurrentChapter(chapters[index].start_time);
  }

  function prevChapter() {
    if (!chapters.length) return;
    // If we're more than 3 seconds into the current chapter, go to its start
    const time = getCurrentAudioTime();
    const ch = chapters[currentChapterIndex];
    if (ch && time - ch.start_time > 3) {
      seekToChapter(currentChapterIndex);
    } else {
      seekToChapter(Math.max(0, currentChapterIndex - 1));
    }
  }

  function nextChapter() {
    if (!chapters.length) return;
    seekToChapter(Math.min(chapters.length - 1, currentChapterIndex + 1));
  }

  function buildChapterList() {
    if (!chapterList || !chapters.length) return;
    chapterList.innerHTML = "";

    chapters.forEach((ch, i) => {
      const li = document.createElement("li");
      li.className = "chapter-item";
      li.dataset.index = i;

      const duration = ch.end_time - ch.start_time;

      li.innerHTML = `
        <span class="chapter-number">${i + 1}</span>
        <span class="chapter-title">${ch.title}</span>
        <span class="chapter-time">${formatTime(ch.start_time)}</span>
      `;

      li.addEventListener("click", () => {
        seekToChapter(i);
        chaptersBackdrop.style.display = "none";
      });

      chapterList.appendChild(li);
    });
  }

  function updateChapterListHighlight() {
    if (!chapterList) return;
    const items = chapterList.querySelectorAll(".chapter-item");
    items.forEach((item, i) => {
      item.classList.toggle("active", i === currentChapterIndex);
    });
  }

  function buildChapterMarkers() {
    if (!chapterMarkers || !chapters.length || totalDuration <= 0) return;
    chapterMarkers.innerHTML = "";

    chapters.forEach((ch, i) => {
      if (i === 0) return; // Skip first marker (at the very start)
      const pct = (ch.start_time / totalDuration) * 100;
      const marker = document.createElement("div");
      marker.className = "chapter-marker";
      marker.style.left = `${pct}%`;
      marker.title = ch.title;
      chapterMarkers.appendChild(marker);
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Bookmarks
  // ══════════════════════════════════════════════════════════════════════════

  function loadBookmarks(slug) {
    try {
      const all = JSON.parse(localStorage.getItem("sar.bookmarks") || "{}");
      bookmarks = Array.isArray(all[slug]) ? all[slug] : [];
    } catch { bookmarks = []; }
  }

  function saveBookmarks() {
    if (!currentBookSlug) return;
    try {
      const all = JSON.parse(localStorage.getItem("sar.bookmarks") || "{}");
      all[currentBookSlug] = bookmarks;
      localStorage.setItem("sar.bookmarks", JSON.stringify(all));
    } catch {}
  }

  function getBookmarkCount(slug) {
    try {
      const all = JSON.parse(localStorage.getItem("sar.bookmarks") || "{}");
      return Array.isArray(all[slug]) ? all[slug].length : 0;
    } catch { return 0; }
  }

  function addBookmark(position, label) {
    const wordAtPos = words[findWordAtTime(position)];
    const wordText = wordAtPos ? wordAtPos[0] : "";
    const ch = chapters.length ? chapters[findChapterAtTime(position)] : null;
    const chapterTitle = ch ? ch.title : "";

    // Gather a few surrounding words for context
    const idx = findWordAtTime(position);
    const contextWords = [];
    for (let i = Math.max(0, idx - 2); i < Math.min(words.length, idx + 5); i++) {
      contextWords.push(words[i][0]);
    }

    const bookmark = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      position,
      label: label || "",
      word: wordText,
      context: contextWords.join(" "),
      chapter: chapterTitle,
      createdAt: Date.now(),
    };

    bookmarks.push(bookmark);
    bookmarks.sort((a, b) => a.position - b.position);
    saveBookmarks();
    buildBookmarkMarkers();
    return bookmark;
  }

  function deleteBookmark(id) {
    bookmarks = bookmarks.filter(b => b.id !== id);
    saveBookmarks();
    buildBookmarkMarkers();
    buildBookmarkList();
  }

  function renameBookmark(id, newLabel) {
    const bm = bookmarks.find(b => b.id === id);
    if (bm) {
      bm.label = newLabel;
      saveBookmarks();
      buildBookmarkList();
    }
  }

  function buildBookmarkMarkers() {
    if (!bookmarkMarkers || totalDuration <= 0) return;
    bookmarkMarkers.innerHTML = "";

    bookmarks.forEach(bm => {
      const pct = (bm.position / totalDuration) * 100;
      const marker = document.createElement("div");
      marker.className = "bookmark-marker";
      marker.style.left = `${pct}%`;
      marker.title = bm.label || `Bookmark at ${formatTime(bm.position)}`;
      bookmarkMarkers.appendChild(marker);
    });
  }

  function buildBookmarkList() {
    if (!bookmarkList) return;
    bookmarkList.innerHTML = "";

    if (bookmarks.length === 0) {
      bookmarkEmpty.style.display = "";
      return;
    }

    bookmarkEmpty.style.display = "none";

    bookmarks.forEach(bm => {
      const li = document.createElement("li");
      li.className = "bookmark-item";
      li.dataset.id = bm.id;

      const displayLabel = bm.label || `Bookmark`;
      const detail = bm.chapter
        ? `${bm.chapter} — "...${bm.context || bm.word}..."`
        : `"...${bm.context || bm.word}..."`;

      li.innerHTML = `
        <span class="bookmark-item-icon">🔖</span>
        <div class="bookmark-item-info">
          <span class="bookmark-item-label">${displayLabel}</span>
          <span class="bookmark-item-detail">${detail}</span>
        </div>
        <span class="bookmark-item-time">${formatTime(bm.position)}</span>
        <div class="bookmark-item-actions">
          <button class="bookmark-action-btn" data-action="rename" title="Rename">✏️</button>
          <button class="bookmark-action-btn" data-action="delete" title="Delete">🗑️</button>
        </div>
      `;

      // Click on item body to seek
      li.addEventListener("click", (e) => {
        // Don't seek if clicking an action button
        if (e.target.closest(".bookmark-action-btn")) return;
        seekToGlobalTime(bm.position);
        bookmarksBackdrop.style.display = "none";
      });

      // Action buttons
      li.querySelector('[data-action="delete"]').addEventListener("click", (e) => {
        e.stopPropagation();
        deleteBookmark(bm.id);
      });

      li.querySelector('[data-action="rename"]').addEventListener("click", (e) => {
        e.stopPropagation();
        promptRenameBookmark(bm);
      });

      bookmarkList.appendChild(li);
    });
  }

  // Pending bookmark data for the name input modal
  let pendingBookmarkPosition = null;
  let pendingBookmarkRenameId = null;

  function promptAddBookmark() {
    if (!audioReady) return;
    const pos = getCurrentAudioTime();
    pendingBookmarkPosition = pos;
    pendingBookmarkRenameId = null;

    const ch = chapters.length ? chapters[findChapterAtTime(pos)] : null;
    const chName = ch ? ch.title : "";
    const idx = findWordAtTime(pos);
    const contextWords = [];
    for (let i = Math.max(0, idx - 2); i < Math.min(words.length, idx + 5); i++) {
      contextWords.push(words[i][0]);
    }
    bookmarkNamePreview.textContent = `${formatTime(pos)}${chName ? " · " + chName : ""} — "${contextWords.join(" ")}"`;
    bookmarkNameInput.value = "";
    bookmarkNameBackdrop.style.display = "flex";
    setTimeout(() => bookmarkNameInput.focus(), 50);
  }

  function promptRenameBookmark(bm) {
    pendingBookmarkPosition = null;
    pendingBookmarkRenameId = bm.id;
    bookmarkNamePreview.textContent = `${formatTime(bm.position)}${bm.chapter ? " · " + bm.chapter : ""}`;
    bookmarkNameInput.value = bm.label || "";
    bookmarkNameBackdrop.style.display = "flex";
    setTimeout(() => { bookmarkNameInput.focus(); bookmarkNameInput.select(); }, 50);
  }

  function confirmBookmarkName() {
    const label = bookmarkNameInput.value.trim();
    bookmarkNameBackdrop.style.display = "none";

    if (pendingBookmarkRenameId) {
      renameBookmark(pendingBookmarkRenameId, label);
      pendingBookmarkRenameId = null;
    } else if (pendingBookmarkPosition !== null) {
      addBookmark(pendingBookmarkPosition, label);
      pendingBookmarkPosition = null;

      // Flash the bookmark button
      if (bookmarkBtn) {
        bookmarkBtn.classList.remove("flash");
        void bookmarkBtn.offsetWidth; // Trigger reflow
        bookmarkBtn.classList.add("flash");
        setTimeout(() => bookmarkBtn.classList.remove("flash"), 600);
      }

      setStatus(`Bookmark added at ${formatTime(getCurrentAudioTime())}`);
    }
  }

  function openBookmarksList() {
    buildBookmarkList();
    bookmarksBackdrop.style.display = "flex";
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Audio Management
  // ══════════════════════════════════════════════════════════════════════════

  function getCurrentAudioTime() {
    if (!audioParts.length) return 0;
    const part = audioParts[activePartIndex];
    if (!part || !part.audio) return 0;
    return part.offset + part.audio.currentTime;
  }

  function getPartForTime(globalTime) {
    for (let i = audioParts.length - 1; i >= 0; i--) {
      if (globalTime >= audioParts[i].offset) return i;
    }
    return 0;
  }

  function seekToGlobalTime(globalTime) {
    globalTime = Math.max(0, Math.min(totalDuration - 0.1, globalTime));
    const partIdx = getPartForTime(globalTime);

    if (partIdx !== activePartIndex) {
      const wasPlaying = isPlaying;
      audioParts[activePartIndex].audio.pause();
      activePartIndex = partIdx;
      const localTime = globalTime - audioParts[partIdx].offset;
      audioParts[partIdx].audio.currentTime = Math.max(0, localTime);
      audioParts[partIdx].audio.playbackRate = playbackSpeed;
      audioParts[partIdx].audio.volume = volume;
      if (wasPlaying) {
        audioParts[partIdx].audio.play().catch(() => {});
      }
    } else {
      const localTime = globalTime - audioParts[partIdx].offset;
      audioParts[partIdx].audio.currentTime = Math.max(0, localTime);
    }

    // Immediately update the word display
    const idx = findWordAtTime(globalTime);
    if (idx !== currentIndex || !currentWord) {
      currentIndex = idx;
      currentWord = words[idx] ? words[idx][0] : "";
      draw();
    }
    updateProgressUI(globalTime);
  }

  function togglePlayPause() {
    if (!audioReady) return;
    if (isPlaying) pause();
    else play();
  }

  function play() {
    if (!audioReady) return;
    isPlaying = true;
    updatePlayPauseVisual();
    const part = audioParts[activePartIndex];
    part.audio.playbackRate = playbackSpeed;
    part.audio.volume = volume;
    part.audio.play().catch(() => {});
    startSyncLoop();
    setStatus("");
  }

  function pause() {
    isPlaying = false;
    updatePlayPauseVisual();
    audioParts[activePartIndex].audio.pause();
    stopSyncLoop();
    setStatus("Paused — Space to resume");
  }

  function updatePlayPauseVisual() {
    playIcon.hidden = isPlaying;
    pauseIcon.hidden = !isPlaying;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Sync Loop - matches audio time to word display
  // ══════════════════════════════════════════════════════════════════════════

  function findWordAtTime(time) {
    // Binary search for the word at the given time
    if (!words.length) return 0;
    let lo = 0, hi = words.length - 1;
    let best = 0;

    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const wordStart = words[mid][1];

      if (wordStart <= time) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return best;
  }

  function syncTick() {
    if (!isPlaying) return;

    const time = getCurrentAudioTime();

    // Check if current part ended and we need to switch to next
    const currentPart = audioParts[activePartIndex];
    if (currentPart && currentPart.audio.ended) {
      if (activePartIndex < audioParts.length - 1) {
        activePartIndex++;
        const nextPart = audioParts[activePartIndex];
        nextPart.audio.currentTime = 0;
        nextPart.audio.playbackRate = playbackSpeed;
        nextPart.audio.volume = volume;
        nextPart.audio.play().catch(() => {});
      } else {
        // End of all audio
        pause();
        setStatus("Finished — press R to restart");
        return;
      }
    }

    // Find and display the current word
    const idx = findWordAtTime(time);
    if (idx !== currentIndex) {
      currentIndex = idx;
      currentWord = words[idx] ? words[idx][0] : "";
      draw();
    }

    updateProgressUI(time);

    syncRAF = requestAnimationFrame(syncTick);
  }

  function startSyncLoop() {
    stopSyncLoop();
    syncRAF = requestAnimationFrame(syncTick);
  }

  function stopSyncLoop() {
    if (syncRAF) {
      cancelAnimationFrame(syncRAF);
      syncRAF = null;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Progress UI
  // ══════════════════════════════════════════════════════════════════════════

  function updateProgressUI(time) {
    if (time === undefined) time = getCurrentAudioTime();

    const pct = totalDuration > 0 ? (time / totalDuration) * 100 : 0;
    progressFill.style.width = `${Math.min(100, pct)}%`;

    currentTimeEl.textContent = formatTime(time);
    timeLeftEl.textContent = `-${formatTime(Math.max(0, totalDuration - time))}`;
    wordCounterEl.textContent = `Word ${currentIndex + 1} / ${words.length.toLocaleString()}`;

    updateCurrentChapter(time);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Drawing
  // ══════════════════════════════════════════════════════════════════════════

  const fontFamily = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
  const fontWeight = 600;

  function computeFontSize() {
    const base = Math.min(innerWidth, innerHeight) * 0.14;
    const scaled = base * fontScale;
    fontSizePx = Math.max(28, Math.min(160, Math.floor(scaled)));
  }

  function fitFontSizeForWord(word, baseSize, maxWidth) {
    ctx.font = `${fontWeight} ${baseSize}px ${fontFamily}`;
    const w = ctx.measureText(word).width;
    if (w <= maxWidth) return baseSize;
    return Math.max(16, Math.floor(baseSize * (maxWidth / w)));
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeFontSize();
    draw();
  }

  function draw() {
    const { bg, fg, red } = colors;

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    if (!currentWord) return;

    const maxWidth = innerWidth * 0.88;
    const size = fitFontSizeForWord(currentWord, fontSizePx, maxWidth);

    ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
    ctx.textBaseline = "middle";

    const mid = middleIndex(currentWord);
    const chars = [...currentWord];
    const widths = chars.map(c => ctx.measureText(c).width);
    const before = widths.slice(0, mid).reduce((a, b) => a + b, 0);

    let x = innerWidth / 2 - (before + widths[mid] / 2);
    const y = innerHeight / 2;

    // Draw the focus guide line (subtle vertical marker)
    ctx.save();
    ctx.strokeStyle = red;
    ctx.globalAlpha = 0.12;
    ctx.lineWidth = 2;
    const guideX = innerWidth / 2;
    ctx.beginPath();
    ctx.moveTo(guideX, y - size * 0.75);
    ctx.lineTo(guideX, y - size * 0.55);
    ctx.moveTo(guideX, y + size * 0.55);
    ctx.lineTo(guideX, y + size * 0.75);
    ctx.stroke();
    ctx.restore();

    // Draw characters
    chars.forEach((c, i) => {
      if (i === mid) {
        // Focus letter with subtle glow
        ctx.save();
        ctx.shadowColor = red;
        ctx.shadowBlur = size * 0.2;
        ctx.fillStyle = red;
        ctx.fillText(c, x, y);
        ctx.restore();
        // Draw again without shadow for crisp text
        ctx.fillStyle = red;
        ctx.fillText(c, x, y);
      } else {
        ctx.fillStyle = fg;
        ctx.fillText(c, x, y);
      }
      x += widths[i];
    });

    // Context words
    if (showContext) {
      drawContext(y, size);
    }
  }

  function drawContext(centerY, mainSize) {
    const contextSize = Math.floor(mainSize * 0.22);
    ctx.font = `400 ${contextSize}px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.fillStyle = colors.fg;
    ctx.globalAlpha = 0.18;

    // Previous words
    const prevWords = [];
    for (let i = Math.max(0, currentIndex - 6); i < currentIndex; i++) {
      prevWords.push(words[i][0]);
    }
    if (prevWords.length) {
      ctx.fillText(prevWords.join("  "), innerWidth / 2, centerY - mainSize * 0.85);
    }

    // Next words
    const nextWords = [];
    for (let i = currentIndex + 1; i < Math.min(words.length, currentIndex + 7); i++) {
      nextWords.push(words[i][0]);
    }
    if (nextWords.length) {
      ctx.fillText(nextWords.join("  "), innerWidth / 2, centerY + mainSize * 0.85);
    }

    ctx.globalAlpha = 1.0;
    ctx.textAlign = "start";
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Colors
  // ══════════════════════════════════════════════════════════════════════════

  function applyColors(c) {
    colors = { ...c };
    setCssVar("--bg", c.bg);
    setCssVar("--fg", c.fg);
    setCssVar("--red", c.red);

    const fgRgb = hexToRgb(c.fg);
    const bgRgb = hexToRgb(c.bg);

    if (fgRgb) {
      setCssVar("--accent", `rgba(${fgRgb.r},${fgRgb.g},${fgRgb.b},0.85)`);
      setCssVar("--track", `rgba(${fgRgb.r},${fgRgb.g},${fgRgb.b},0.15)`);
      setCssVar("--border", `rgba(${fgRgb.r},${fgRgb.g},${fgRgb.b},0.12)`);
    }
    if (bgRgb) {
      setCssVar("--panel", `rgba(${bgRgb.r},${bgRgb.g},${bgRgb.b},0.75)`);
    }

    draw();
    saveSettings();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Settings persistence (global settings + per-book positions)
  // ══════════════════════════════════════════════════════════════════════════

  function saveSettings() {
    try {
      // Save global settings (colors, font, speed, volume)
      localStorage.setItem("sar.settings", JSON.stringify({
        colors,
        fontScale,
        playbackSpeed,
        volume,
        showContext,
      }));

      // Save per-book position
      if (currentBookSlug && audioReady) {
        const positions = JSON.parse(localStorage.getItem("sar.positions") || "{}");
        positions[currentBookSlug] = {
          position: getCurrentAudioTime(),
          timestamp: Date.now(),
        };
        localStorage.setItem("sar.positions", JSON.stringify(positions));
      }
    } catch {}
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem("sar.settings");
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.colors) colors = s.colors;
      if (s.fontScale) fontScale = s.fontScale;
      if (s.playbackSpeed) playbackSpeed = s.playbackSpeed;
      if (s.volume !== undefined) volume = s.volume;
      if (s.showContext !== undefined) showContext = s.showContext;
    } catch {}
  }

  function getLastPosition(slug) {
    try {
      const positions = JSON.parse(localStorage.getItem("sar.positions") || "{}");
      const entry = positions[slug || currentBookSlug];
      return entry ? entry.position || 0 : 0;
    } catch { return 0; }
  }

  function getBookProgress(slug) {
    // Returns percentage 0-100 of how far through a book the user is
    try {
      const positions = JSON.parse(localStorage.getItem("sar.positions") || "{}");
      const entry = positions[slug];
      if (!entry || !entry.position) return 0;
      return entry.position;
    } catch { return 0; }
  }

  // Save position periodically
  setInterval(() => {
    if (audioReady && isPlaying) saveSettings();
  }, 5000);

  // ══════════════════════════════════════════════════════════════════════════
  // Library
  // ══════════════════════════════════════════════════════════════════════════

  async function loadLibrary() {
    libraryLoading.style.display = "";
    libraryEmpty.style.display = "none";
    libraryGrid.innerHTML = "";

    try {
      const resp = await fetch("/api/books");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const books = await resp.json();

      libraryLoading.style.display = "none";

      if (books.length === 0) {
        libraryEmpty.style.display = "";
        return;
      }

      books.forEach(book => {
        const card = document.createElement("div");
        card.className = "book-card";
        card.dataset.slug = book.slug;

        const durationStr = book.total_duration
          ? formatTime(book.total_duration)
          : "";
        const wordStr = book.word_count
          ? `${book.word_count.toLocaleString()} words`
          : "";

        // Check if user has progress on this book
        const savedPos = getBookProgress(book.slug);
        const progressPct = book.total_duration && savedPos > 0
          ? Math.min(100, (savedPos / book.total_duration) * 100)
          : 0;

        const bmCount = getBookmarkCount(book.slug);

        let metaHtml = "";
        if (durationStr || wordStr) {
          metaHtml = `<div class="book-card-meta">`;
          if (durationStr) metaHtml += `<span>${durationStr}</span>`;
          if (wordStr) metaHtml += `<span>${wordStr}</span>`;
          if (book.has_chapters) metaHtml += `<span>Chapters</span>`;
          if (bmCount > 0) metaHtml += `<span>🔖 ${bmCount}</span>`;
          metaHtml += `</div>`;
        }

        let progressHtml = "";
        if (progressPct > 0) {
          progressHtml = `
            <div class="book-card-progress">
              <div class="book-card-progress-fill" style="width:${progressPct.toFixed(1)}%"></div>
            </div>`;
        }

        card.innerHTML = `
          <div class="book-card-title">${book.title}</div>
          <div class="book-card-author">${book.author}</div>
          ${metaHtml}
          ${progressHtml}
        `;

        card.addEventListener("click", () => openBook(book.slug));
        libraryGrid.appendChild(card);
      });

    } catch (err) {
      console.error("Failed to load library:", err);
      libraryLoading.style.display = "none";
      libraryEmpty.style.display = "";
      libraryEmpty.querySelector("p").textContent = `Error loading library: ${err.message}`;
    }
  }

  function showLibrary() {
    // Stop playback if playing
    if (isPlaying) pause();

    // Save position before leaving
    if (currentBookSlug && audioReady) saveSettings();

    // Clean up audio resources
    cleanupReader();

    // Switch views
    readerView.style.display = "none";
    libraryView.style.display = "";
    document.body.style.overflow = "auto";

    // Refresh library to show updated progress
    loadLibrary();
  }

  function cleanupReader() {
    stopSyncLoop();
    // Stop and release all audio elements
    for (const part of audioParts) {
      part.audio.pause();
      part.audio.src = "";
      part.audio.load();
    }
    audioParts = [];
    words = [];
    chapters = [];
    currentIndex = 0;
    currentWord = "";
    activePartIndex = 0;
    totalDuration = 0;
    currentChapterIndex = -1;
    audioReady = false;
    isPlaying = false;

    // Reset chapter UI
    if (chaptersBtn) chaptersBtn.style.display = "none";
    if (prevChapterBtn) prevChapterBtn.style.display = "none";
    if (nextChapterBtn) nextChapterBtn.style.display = "none";
    if (chapterList) chapterList.innerHTML = "";
    if (chapterMarkers) chapterMarkers.innerHTML = "";
    if (chapterNameEl) chapterNameEl.textContent = "";

    // Reset bookmark state and UI
    bookmarks = [];
    if (bookmarkMarkers) bookmarkMarkers.innerHTML = "";
    if (bookmarkList) bookmarkList.innerHTML = "";

    // Reset progress UI
    progressFill.style.width = "0%";
    currentTimeEl.textContent = "0:00";
    timeLeftEl.textContent = "0:00";
    wordCounterEl.textContent = "";
    updatePlayPauseVisual();
  }

  async function openBook(slug) {
    currentBookSlug = slug;

    // Switch to reader view
    libraryView.style.display = "none";
    readerView.style.display = "";
    document.body.style.overflow = "hidden";

    // Show loading overlay
    loadingOverlay.classList.remove("hidden");
    loadingText.textContent = "Loading alignment data...";

    // Resize canvas for reader
    resize();

    // Load book data
    await loadAlignmentData(slug);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Data Loading
  // ══════════════════════════════════════════════════════════════════════════

  async function loadAlignmentData(slug) {
    loadingText.textContent = "Loading alignment data...";

    try {
      // Load from the book's directory
      const dataUrl = `../books/${slug}/alignment_compact.json`;
      const resp = await fetch(dataUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      bookTitleEl.textContent = `${data.title} — ${data.author}`;
      words = data.words; // [[word, start, end], ...]
      totalDuration = data.total_duration;

      // Load chapters if available
      if (data.chapters && data.chapters.length) {
        chapters = data.chapters;
        buildChapterList();
        buildChapterMarkers();
        if (chaptersBtn) chaptersBtn.style.display = "";
        if (prevChapterBtn) prevChapterBtn.style.display = "";
        if (nextChapterBtn) nextChapterBtn.style.display = "";
      }

      // Load bookmarks for this book
      loadBookmarks(slug);
      buildBookmarkMarkers();

      if (words.length > 0) {
        currentWord = words[0][0];
        currentIndex = 0;
      }

      loadingText.textContent = `Loading audio (${data.parts.length} parts)...`;

      // Load audio parts
      for (let i = 0; i < data.parts.length; i++) {
        const part = data.parts[i];
        loadingText.textContent = `Loading audio part ${i + 1}/${data.parts.length}...`;

        const audio = new Audio();
        audio.preload = "auto";
        // Audio files are relative to project root, we're in /app/
        audio.src = `../${part.file}`;

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => resolve(), 10000); // 10s timeout fallback
          audio.addEventListener("loadedmetadata", () => {
            clearTimeout(timeout);
            resolve();
          }, { once: true });
          audio.addEventListener("canplay", () => {
            clearTimeout(timeout);
            resolve();
          }, { once: true });
          audio.addEventListener("error", (e) => {
            clearTimeout(timeout);
            reject(new Error(`Failed to load audio part ${i + 1}: ${part.file}`));
          }, { once: true });
          audio.load();
        });

        // Set up ended event for part transitions
        audio.addEventListener("ended", () => {
          if (activePartIndex === i && i < audioParts.length - 1) {
            activePartIndex = i + 1;
            const next = audioParts[i + 1];
            next.audio.currentTime = 0;
            next.audio.playbackRate = playbackSpeed;
            next.audio.volume = volume;
            if (isPlaying) {
              next.audio.play().catch(() => {});
            }
          } else if (activePartIndex === i && i === audioParts.length - 1) {
            pause();
            setStatus("Finished — press R to restart");
          }
        });

        audioParts.push({
          audio,
          offset: part.offset,
          duration: part.duration,
        });
      }

      audioReady = true;
      loadingOverlay.classList.add("hidden");

      // Restore last position for this book
      const lastPos = getLastPosition(slug);
      if (lastPos > 5) {
        seekToGlobalTime(lastPos);
        setStatus(`Resumed at ${formatTime(lastPos)} — Space to play`);
      } else {
        setStatus("Ready — press Space to play");
      }

      updateProgressUI();
      draw();

    } catch (err) {
      console.error("Failed to load data:", err);
      loadingText.textContent = `Error: ${err.message}.\nRun preprocess.py first to generate alignment data.`;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Progress Bar Interaction
  // ══════════════════════════════════════════════════════════════════════════

  function pctFromClientX(clientX) {
    const rect = progressBar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
  }

  function scrubToPct(pct) {
    const time = pct * totalDuration;
    seekToGlobalTime(time);
  }

  {
    let isScrubbing = false;

    const onMove = (e) => {
      if (!isScrubbing) return;
      scrubToPct(pctFromClientX(e.clientX));
    };

    const endScrub = () => {
      if (!isScrubbing) return;
      isScrubbing = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endScrub);
    };

    progressBar.addEventListener("pointerdown", (e) => {
      if (!audioReady) return;
      isScrubbing = true;
      progressBar.setPointerCapture?.(e.pointerId);
      scrubToPct(pctFromClientX(e.clientX));
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", endScrub);
    });

    // Keyboard on progress bar
    progressBar.addEventListener("keydown", (e) => {
      if (!audioReady) return;
      const step = totalDuration * 0.01; // 1% step
      if (e.key === "ArrowLeft") { e.preventDefault(); seekToGlobalTime(getCurrentAudioTime() - step); }
      if (e.key === "ArrowRight") { e.preventDefault(); seekToGlobalTime(getCurrentAudioTime() + step); }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // UI Wiring
  // ══════════════════════════════════════════════════════════════════════════

  playBtn.onclick = togglePlayPause;

  resetBtn.onclick = () => {
    seekToGlobalTime(0);
  };

  back10Btn.onclick = () => {
    seekToGlobalTime(getCurrentAudioTime() - 10);
  };

  fwd10Btn.onclick = () => {
    seekToGlobalTime(getCurrentAudioTime() + 10);
  };

  // Speed controls
  function applySpeed(v) {
    playbackSpeed = Math.max(0.25, Math.min(3.0, Math.round(v * 20) / 20));
    speedRange.value = playbackSpeed;
    speedLabel.textContent = `${playbackSpeed.toFixed(2)}×`;

    for (const p of audioParts) {
      p.audio.playbackRate = playbackSpeed;
    }

    saveSettings();
  }

  speedRange.oninput = () => applySpeed(+speedRange.value);
  speedDown.onclick = () => applySpeed(playbackSpeed - 0.05);
  speedUp.onclick = () => applySpeed(playbackSpeed + 0.05);

  // Volume
  function applyVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    volumeRange.value = volume;
    volumeLabel.textContent = `${Math.round(volume * 100)}%`;

    for (const p of audioParts) {
      p.audio.volume = volume;
    }

    saveSettings();
  }

  volumeRange.oninput = () => applyVolume(+volumeRange.value);

  // Settings modal
  settingsBtn.onclick = () => {
    bgColor.value = clampHex(colors.bg) || "#0a0a0f";
    fgColor.value = clampHex(colors.fg) || "#e8e8ed";
    focusColor.value = clampHex(colors.red) || "#ff3b3b";
    bgHex.value = bgColor.value;
    fgHex.value = fgColor.value;
    focusHex.value = focusColor.value;
    fontScaleRange.value = fontScale;
    fontScaleLabel.textContent = fontScale.toFixed(2);
    contextToggle.textContent = showContext ? "On" : "Off";
    settingsBackdrop.style.display = "flex";
  };

  closeSettingsBtn.onclick = () => settingsBackdrop.style.display = "none";
  settingsBackdrop.addEventListener("click", (e) => {
    if (e.target === settingsBackdrop) settingsBackdrop.style.display = "none";
  });

  // Sync hex <-> color inputs
  function syncColorInputs() {
    bgHex.value = bgColor.value;
    fgHex.value = fgColor.value;
    focusHex.value = focusColor.value;
  }

  bgColor.oninput = syncColorInputs;
  fgColor.oninput = syncColorInputs;
  focusColor.oninput = syncColorInputs;

  bgHex.addEventListener("input", () => {
    const v = clampHex(bgHex.value);
    if (v) bgColor.value = v;
  });
  fgHex.addEventListener("input", () => {
    const v = clampHex(fgHex.value);
    if (v) fgColor.value = v;
  });
  focusHex.addEventListener("input", () => {
    const v = clampHex(focusHex.value);
    if (v) focusColor.value = v;
  });

  fontScaleRange.oninput = () => {
    fontScaleLabel.textContent = (+fontScaleRange.value).toFixed(2);
  };

  contextToggle.onclick = () => {
    const on = contextToggle.textContent === "On";
    contextToggle.textContent = on ? "Off" : "On";
  };

  themeApplyBtn.onclick = () => {
    fontScale = Math.max(0.25, Math.min(3.0, +fontScaleRange.value));
    showContext = contextToggle.textContent === "On";
    computeFontSize();

    applyColors({
      bg: bgColor.value,
      fg: fgColor.value,
      red: focusColor.value,
    });

    settingsBackdrop.style.display = "none";
  };

  themeResetBtn.onclick = () => {
    const c = { bg: "#0a0a0f", fg: "#e8e8ed", red: "#ff3b3b" };
    fontScale = 1.0;
    showContext = false;
    fontScaleRange.value = 1.0;
    fontScaleLabel.textContent = "1.00";
    contextToggle.textContent = "Off";
    bgColor.value = c.bg; fgColor.value = c.fg; focusColor.value = c.red;
    bgHex.value = c.bg; fgHex.value = c.fg; focusHex.value = c.red;
    computeFontSize();
    applyColors(c);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // Chapter UI Wiring
  // ══════════════════════════════════════════════════════════════════════════

  if (chaptersBtn) {
    chaptersBtn.onclick = () => {
      chaptersBackdrop.style.display = "flex";
      updateChapterListHighlight();
      // Scroll active chapter into view
      requestAnimationFrame(() => {
        const active = chapterList.querySelector(".chapter-item.active");
        if (active) active.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    };
  }

  if (closeChaptersBtn) {
    closeChaptersBtn.onclick = () => chaptersBackdrop.style.display = "none";
  }

  if (chaptersBackdrop) {
    chaptersBackdrop.addEventListener("click", (e) => {
      if (e.target === chaptersBackdrop) chaptersBackdrop.style.display = "none";
    });
  }

  if (prevChapterBtn) prevChapterBtn.onclick = prevChapter;
  if (nextChapterBtn) nextChapterBtn.onclick = nextChapter;

  // ══════════════════════════════════════════════════════════════════════════
  // Bookmark UI Wiring
  // ══════════════════════════════════════════════════════════════════════════

  if (bookmarkBtn) {
    bookmarkBtn.onclick = promptAddBookmark;
  }

  if (bookmarksListBtn) {
    bookmarksListBtn.onclick = openBookmarksList;
  }

  if (closeBookmarksBtn) {
    closeBookmarksBtn.onclick = () => bookmarksBackdrop.style.display = "none";
  }

  if (bookmarksBackdrop) {
    bookmarksBackdrop.addEventListener("click", (e) => {
      if (e.target === bookmarksBackdrop) bookmarksBackdrop.style.display = "none";
    });
  }

  if (closeBookmarkNameBtn) {
    closeBookmarkNameBtn.onclick = () => bookmarkNameBackdrop.style.display = "none";
  }

  if (bookmarkNameCancel) {
    bookmarkNameCancel.onclick = () => bookmarkNameBackdrop.style.display = "none";
  }

  if (bookmarkNameSave) {
    bookmarkNameSave.onclick = confirmBookmarkName;
  }

  if (bookmarkNameInput) {
    bookmarkNameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmBookmarkName();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        bookmarkNameBackdrop.style.display = "none";
      }
    });
  }

  if (bookmarkNameBackdrop) {
    bookmarkNameBackdrop.addEventListener("click", (e) => {
      if (e.target === bookmarkNameBackdrop) bookmarkNameBackdrop.style.display = "none";
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Library Button
  // ══════════════════════════════════════════════════════════════════════════

  if (libraryBtn) {
    libraryBtn.onclick = showLibrary;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Keyboard Shortcuts
  // ══════════════════════════════════════════════════════════════════════════

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

    // Escape always goes back to library (from reader view)
    if (e.code === "Escape") {
      if (readerView.style.display !== "none") {
        e.preventDefault();
        showLibrary();
        return;
      }
    }

    // Reader-only shortcuts
    if (readerView.style.display === "none") return;

    switch (e.code) {
      case "Space":
        e.preventDefault();
        togglePlayPause();
        break;
      case "ArrowLeft":
        e.preventDefault();
        seekToGlobalTime(getCurrentAudioTime() - 5);
        break;
      case "ArrowRight":
        e.preventDefault();
        seekToGlobalTime(getCurrentAudioTime() + 5);
        break;
      case "ArrowUp":
        e.preventDefault();
        applySpeed(playbackSpeed + 0.1);
        break;
      case "ArrowDown":
        e.preventDefault();
        applySpeed(playbackSpeed - 0.1);
        break;
      case "KeyR":
        seekToGlobalTime(0);
        break;
      case "KeyM":
        applyVolume(volume > 0 ? 0 : 1);
        break;
      case "KeyC":
        showContext = !showContext;
        draw();
        saveSettings();
        break;
      case "BracketLeft":
        e.preventDefault();
        seekToGlobalTime(getCurrentAudioTime() - 30);
        break;
      case "BracketRight":
        e.preventDefault();
        seekToGlobalTime(getCurrentAudioTime() + 30);
        break;
      case "KeyP":
        prevChapter();
        break;
      case "KeyN":
        nextChapter();
        break;
      case "KeyL":
        if (chaptersBackdrop && chapters.length) {
          const isOpen = chaptersBackdrop.style.display === "flex";
          chaptersBackdrop.style.display = isOpen ? "none" : "flex";
          if (!isOpen) {
            updateChapterListHighlight();
            requestAnimationFrame(() => {
              const active = chapterList.querySelector(".chapter-item.active");
              if (active) active.scrollIntoView({ block: "center", behavior: "smooth" });
            });
          }
        }
        break;
      case "KeyB":
        if (e.shiftKey) {
          // Shift+B opens bookmarks list
          openBookmarksList();
        } else {
          // B adds a bookmark at current position
          promptAddBookmark();
        }
        break;
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Init
  // ══════════════════════════════════════════════════════════════════════════

  loadSettings();
  applyColors(colors);
  applySpeed(playbackSpeed);
  applyVolume(volume);

  window.addEventListener("resize", () => {
    if (readerView.style.display !== "none") {
      resize();
    }
  });

  // Start with the library view
  loadLibrary();
})();
