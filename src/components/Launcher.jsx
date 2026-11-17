import { useEffect, useRef, useState } from 'react';
import { IconArchive, IconMore, IconTimer } from './icons.jsx';

// The launcher is a little pad of sticky notes: click it to peel off a new
// one. Drag the grip above it to move it. Underneath: the Pomodoro timer, the
// hidden-notes manager (with a count when notes are hidden) and the menu.
export default function Launcher() {
  const [hidden, setHidden] = useState(0);

  useEffect(() => {
    let alive = true;
    window.sticky.app.hiddenCount().then((n) => alive && setHidden(n));
    const off = window.sticky.app.onHiddenCount(setHidden);
    return () => {
      alive = false;
      off();
    };
  }, []);

  const openMenu = (e) => {
    e.preventDefault();
    window.sticky.app.openMenu();
  };

  // The two "New" choices show only while the mouse cursor is over the pad.
  // After a choice is clicked they stay hidden until the cursor really moves
  // (or leaves and comes back), so a note or notepad opening or closing over
  // the launcher never brings them back by itself. Driven by pointer events
  // rather than CSS :hover or focus, which can be left stale when another
  // window opens or closes over the launcher.
  const [choicesOpen, setChoicesOpen] = useState(false);
  const heldAt = useRef(null); // where a choice was clicked; cleared once the cursor moves away
  const showChoices = (e) => {
    if (e.pointerType !== 'mouse') return;
    if (heldAt.current) {
      if (Math.hypot(e.clientX - heldAt.current.x, e.clientY - heldAt.current.y) < 6) return;
      heldAt.current = null;
    }
    setChoicesOpen(true);
  };
  const pick = (create) => (e) => {
    heldAt.current = { x: e.clientX, y: e.clientY };
    setChoicesOpen(false);
    e.currentTarget.blur();
    create();
  };

  useEffect(() => {
    const close = () => setChoicesOpen(false);
    window.addEventListener('blur', close);
    document.addEventListener('visibilitychange', close);
    return () => {
      window.removeEventListener('blur', close);
      document.removeEventListener('visibilitychange', close);
    };
  }, []);

  return (
    <div className="launcher-shell" onContextMenu={openMenu}>
      <div className="launcher-grip" title="Drag to move" aria-hidden="true" />
      {/* Hovering the pad offers two choices: a sticky note or a notepad. */}
      <div
        className={choicesOpen ? 'pad-wrap is-open' : 'pad-wrap'}
        onPointerEnter={showChoices}
        onPointerMove={(e) => !choicesOpen && showChoices(e)}
        onPointerLeave={() => {
          heldAt.current = null;
          setChoicesOpen(false);
        }}
      >
        <button
          type="button"
          className="pad"
          aria-label="New sticky note"
          title="New sticky note"
          onClick={pick(() => window.sticky.app.newNote())}
        >
          <span className="pad-sheet pad-sheet-3" aria-hidden="true" />
          <span className="pad-sheet pad-sheet-2" aria-hidden="true" />
          <span className="pad-sheet pad-top" aria-hidden="true">
            <span className="pad-plus" />
          </span>
        </button>
        {/* On hover the stack splits into two little pads: a sticky note and a notepad. */}
        <div className="pad-choices" role="menu" aria-label="New">
          <button
            type="button"
            role="menuitem"
            className="pad-choice is-note"
            data-action="new-note"
            aria-label="New sticky note"
            title="New sticky note"
            tabIndex={-1}
            onClick={pick(() => window.sticky.app.newNote())}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M8 3.5v9M3.5 8h9" />
            </svg>
            <span className="pad-choice-label">Sticky</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="pad-choice is-notepad"
            data-action="new-notepad"
            aria-label="New notepad"
            title="New notepad"
            tabIndex={-1}
            onClick={pick(() => window.sticky.app.newNotepad())}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path d="M3 13l1-3.2L11.2 2.6a1.3 1.3 0 0 1 1.9 1.9L5.9 11.7z" />
            </svg>
            <span className="pad-choice-label">Notepad</span>
          </button>
        </div>
      </div>
      <div className="launcher-row">
        <button type="button" className="launcher-btn" data-action="timer" aria-label="Pomodoro" title="Pomodoro" onClick={() => window.sticky.app.openTimer()}>
          <IconTimer />
        </button>
        <button
          type="button"
          className="launcher-btn"
          data-action="hidden"
          aria-label={hidden ? `Hidden notes (${hidden})` : 'Hidden notes'}
          title={hidden ? `Hidden notes (${hidden})` : 'Hidden notes'}
          onClick={() => window.sticky.app.openManager()}
        >
          <IconArchive />
          {hidden > 0 && <span className="launcher-badge">{hidden > 9 ? '9+' : hidden}</span>}
        </button>
        <button type="button" className="launcher-btn" data-action="menu" aria-label="Menu and settings" title="Menu and settings" onClick={openMenu}>
          <IconMore />
        </button>
      </div>
    </div>
  );
}
