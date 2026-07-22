const FOCUS_ALARM = "focus-finished";
const BREAK_ALARM = "break-finished";
const BREAK_PAGE = chrome.runtime.getURL("break.html");

let reopeningBreakWindow = false;

const DEFAULT_STATE = {
  enabled: false,
  phase: "idle",
  focusSeconds: 25 * 60,
  breakSeconds: 5 * 60,
  focusEndTime: null,
  breakEndTime: null,
  breakWindowIds: [],
  previousWindowId: null,
  previousTabId: null,
  sessionsCompleted: 0
};

async function getState() {
  const stored = await chrome.storage.local.get(DEFAULT_STATE);
  return { ...DEFAULT_STATE, ...stored };
}

async function saveState(patch) {
  await chrome.storage.local.set(patch);
}

async function clearAllAlarms() {
  await Promise.all([
    chrome.alarms.clear(FOCUS_ALARM),
    chrome.alarms.clear(BREAK_ALARM)
  ]);
}

async function closeBreakWindows(windowIds) {
  if (!Array.isArray(windowIds)) return;

  await Promise.all(
    windowIds.map(async (windowId) => {
      try {
        await chrome.windows.remove(windowId);
      } catch (_) {
        // The window may already be closed.
      }
    })
  );
}

async function resetTimer() {
  const state = await getState();
  await clearAllAlarms();
  await saveState({
    enabled: false,
    phase: "idle",
    focusEndTime: null,
    breakEndTime: null,
    breakWindowIds: [],
    previousWindowId: null,
    previousTabId: null
  });
  await closeBreakWindows(state.breakWindowIdss);
  await updateBadge();
}

async function startFocusTimer() {
  const state = await getState();
  const focusEndTime = Date.now() + state.focusSeconds * 1000;

  await clearAllAlarms();
  await saveState({
    enabled: true,
    phase: "focus",
    focusEndTime,
    breakEndTime: null,
    breakWindowIds: []
  });

  await chrome.alarms.create(FOCUS_ALARM, { when: focusEndTime });
  await updateBadge();
}


async function rememberCurrentTab() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    const focusedWindow = windows.find(
      (win) => win.focused && win.type === "normal"
    );

    if (!focusedWindow) return;

    const activeTab = (focusedWindow.tabs || []).find((tab) => tab.active);
    await saveState({
      previousWindowId: focusedWindow.id ?? null,
      previousTabId: activeTab?.id ?? null
    });
  } catch (error) {
    console.error("Could not remember the current tab:", error);
  }
}

async function restorePreviousTab(state) {
  try {
    if (state.previousWindowId) {
      await chrome.windows.update(state.previousWindowId, { focused: true });
    }

    if (state.previousTabId) {
      await chrome.tabs.update(state.previousTabId, { active: true });
    }
  } catch (error) {
    console.error("Could not restore the previous tab:", error);
  }
}

async function openBreakWindow() {
  if (reopeningBreakWindow) return;
  reopeningBreakWindow = true;

  try {
    const state = await getState();
    if (!state.enabled || state.phase !== "break" || !state.breakEndTime) return;

    if (Date.now() >= state.breakEndTime) {
      await finishBreak();
      return;
    }

    const existingIds = Array.isArray(state.breakWindowIdss)
      ? state.breakWindowIdss
      : [];

    const stillOpen = [];
    for (const id of existingIds) {
      try {
        const existing = await chrome.windows.get(id);
        if (existing) stillOpen.push(existing.id);
      } catch (_) {
        // Missing window; recreate below.
      }
    }

    const displays = await chrome.system.display.getInfo();
    if (!Array.isArray(displays) || displays.length === 0) return;

    // If the correct number of break windows already exists, focus and
    // re-fullscreen them instead of creating duplicates.
    if (stillOpen.length === displays.length) {
      for (const id of stillOpen) {
        try {
          await chrome.windows.update(id, {
            focused: true,
            state: "fullscreen"
          });
        } catch (_) {}
      }
      await saveState({ breakWindowIds: stillOpen });
      return;
    }

    await closeBreakWindows(stillOpen);

    const newWindowIds = [];

    for (const display of displays) {
      const bounds = display.bounds || display.workArea;
      if (!bounds) continue;

      const win = await chrome.windows.create({
        url: BREAK_PAGE,
        type: "popup",
        focused: true,
        left: bounds.left,
        top: bounds.top,
        width: Math.max(300, bounds.width),
        height: Math.max(300, bounds.height)
      });

      if (win.id) {
        newWindowIds.push(win.id);

        try {
          await chrome.windows.update(win.id, {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
            state: "fullscreen",
            focused: true
          });
        } catch (error) {
          console.error("Could not fullscreen a display window:", error);
        }
      }
    }

    await saveState({ breakWindowIds: newWindowIds });
  } finally {
    reopeningBreakWindow = false;
  }
}

async function beginBreak() {
  const state = await getState();
  if (!state.enabled) return;

  await rememberCurrentTab();

  const breakEndTime = Date.now() + state.breakSeconds * 1000;
  await saveState({
    phase: "break",
    focusEndTime: null,
    breakEndTime,
    breakWindowIds: [],
    sessionsCompleted: (state.sessionsCompleted || 0) + 1
  });

  await chrome.alarms.create(BREAK_ALARM, { when: breakEndTime });
  await openBreakWindow();
  await updateBadge();
}

async function finishBreak() {
  const state = await getState();
  await chrome.alarms.clear(BREAK_ALARM);
  await closeBreakWindows(state.breakWindowIdss);
  await restorePreviousTab(state);

  const latest = await getState();
  if (!latest.enabled) return;

  const focusEndTime = Date.now() + latest.focusSeconds * 1000;
  await saveState({
    phase: "focus",
    focusEndTime,
    breakEndTime: null,
    breakWindowIds: [],
    previousWindowId: null,
    previousTabId: null
  });

  await chrome.alarms.create(FOCUS_ALARM, { when: focusEndTime });
  await updateBadge();
}

async function updateBadge() {
  const state = await getState();

  if (!state.enabled) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  await chrome.action.setBadgeBackgroundColor({
    color: state.phase === "break" ? "#7C3AED" : "#16A34A"
  });
  await chrome.action.setBadgeText({
    text: state.phase === "break" ? "REST" : "ON"
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  await chrome.storage.local.set({ ...DEFAULT_STATE, ...existing });
  await updateBadge();
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();

  if (!state.enabled) {
    await resetTimer();
    return;
  }

  if (state.phase === "break" && state.breakEndTime) {
    if (Date.now() >= state.breakEndTime) {
      await finishBreak();
    } else {
      await chrome.alarms.create(BREAK_ALARM, { when: state.breakEndTime });
      await openBreakWindow();
    }
  } else if (state.phase === "focus" && state.focusEndTime) {
    if (Date.now() >= state.focusEndTime) {
      await beginBreak();
    } else {
      await chrome.alarms.create(FOCUS_ALARM, { when: state.focusEndTime });
    }
  }

  await updateBadge();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === FOCUS_ALARM) {
    await beginBreak();
  } else if (alarm.name === BREAK_ALARM) {
    await finishBreak();
  }
});

chrome.windows.onRemoved.addListener(async (windowId) => {
  const state = await getState();
  const ids = Array.isArray(state.breakWindowIds) ? state.breakWindowIds : [];

  if (
    state.enabled &&
    state.phase === "break" &&
    ids.includes(windowId) &&
    state.breakEndTime &&
    Date.now() < state.breakEndTime
  ) {
    await saveState({
      breakWindowIds: ids.filter((id) => id !== windowId)
    });
    setTimeout(() => openBreakWindow(), 250);
  }
});

chrome.system.display.onDisplayChanged.addListener(async () => {
  const state = await getState();
  if (
    state.enabled &&
    state.phase === "break" &&
    state.breakEndTime &&
    Date.now() < state.breakEndTime
  ) {
    await openBreakWindow();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "START_TIMER") {
      await startFocusTimer();
    } else if (message.type === "STOP_TIMER") {
      await resetTimer();
    } else if (message.type === "OPEN_BREAK") {
      await openBreakWindow();
    } else if (message.type === "GET_STATE") {
      sendResponse(await getState());
      return;
    }

    sendResponse({ ok: true });
  })().catch((error) => {
    console.error(error);
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});
