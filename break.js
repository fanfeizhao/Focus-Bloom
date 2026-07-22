const countdown = document.getElementById("breakCountdown");
const breathText = document.getElementById("breathText");

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

async function updateCountdown() {
  const state = await chrome.storage.local.get({
    enabled: false,
    phase: "idle",
    breakEndTime: null
  });

  if (!state.enabled || state.phase !== "break" || !state.breakEndTime) {
    window.close();
    return;
  }

  const remaining = (state.breakEndTime - Date.now()) / 1000;
  countdown.textContent = formatClock(remaining);

  if (remaining <= 0) {
    window.close();
  }
}

let breathIn = true;
setInterval(() => {
  breathIn = !breathIn;
  breathText.textContent = breathIn ? "Breathe in" : "Breathe out";
}, 4000);

document.addEventListener("keydown", (event) => {
  event.preventDefault();
  event.stopPropagation();
}, true);

document.addEventListener("contextmenu", (event) => event.preventDefault());

chrome.storage.onChanged.addListener(() => updateCountdown());
setInterval(updateCountdown, 250);
updateCountdown();
