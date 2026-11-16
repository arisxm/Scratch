import { useRef } from 'react';

// Transparent windows can't use the native resize border on Windows, so the
// corner grip measures the drag in screen coordinates and asks the main
// process to resize (it clamps to the minimum size and the screen edge).
export default function ResizeHandle() {
  const drag = useRef(null);
  const frame = useRef(0);
  const pending = useRef(null);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.screenX, y: e.screenY, w: window.outerWidth, h: window.outerHeight };
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    pending.current = { width: d.w + (e.screenX - d.x), height: d.h + (e.screenY - d.y) };
    if (!frame.current) {
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        window.sticky.note.resize(pending.current);
      });
    }
  };

  const end = (e) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      className="resize-handle"
      title="Drag to resize"
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );
}
