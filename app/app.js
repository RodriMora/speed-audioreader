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
  // Settings persistence
  // ══════════════════════════════════════════════════════════════════════════

  function saveSettings() {
    try {
      localStorage.setItem("sar.settings", JSON.stringify({
        colors,
        fontScale,
        playbackSpeed,
        volume,
        showContext,
        lastPosition: getCurrentAudioTime(),
      }));
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

  function getLastPosition() {
    try {
      const raw = localStorage.getItem("sar.settings");
      if (!raw) return 0;
      const s = JSON.parse(raw);
      return s.lastPosition || 0;
    } catch { return 0; }
  }

  // Save position periodically
  setInterval(() => {
    if (audioReady && isPlaying) saveSettings();
  }, 5000);

  // ══════════════════════════════════════════════════════════════════════════
  // Data Loading
  // ══════════════════════════════════════════════════════════════════════════

  async function loadAlignmentData() {
    loadingText.textContent = "Loading alignment data...";

    try {
      const resp = await fetch("data/alignment_compact.json");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();

      bookTitleEl.textContent = `${data.title} — ${data.author}`;
      words = data.words; // [[word, start, end], ...]
      totalDuration = data.total_duration;

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

      // Restore last position if available
      const lastPos = getLastPosition();
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
  // Keyboard Shortcuts
  // ══════════════════════════════════════════════════════════════════════════

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

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
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Init
  // ══════════════════════════════════════════════════════════════════════════

  loadSettings();
  applyColors(colors);
  applySpeed(playbackSpeed);
  applyVolume(volume);

  resize();
  window.addEventListener("resize", resize);

  // Start loading
  loadAlignmentData();
})();
