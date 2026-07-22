const DEFAULTS = {
  enabled: false,
  phase: "idle",
  focusSeconds: 1500,
  breakSeconds: 300,
  focusEndTime: null,
  breakEndTime: null,
  sessionsCompleted: 0
};

const focusRange = document.getElementById("focusRange");
const breakRange = document.getElementById("breakRange");
const focusOutput = document.getElementById("focusOutput");
const breakOutput = document.getElementById("breakOutput");
const focusMinutes = document.getElementById("focusMinutes");
const focusSecondsInput = document.getElementById("focusSecondsInput");
const breakMinutes = document.getElementById("breakMinutes");
const breakSecondsInput = document.getElementById("breakSecondsInput");
const powerButton = document.getElementById("powerButton");
const powerLabel = document.getElementById("powerLabel");
const countdown = document.getElementById("countdown");
const phasePill = document.getElementById("phasePill");
const sessionCount = document.getElementById("sessionCount");
const timerMessage = document.getElementById("timerMessage");
const progressBar = document.getElementById("progressBar");

let state = { ...DEFAULTS };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatDuration(seconds, compact = false) {
  seconds = Math.max(0, Math.round(seconds));
  if (seconds < 60) return `${seconds} sec`;
  if (seconds === 3600) return "1 hour";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) return compact ? `${minutes} min` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function splitTime(totalSeconds) {
  return {
    minutes: Math.floor(totalSeconds / 60),
    seconds: totalSeconds % 60
  };
}

function syncTypedInputs(kind, totalSeconds) {
  const parts = splitTime(totalSeconds);
  if (kind === "focus") {
    focusMinutes.value = parts.minutes;
    focusSecondsInput.value = parts.seconds;
  } else {
    breakMinutes.value = parts.minutes;
    breakSecondsInput.value = parts.seconds;
  }
}

function getTypedSeconds(kind) {
  const minutesInput = kind === "focus" ? focusMinutes : breakMinutes;
  const secondsInput = kind === "focus" ? focusSecondsInput : breakSecondsInput;
  const maxTotal = kind === "focus" ? 3600 : 1800;

  let minutes = Number(minutesInput.value) || 0;
  let seconds = Number(secondsInput.value) || 0;

  minutes = clamp(Math.floor(minutes), 0, kind === "focus" ? 60 : 30);
  seconds = clamp(Math.floor(seconds), 0, 59);

  let total = minutes * 60 + seconds;
  total = clamp(total, 10, maxTotal);

  return total;
}

async function readState() {
  state = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
}

async function saveDurations(focusSeconds = Number(focusRange.value), breakSeconds = Number(breakRange.value)) {
  await chrome.storage.local.set({ focusSeconds, breakSeconds });
  state.focusSeconds = focusSeconds;
  state.breakSeconds = breakSeconds;
}

function renderSliderLabels() {
  focusOutput.textContent = formatDuration(Number(focusRange.value), true);
  breakOutput.textContent = formatDuration(Number(breakRange.value), true);
}

function applyRangeToTyped(kind) {
  const total = Number(kind === "focus" ? focusRange.value : breakRange.value);
  syncTypedInputs(kind, total);
  renderSliderLabels();
}

async function applyTypedToRange(kind) {
  const total = getTypedSeconds(kind);
  const range = kind === "focus" ? focusRange : breakRange;
  range.value = total;
  syncTypedInputs(kind, total);
  renderSliderLabels();

  if (kind === "focus") {
    await saveDurations(total, state.breakSeconds);
  } else {
    await saveDurations(state.focusSeconds, total);
  }
}

function render() {
  const active = state.enabled;
  powerButton.classList.toggle("active", active);
  powerLabel.textContent = active ? "On" : "Off";

  for (const control of [focusRange, breakRange, focusMinutes, focusSecondsInput, breakMinutes, breakSecondsInput]) {
    control.disabled = active;
  }

  focusRange.value = state.focusSeconds;
  breakRange.value = state.breakSeconds;

  const activeElement = document.activeElement;
  const editingFocus =
    activeElement === focusMinutes || activeElement === focusSecondsInput;
  const editingBreak =
    activeElement === breakMinutes || activeElement === breakSecondsInput;

  if (!editingFocus) {
    syncTypedInputs("focus", state.focusSeconds);
  }
  if (!editingBreak) {
    syncTypedInputs("break", state.breakSeconds);
  }

  renderSliderLabels();

  const count = state.sessionsCompleted || 0;
  sessionCount.textContent = `${count} session${count === 1 ? "" : "s"}`;

  if (!active) {
    phasePill.textContent = "Ready";
    phasePill.classList.remove("break");
    countdown.textContent = formatClock(state.focusSeconds);
    timerMessage.textContent = "Choose your timing, then turn it on.";
    progressBar.style.width = "0%";
    return;
  }

  const isBreak = state.phase === "break";
  const endTime = isBreak ? state.breakEndTime : state.focusEndTime;
  const total = isBreak ? state.breakSeconds : state.focusSeconds;
  const remaining = endTime ? Math.max(0, (endTime - Date.now()) / 1000) : total;
  const elapsedRatio = total > 0 ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0;

  phasePill.textContent = isBreak ? "Break" : "Focusing";
  phasePill.classList.toggle("break", isBreak);
  countdown.textContent = formatClock(remaining);
  timerMessage.textContent = isBreak
    ? "Step away, breathe, and let your eyes rest."
    : `Your next ${formatDuration(state.breakSeconds)} break is counting down.`;
  progressBar.style.width = `${elapsedRatio * 100}%`;
}

async function togglePower() {
  powerButton.disabled = true;
  try {
    if (state.enabled) {
      await chrome.runtime.sendMessage({ type: "STOP_TIMER" });
    } else {
      const focusSeconds = getTypedSeconds("focus");
      const breakSeconds = getTypedSeconds("break");
      await saveDurations(focusSeconds, breakSeconds);
      await chrome.runtime.sendMessage({ type: "START_TIMER" });
    }

    await readState();
    render();
  } finally {
    powerButton.disabled = false;
  }
}

focusRange.addEventListener("input", () => applyRangeToTyped("focus"));
breakRange.addEventListener("input", () => applyRangeToTyped("break"));

focusRange.addEventListener("change", async () => {
  await saveDurations(Number(focusRange.value), state.breakSeconds);
});

breakRange.addEventListener("change", async () => {
  await saveDurations(state.focusSeconds, Number(breakRange.value));
});

for (const input of [focusMinutes, focusSecondsInput]) {
  input.addEventListener("change", () => applyTypedToRange("focus"));
}

for (const input of [breakMinutes, breakSecondsInput]) {
  input.addEventListener("change", () => applyTypedToRange("break"));
}

for (const input of [focusMinutes, focusSecondsInput]) {
  input.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await applyTypedToRange("focus");
      input.blur();
    }
  });
}

for (const input of [breakMinutes, breakSecondsInput]) {
  input.addEventListener("keydown", async (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      await applyTypedToRange("break");
      input.blur();
    }
  });
}

powerButton.addEventListener("click", togglePower);

chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== "local") return;
  await readState();
  render();
});

(async function init() {
  await readState();
  render();
  setInterval(render, 250);
})();
