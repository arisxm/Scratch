import { useCallback, useEffect, useRef, useState } from 'react';
import { toDateKey, toMonthKey } from './dates.js';

const api = () => window.sticky;

/**
 * Loads this window's note from the main process and keeps it in sync.
 * `commit(patch)` updates the UI immediately and sends the patch to the main
 * process, which validates it and saves it to disk (debounced there).
 * `setLocal(patch)` changes UI state only, for fields the main process owns.
 */
export function useNote() {
  const [note, setNote] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    api()
      .note.get()
      .then((n) => {
        if (alive && n) {
          ref.current = n;
          setNote(n);
        }
      });
    const off = api().note.onChanged((n) => {
      ref.current = n;
      setNote(n);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const setLocal = useCallback((patch) => {
    if (!ref.current) return;
    ref.current = { ...ref.current, ...patch };
    setNote(ref.current);
  }, []);

  const commit = useCallback(
    (patch) => {
      setLocal(patch);
      api().note.update(patch);
    },
    [setLocal],
  );

  /** Functional update of the task list based on the latest state. */
  const updateTasks = useCallback(
    (fn) => {
      if (!ref.current) return;
      commit({ tasks: fn(ref.current.tasks) });
    },
    [commit],
  );

  return { note, commit, setLocal, updateTasks };
}

/** Today's date/month keys, refreshed at midnight and when the PC wakes. */
export function useToday() {
  const read = () => {
    const now = new Date();
    return { date: toDateKey(now), month: toMonthKey(now) };
  };
  const [today, setToday] = useState(read);

  useEffect(() => {
    let timer;
    const refresh = () => {
      setToday((prev) => {
        const next = read();
        return prev.date === next.date ? prev : next;
      });
    };
    const schedule = () => {
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, midnight - now);
    };
    schedule();
    // Timers can stall while Windows sleeps; re-check whenever we come back.
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const poll = setInterval(refresh, 60_000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return today;
}

/** Current time in ms, refreshed every `everyMs`, for countdown labels. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, everyMs);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, [everyMs]);
  return now;
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Close a utility window after a short fade (immediately when animations are off). */
export function closePanel() {
  const still =
    document.documentElement.dataset.motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (still) return window.sticky.app.closeWindow();
  document.documentElement.classList.add('is-closing');
  setTimeout(() => window.sticky.app.closeWindow(), 130);
  return undefined;
}

/** The app-wide settings, kept in sync with changes made anywhere (Settings window, menu). */
export function useSettings() {
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    let alive = true;
    window.sticky.settings.get().then((s) => alive && setSettings(s));
    const off = window.sticky.settings.onChanged(setSettings);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return [settings, setSettings];
}
