import Gyos from "gyosjs/csp";
import {
  createGame,
  play,
  legalMoves,
  replayRecord,
  recordOf,
  dailySeed,
  normalizeSeed,
  TARGET,
  MOVES,
} from "./engine.js";
import "./style.css";

const TYPES = [
  ["Blossom", "flower"],
  ["Leaf", "leaf"],
  ["Berries", "berry"],
  ["Sunshine", "sun"],
  ["Raindrop", "drop"],
  ["Starlight", "star"],
];
const SAVE = "bloomfall.garden.v1",
  PREFS = "bloomfall.preferences.v1",
  BEST = "bloomfall.best.v1";
const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const encode = (value) =>
  btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const decode = (value) => {
  if (value.length > 3000 || !/^[\w-]+$/.test(value))
    throw new Error("Invalid replay link.");
  return JSON.parse(atob(value.replaceAll("-", "+").replaceAll("_", "/")));
};

Gyos.scope("Garden", () => {
  const signal = Gyos.signal,
    computed = Gyos.computed;
  const tiles = signal([]),
    score = signal(0),
    moves = signal(MOVES),
    seed = signal("");
  const selected = signal(-1),
    focusSlot = signal(0),
    busy = signal(false),
    paused = signal(false);
  const replaying = signal(false),
    replayStep = signal(0),
    replayTotal = signal(0),
    modal = signal("");
  const message = signal("A little swap can start something lovely."),
    combo = signal(0),
    hinted = signal([]);
  const harvest = signal(Array(6).fill(0)),
    historyCount = signal(0),
    best = signal(Math.max(0, Math.min(10000000, Number(read(BEST)) || 0)));
  const saveStatus = signal("Your garden saves as you play."),
    saved = signal(true);
  const soundEnabled = signal(false),
    soundNote = signal("Gentle notes for matches. Off by default."),
    lessMotion = signal(false),
    systemMotion = signal(false);
  const soundSupported =
    typeof (window.AudioContext || window.webkitAudioContext) === "function";
  const seedInput = signal(""),
    seedError = signal(""),
    shareUrl = signal(""),
    shareMessage = signal("");
  const finished = computed(() => moves() === 0 && !busy());
  const locked = computed(
    () => busy() || paused() || replaying() || moves() === 0 || !!modal(),
  );
  const progress = computed(() =>
    Math.min(100, Math.floor((score() / TARGET) * 100)),
  );
  const canUndo = computed(
    () => historyCount() > 0 && !replaying() && !modal(),
  );
  const canReplay = computed(
    () => historyCount() > 0 && !busy() && !replaying(),
  );
  const rootClass = computed(() =>
    lessMotion() || systemMotion() ? "less-motion" : "",
  );
  const harvestView = computed(() =>
    TYPES.map(([name, icon], kind) => ({
      kind,
      name,
      icon: `#${icon}`,
      className: `kind-${kind}`,
      count: harvest()[kind],
    })),
  );
  let state = createGame(dailySeed()),
    ownState = null,
    abort = new AbortController();
  let lifetime = new AbortController(),
    audio = null,
    pointer = null,
    ignoreClick = false,
    dialogOpener = null;
  let media = null,
    alive = true;
  const metrics = { moves: [], cancellations: 0, frames: 0 };

  function persistPrefs() {
    try {
      localStorage.setItem(
        PREFS,
        JSON.stringify({ sound: soundEnabled(), motion: lessMotion() }),
      );
    } catch {
      storageError();
    }
  }
  function storageError() {
    saved(false);
    saveStatus("Storage unavailable — keep this tab open or share a replay.");
  }
  function persist() {
    if (replaying()) return;
    try {
      localStorage.setItem(SAVE, JSON.stringify(recordOf(state)));
      if (state.score > best()) {
        best(state.score);
        localStorage.setItem(BEST, String(state.score));
      }
      saved(true);
      saveStatus("Saved on this device. A little peace of mind.");
    } catch {
      storageError();
    }
  }

  function render(frame = state, spawning = false) {
    const cleared = new Set(frame.cleared);
    Gyos.batch(() => {
      tiles(
        frame.board.flatMap((tile, slot) =>
          tile
            ? [
                {
                  ...tile,
                  slot,
                  origin: spawning ? frame.origins?.[tile.id] : undefined,
                  clearing: cleared.has(slot),
                },
              ]
            : [],
        ),
      );
      score(frame.score);
      moves(frame.moves);
      harvest([...frame.harvest]);
      seed(state.seed);
      historyCount(state.history.length);
      if (frame.combo) combo(frame.combo);
    });
    metrics.frames++;
  }

  function cancel() {
    abort.abort();
    abort = new AbortController();
    metrics.cancellations++;
    busy(false);
    selected(-1);
    hinted([]);
    pointer = null;
  }

  // Animation time advances only while the document is visible and play isn't paused.
  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("Cancelled", "AbortError"));
        return;
      }
      let elapsed = 0,
        last = performance.now(),
        handle;
      const stop = () => {
        cancelAnimationFrame(handle);
        signal.removeEventListener("abort", stop);
        reject(new DOMException("Cancelled", "AbortError"));
      };
      const tick = (now) => {
        if (!document.hidden && !paused() && !modal())
          elapsed += Math.min(now - last, 50);
        last = now;
        if (elapsed >= ms) {
          signal.removeEventListener("abort", stop);
          resolve();
        } else handle = requestAnimationFrame(tick);
      };
      signal.addEventListener("abort", stop, { once: true });
      handle = requestAnimationFrame(tick);
    });
  }

  function sound(level = 1) {
    if (!soundEnabled() || document.hidden || !alive) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") void audio.resume().catch(() => {});
      const note = audio.createOscillator(),
        gain = audio.createGain(),
        now = audio.currentTime;
      note.type = "sine";
      note.frequency.value = [392, 440, 523.25, 659.25, 783.99][
        Math.min(level - 1, 4)
      ];
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.035, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.23);
      note.connect(gain);
      gain.connect(audio.destination);
      note.start(now);
      note.stop(now + 0.25);
      note.onended = () => {
        note.disconnect();
        gain.disconnect();
      };
    } catch {
      soundEnabled(false);
      soundNote("Sound could not start. You can keep playing quietly.");
    }
  }

  function boardHadFocus() {
    return document.activeElement?.matches(".tile");
  }
  function focusBoard() {
    requestAnimationFrame(() => {
      if (alive && !modal() && !paused())
        document
          .querySelector(`.tile[data-slot="${focusSlot()}"]`)
          ?.focus({ preventScroll: true });
    });
  }

  async function animateMove(a, b, signal) {
    const started = performance.now(),
      restoreFocus = boardHadFocus();
    const result = play(state, a, b);
    busy(true);
    selected(-1);
    hinted([]);
    combo(0);
    try {
      for (const frame of result.frames) {
        if (signal.aborted) return false;
        if (frame.phase === "fall" && !lessMotion() && !systemMotion()) {
          render(frame, true);
          await wait(32, signal); // Let newly keyed pieces paint above the board before falling.
        }
        render(frame);
        if (frame.phase === "clear") {
          message(
            frame.combo > 1
              ? `Lovely! Cascade ×${frame.combo} · +${frame.gain} points`
              : `A little bloom · +${frame.gain} points`,
          );
          sound(frame.combo);
        }
        if (frame.phase === "shuffle")
          message("A fresh arrangement — this garden needed a little shuffle.");
        if (frame.phase !== "settled")
          await wait(
            lessMotion() || systemMotion()
              ? 20
              : frame.phase === "clear"
                ? 190
                : 230,
            signal,
          );
      }
      if (signal.aborted) return false;
      state = result.state;
      render();
      busy(false);
      if (result.valid) {
        persist();
        message(
          state.moves === 0
            ? "Your garden is complete. Look at all that grew."
            : result.combo > 1
              ? `${result.combo} little chain reactions. +${result.gain} points!`
              : `+${result.gain} points. A lovely little match.`,
        );
        metrics.moves.push({
          ms: +(performance.now() - started).toFixed(2),
          frames: result.frames.length,
          combo: result.combo,
        });
        if (metrics.moves.length > 200) metrics.moves.shift();
      } else message("Almost! Try a swap that lines up three. No move lost.");
      if (restoreFocus) focusBoard();
      if (state.moves === 0 && !replaying()) openDialog("result");
      return result.valid;
    } catch (error) {
      if (error.name !== "AbortError") {
        message(
          "That move could not finish. Your last settled garden is safe.",
        );
        render();
        busy(false);
        console.error(error);
      }
      return false;
    }
  }

  function choose(slot) {
    if (ignoreClick) {
      ignoreClick = false;
      return;
    }
    if (locked()) return;
    focusSlot(slot);
    if (selected() === slot) {
      selected(-1);
      return;
    }
    const previous = selected();
    if (
      previous >= 0 &&
      Math.abs(Math.floor(previous / 8) - Math.floor(slot / 8)) +
        Math.abs((previous % 8) - (slot % 8)) ===
        1
    )
      void animateMove(previous, slot, abort.signal);
    else {
      selected(slot);
      hinted([]);
      message("Now choose a neighboring piece.");
    }
  }

  function keyDown(event, slot) {
    const directions = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    };
    if (event.key === "Escape") {
      selected(-1);
      hinted([]);
      message("Selection cleared. Take your time.");
      return;
    }
    if (!directions[event.key]) return;
    event.preventDefault();
    const [dr, dc] = directions[event.key];
    focusSlot(
      Math.max(0, Math.min(7, Math.floor(slot / 8) + dr)) * 8 +
        Math.max(0, Math.min(7, (slot % 8) + dc)),
    );
    focusBoard();
  }

  function pointerDown(event) {
    ignoreClick = false;
    if (locked() || !event.isPrimary || event.button !== 0) return;
    const tile = event.target.closest(".tile");
    if (tile)
      pointer = {
        id: event.pointerId,
        slot: Number(tile.dataset.slot),
        x: event.clientX,
        y: event.clientY,
      };
  }
  function pointerUp(event) {
    const start = pointer;
    pointer = null;
    if (!start || start.id !== event.pointerId || locked()) return;
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
    ignoreClick = true;
    const row = Math.floor(start.slot / 8),
      col = start.slot % 8;
    const nextRow = row + (Math.abs(dy) > Math.abs(dx) ? Math.sign(dy) : 0);
    const nextCol = col + (Math.abs(dx) >= Math.abs(dy) ? Math.sign(dx) : 0);
    if (nextRow < 0 || nextRow > 7 || nextCol < 0 || nextCol > 7) return;
    focusSlot(nextRow * 8 + nextCol);
    void animateMove(start.slot, focusSlot(), abort.signal);
  }

  function openDialog(name) {
    if (replaying() && name === "restart") {
      stopReplay();
      return;
    }
    dialogOpener = document.activeElement;
    modal(name);
    seedError("");
    const dialog = document.getElementById("garden-dialog");
    if (!dialog.open) dialog.showModal();
    // g-show updates with the reactive flush; move focus into the visible section.
    requestAnimationFrame(() => dialog.querySelector(".dialog-close")?.focus());
  }
  function closeDialog() {
    modal("");
    document.getElementById("garden-dialog")?.close();
    if (dialogOpener?.isConnected) dialogOpener.focus({ preventScroll: true });
  }
  function resetTo(next, text) {
    cancel();
    paused(false);
    combo(0);
    state = next;
    render();
    message(text);
    persist();
  }
  function restart() {
    closeDialog();
    resetTo(createGame(state.seed), "Same garden. A fresh little beginning.");
  }
  function undo() {
    if (!canUndo()) return;
    const record = recordOf(state);
    record.moves.pop();
    resetTo(replayRecord(record), "One step back. Another possibility.");
    focusBoard();
  }
  function newGarden(kind) {
    try {
      const nextSeed =
        kind === "daily"
          ? dailySeed()
          : kind === "random"
            ? `garden-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`
            : normalizeSeed(seedInput().trim());
      if (replaying()) {
        cancel();
        replaying(false);
        ownState = null;
      }
      closeDialog();
      resetTo(createGame(nextSeed), "A fresh garden, full of possibilities.");
      history.replaceState(null, "", location.pathname);
      seedInput("");
    } catch (error) {
      seedError(error.message);
    }
  }
  function hint() {
    if (locked()) return;
    const pair = legalMoves(state.board)[0];
    if (pair) {
      hinted(pair);
      selected(-1);
      message(
        `Try row ${Math.floor(pair[0] / 8) + 1}, column ${(pair[0] % 8) + 1}. The dotted pieces are neighbors.`,
      );
    }
  }
  function togglePause() {
    if (!finished()) {
      paused(!paused());
      if (!paused()) focusBoard();
    }
  }

  async function startReplay(record) {
    replayRecord(record); // Validate all moves before interrupting the player's game.
    if (replaying()) cancel();
    else ownState = state;
    closeDialog();
    cancel();
    paused(false);
    replaying(true);
    replayTotal(record.moves.length);
    replayStep(0);
    combo(0);
    state = createGame(record.seed);
    render();
    message("Watch the garden grow, one move at a time.");
    const signal = abort.signal;
    for (let i = 0; i < record.moves.length; i++) {
      if (signal.aborted) return;
      replayStep(i + 1);
      if (!(await animateMove(...record.moves[i], signal)) || signal.aborted)
        return;
      try {
        await wait(lessMotion() || systemMotion() ? 35 : 320, signal);
      } catch {
        return;
      }
    }
    if (!signal.aborted) {
      busy(false);
      message("Replay complete. Your own garden is waiting, unchanged.");
    }
  }
  function stopReplay() {
    if (!replaying()) return;
    cancel();
    replaying(false);
    paused(false);
    combo(0);
    state = ownState || createGame(dailySeed());
    ownState = null;
    render();
    message("Back to your garden, just as you left it.");
    history.replaceState(null, "", location.pathname);
  }
  function watchReplay() {
    if (canReplay()) void startReplay(recordOf(state));
  }
  async function copyShare() {
    try {
      await navigator.clipboard.writeText(shareUrl());
      shareMessage("Copied. A little garden, ready to send.");
    } catch {
      document.getElementById("share-url")?.select();
      shareMessage("Select and copy the link above to share it.");
    }
  }
  function shareReplay() {
    if (busy() || replaying()) return;
    const url = new URL(location.pathname, location.origin);
    url.searchParams.set("replay", encode(recordOf(state)));
    shareUrl(url.href);
    shareMessage("");
    openDialog("share");
  }

  function initialize() {
    const savedRecord = read(SAVE);
    if (savedRecord) {
      try {
        state = replayRecord(JSON.parse(savedRecord));
        message(
          state.moves
            ? "Welcome back. Your little garden is right here."
            : "Welcome back to your finished garden. Start another whenever you like.",
        );
      } catch {
        saved(false);
        saveStatus("Old save could not be opened. A fresh garden is ready.");
      }
    }
    try {
      const preferences = JSON.parse(read(PREFS) || "{}");
      soundEnabled(soundSupported && preferences.sound === true);
      lessMotion(preferences.motion === true);
    } catch {
      /* A damaged preference never blocks play. */
    }
    render();
  }
  initialize();

  return {
    tiles,
    score,
    moves,
    seed,
    selected,
    focusSlot,
    busy,
    paused,
    replaying,
    modal,
    message,
    best,
    saveStatus,
    soundEnabled,
    soundNote,
    soundSupported: () => soundSupported,
    lessMotion,
    seedInput,
    seedError,
    shareUrl,
    shareMessage,
    progress,
    finished,
    locked,
    canUndo,
    canReplay,
    rootClass,
    harvestView,
    progressStyle: () => `width:${progress()}%`,
    saveDot: () => (saved() ? "" : "save-warning"),
    gardenLabel: () =>
      seed().startsWith("daily-") ? "THE DAILY GARDEN" : "A GARDEN OF YOUR OWN",
    gardenTitle: () =>
      seed().startsWith("daily-")
        ? "A fresh start, every day."
        : "A little off the beaten path.",
    modeLabel: () =>
      replaying() ? "WATCHING A REPLAY" : "MATCH THREE · MAKE A MOMENT",
    comboLabel: () =>
      combo() > 1 ? `a lovely ×${combo()} cascade` : "let it bloom",
    pauseLabel: () => (paused() ? "Resume" : "Pause"),
    replayLabel: () => `Replay · ${replayStep()} / ${replayTotal()} moves`,
    dialogTitle: () =>
      ({
        help: "A few little things.",
        settings: "Make yourself at home.",
        restart: "Begin again?",
        garden: "Where shall we grow?",
        result:
          score() >= TARGET ? "Look at you bloom." : "Every garden grows.",
        share: "Send a little sunshine.",
      })[modal()] || "",
    resultMessage: () =>
      score() >= TARGET
        ? `You reached the goal! Your best cascade was ×${state.bestCombo}. A lovely place to leave things.`
        : `You grew ${score()} points toward 1,800. Try this same seed again, undo a move, or plant a fresh garden.`,
    tileIcon: (tile) => `#${TYPES[tile.kind][1]}`,
    tileClass: (tile) =>
      `tile kind-${tile.kind}${selected() === tile.slot ? " selected" : ""}${hinted().includes(tile.slot) ? " hinted" : ""}${tile.clearing ? " clearing" : ""}`,
    tileStyle: (tile) =>
      `left:${(tile.slot % 8) * 12.5}%;top:${Math.floor((tile.origin ?? tile.slot) / 8) * 12.5}%;`,
    tileLabel: (tile) =>
      `${TYPES[tile.kind][0]}, row ${Math.floor(tile.slot / 8) + 1}, column ${(tile.slot % 8) + 1}${selected() === tile.slot ? ", selected" : ""}`,
    choose,
    keyDown,
    pointerDown,
    pointerUp,
    pointerCancel: () => {
      pointer = null;
    },
    openDialog,
    closeDialog,
    restart,
    undo,
    newGarden,
    hint,
    togglePause,
    watchReplay,
    stopReplay,
    shareReplay,
    copyShare,
    setSound: (value) => {
      soundEnabled(value);
      if (value) sound();
      persistPrefs();
    },
    setMotion: (value) => {
      lessMotion(value);
      persistPrefs();
    },
    setSeedInput: (value) => seedInput(value),
    onMount() {
      if (!soundSupported)
        soundNote(
          "Sound is unavailable in this browser. Enjoy a quiet garden.",
        );
      media = matchMedia("(prefers-reduced-motion: reduce)");
      systemMotion(media.matches);
      media.addEventListener("change", (event) => systemMotion(event.matches), {
        signal: lifetime.signal,
      });
      document.addEventListener(
        "visibilitychange",
        () => {
          if (document.hidden && audio?.state === "running")
            void audio.suspend();
        },
        { signal: lifetime.signal },
      );
      window.addEventListener(
        "pagehide",
        () => {
          if (!replaying()) persist();
        },
        { signal: lifetime.signal },
      );
      try {
        localStorage.setItem("bloomfall.probe", "1");
        localStorage.removeItem("bloomfall.probe");
      } catch {
        storageError();
      }
      const replay = new URL(location.href).searchParams.get("replay");
      if (replay) {
        try {
          const record = decode(replay);
          replayRecord(record);
          void startReplay(record);
        } catch {
          message("That replay link could not be opened. Your garden is safe.");
        }
      }
      if (import.meta.env.DEV)
        window.__bloomfall = {
          snapshot: () => structuredClone(state),
          legalMoves: () => legalMoves(state.board),
          metrics: () => structuredClone(metrics),
          replay: startReplay,
          stopReplay,
          // Development-only audit surface. Gameplay itself uses the visible controls.
          busy: () => busy(),
          dispose: () => Gyos.cleanup(document.getElementById("game")),
        };
    },
    onUnmount() {
      alive = false;
      abort.abort();
      lifetime.abort();
      if (audio) void audio.close();
      if (import.meta.env.DEV) delete window.__bloomfall;
    },
  };
});

Gyos.mountAll();
