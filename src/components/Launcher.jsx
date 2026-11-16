import { useEffect, useState } from 'react';
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

  return (
    <div className="launcher-shell" onContextMenu={openMenu}>
      <div className="launcher-grip" title="Drag to move" aria-hidden="true" />
      <button
        type="button"
        className="pad"
        aria-label="New sticky note"
        title="New sticky note"
        onClick={() => window.sticky.app.newNote()}
      >
        <span className="pad-sheet pad-sheet-3" aria-hidden="true" />
        <span className="pad-sheet pad-sheet-2" aria-hidden="true" />
        <span className="pad-sheet pad-top" aria-hidden="true">
          <span className="pad-plus" />
        </span>
      </button>
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
