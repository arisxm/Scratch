import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconClose, IconTrash } from './icons.jsx';
import { PAPERS, canvasPng, constrain, drawShape, floodFill, hexToRgba, paintPaper, rgbToHex } from '../lib/paint.js';

// Notepad: a paint-style drawing pad on notepad paper. Draw with the mouse or a
// pen, write text, paste or drop pictures, select and move parts, and go full
// screen. Three stacked canvases make up the page: the paper (its lines), the
// drawing (transparent where nothing is drawn, so the eraser shows the paper
// again) and an overlay for previews (shapes, the highlighter, selections).
// The drawing is saved automatically by the main process as a PNG.

const R = Math.min(3, Math.max(1, window.devicePixelRatio || 1)); // canvas pixels per page pixel
const MAX_SIDE = 12000; // page pixels; matches PAGE_LIMIT in electron/notepad.js
const MAX_AREA = 120e6; // canvas pixels, well inside Chromium's limit
const UNDO_LIMIT = 40;
const SAVE_DELAY = 700;

const COLORS = [
  '#27304a', '#000000', '#5b6270', '#ffffff',
  '#3550a8', '#2f8fd8', '#1f9e8f', '#3c9a46',
  '#9cc93a', '#f2c230', '#f28c28', '#d9472f',
  '#c2306f', '#8a4fd1', '#8b5a2b', '#f6a5c0',
];

const ico = {
  width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false,
};

const TOOLS = [
  { id: 'select', key: 's', label: 'Select', icon: <svg {...ico} strokeDasharray="2.2 2.2"><rect x="3" y="3" width="12" height="12" rx="1" /></svg> },
  { id: 'pen', key: 'p', label: 'Pen', icon: <svg {...ico}><path d="M3 15l1-3.5L12.5 3a1.4 1.4 0 0 1 2 2L6 13.5z" /><path d="M11 4.5l2.5 2.5" /></svg> },
  { id: 'marker', key: 'm', label: 'Highlighter', icon: <svg {...ico}><path d="M5 11l5.5-7.5 3.5 3.5L6.5 12.5z" /><path d="M5 11l-1.5 3.5h3l1-2" /><path d="M3 16h12" strokeWidth="2.4" opacity=".45" /></svg> },
  { id: 'eraser', key: 'e', label: 'Eraser', icon: <svg {...ico}><path d="M7 15h8" /><path d="M3.7 11.3l7-7.3a1.5 1.5 0 0 1 2.1 0l1.9 1.9a1.5 1.5 0 0 1 0 2.1L9 14.9H6.9z" /><path d="M6.6 8.3l4 4" /></svg> },
  { id: 'fill', key: 'f', label: 'Fill', icon: <svg {...ico}><path d="M8 2.5l6 6-5 5a1.5 1.5 0 0 1-2.1 0L3 9.6a1.5 1.5 0 0 1 0-2.1z" /><path d="M3.5 8.5h10" /><path d="M15.5 11.5s-1.3 1.6-1.3 2.5a1.3 1.3 0 0 0 2.6 0c0-.9-1.3-2.5-1.3-2.5z" fill="currentColor" /></svg> },
  { id: 'picker', key: 'i', label: 'Colour picker', icon: <svg {...ico}><path d="M11 4.2l2.8 2.8M12.3 2.9a1.6 1.6 0 0 1 2.3 0l.5.5a1.6 1.6 0 0 1 0 2.3l-1.4 1.4-2.8-2.8z" /><path d="M10.6 5.6l-7 7L3 15l2.4-.6 7-7" /></svg> },
  { id: 'text', key: 't', label: 'Text', icon: <svg {...ico}><path d="M4 4.5V3h10v1.5M9 3v12M7 15h4" /></svg> },
  { id: 'line', key: 'l', label: 'Line', icon: <svg {...ico}><path d="M3.5 14.5l11-11" /></svg> },
  { id: 'arrow', key: 'a', label: 'Arrow', icon: <svg {...ico}><path d="M3.5 14.5l11-11M8.5 3.5h6v6" /></svg> },
  { id: 'rect', key: 'r', label: 'Rectangle', icon: <svg {...ico}><rect x="3" y="4.5" width="12" height="9" rx="1" /></svg> },
  { id: 'ellipse', key: 'o', label: 'Ellipse', icon: <svg {...ico}><ellipse cx="9" cy="9" rx="6.2" ry="4.8" /></svg> },
];
const SHAPES = ['line', 'arrow', 'rect', 'ellipse'];
const BRUSHES = ['pen', 'marker', 'eraser'];

const IconUndo = () => <svg {...ico}><path d="M6.5 4L3 7.5 6.5 11" /><path d="M3 7.5h7.5a4 4 0 0 1 0 8H8" /></svg>;
const IconRedo = () => <svg {...ico}><path d="M11.5 4L15 7.5 11.5 11" /><path d="M15 7.5H7.5a4 4 0 0 0 0 8H10" /></svg>;
const IconImage = () => <svg {...ico}><rect x="2.5" y="3.5" width="13" height="11" rx="1.5" /><circle cx="6.5" cy="7.5" r="1.3" /><path d="M15.5 12l-3.8-3.8-6.7 6.3" /></svg>;
const IconSave = () => <svg {...ico}><path d="M9 3v8M5.5 7.5L9 11l3.5-3.5" /><path d="M3 12.5v1.5a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5v-1.5" /></svg>;
const IconFull = () => <svg {...ico}><path d="M3 7V3h4M11 3h4v4M15 11v4h-4M7 15H3v-4" /></svg>;
const IconExitFull = () => <svg {...ico}><path d="M7 3v4H3M15 7h-4V3M11 15v-4h4M3 11h4v4" /></svg>;
const IconMin = () => <svg {...ico}><path d="M4.5 9h9" /></svg>;
const IconMax = () => <svg {...ico}><rect x="4" y="4" width="10" height="10" rx="1" /></svg>;
const IconPage = () => <svg {...ico}><path d="M4.5 2.5h6l3 3v10h-9z" /><path d="M9 8.5v5M6.5 11h5" /></svg>;

const brushWidth = (tool, size) => (tool === 'eraser' ? size * 3 + 4 : tool === 'marker' ? size * 3 + 6 : size);
const textSize = (size) => 14 + size * 2;
const fontFamily = (font) => (font === 'hand' ? "'Caveat Variable', 'Segoe Print', cursive" : "'Figtree Variable', 'Segoe UI', sans-serif");
const fontWeight = (font) => (font === 'hand' ? 600 : 500);
const isTyping = (el) =>
  el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && el.type !== 'range' && el.type !== 'color'));

export default function Notepad() {
  const api = window.sticky.notepad;

  const wrapRef = useRef(null); // scrolling viewport
  const paperRef = useRef(null);
  const baseRef = useRef(null);
  const overlayRef = useRef(null);
  const cursorRef = useRef(null);
  const floatCanvasRef = useRef(null);
  const textRef = useRef(null);
  const fileRef = useRef(null);

  const [tool, setToolState] = useState('pen');
  const [color, setColor] = useState('#27304a');
  const [size, setSize] = useState(4);
  const [fillShapes, setFillShapes] = useState(false);
  const [font, setFont] = useState('hand');
  const [paper, setPaper] = useState('lined');
  const [page, setPage] = useState({ w: 0, h: 0 });
  const [hist, setHist] = useState({ undo: 0, redo: 0 });
  const [floating, setFloatingState] = useState(null); // { canvas, x, y, w, h, lifted }
  const [textBox, setTextBox] = useState(null); // { x, y, value }
  const [status, setStatus] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState('');

  const pageRef = useRef({ w: 0, h: 0 });
  const floatRef = useRef(null);
  const textBoxRef = useRef(null);
  const paperStyleRef = useRef('lined');
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const dragRef = useRef(null); // the gesture in progress
  const dirtyRef = useRef(false);
  const saveTimer = useRef(null);
  const savingRef = useRef(Promise.resolve());
  const historyChain = useRef(Promise.resolve());
  const prevToolRef = useRef('pen');

  textBoxRef.current = textBox;
  paperStyleRef.current = paper;

  const setFloating = (f) => {
    floatRef.current = f;
    setFloatingState(f);
  };

  const baseCtx = () => {
    const ctx = baseRef.current.getContext('2d');
    ctx.setTransform(R, 0, 0, R, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return ctx;
  };
  const overlayCtx = () => {
    const ctx = overlayRef.current.getContext('2d');
    ctx.setTransform(R, 0, 0, R, 0, 0);
    return ctx;
  };
  const clearOverlay = () => {
    const c = overlayRef.current;
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
  };

  // ------------------------------------------------------------ page size ---

  const redrawPaper = useCallback(() => {
    const c = paperRef.current;
    if (!c || !c.width) return;
    const ctx = c.getContext('2d');
    ctx.setTransform(R, 0, 0, R, 0, 0);
    paintPaper(ctx, pageRef.current.w, pageRef.current.h, paperStyleRef.current);
  }, []);

  /** Grow the page (never shrink it) to at least this size, keeping the drawing. */
  const ensurePage = useCallback(
    (minW, minH) => {
      const cur = pageRef.current;
      const w = Math.min(MAX_SIDE, Math.max(cur.w, Math.ceil(minW)));
      const maxH = Math.floor(MAX_AREA / (w * R * R));
      const h = Math.min(MAX_SIDE, maxH, Math.max(cur.h, Math.ceil(minH)));
      if (w === cur.w && h === cur.h) return false;
      const base = baseRef.current;
      let copy = null;
      if (base.width && base.height) {
        copy = document.createElement('canvas');
        copy.width = base.width;
        copy.height = base.height;
        copy.getContext('2d').drawImage(base, 0, 0);
      }
      for (const c of [paperRef.current, base, overlayRef.current]) {
        c.width = Math.round(w * R);
        c.height = Math.round(h * R);
      }
      if (copy) base.getContext('2d').drawImage(copy, 0, 0);
      pageRef.current = { w, h };
      setPage({ w, h });
      redrawPaper();
      return true;
    },
    [redrawPaper],
  );

  // ---------------------------------------------------------------- saving ---

  const save = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    savingRef.current = savingRef.current.then(async () => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      setStatus('Saving…');
      try {
        const image = await canvasPng(baseRef.current);
        const { w, h } = pageRef.current;
        const ok = await api.save({ image, width: w, height: h, paper: paperStyleRef.current });
        if (!ok) throw new Error('not saved');
        setStatus(dirtyRef.current ? '' : 'Saved');
      } catch {
        dirtyRef.current = true;
        setStatus("Couldn't save");
      }
    });
    return savingRef.current;
  }, [api]);

  const changed = useCallback(() => {
    dirtyRef.current = true;
    setStatus('');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, SAVE_DELAY);
  }, [save]);

  // --------------------------------------------------------------- history ---

  const snapshot = () => new Promise((resolve) => baseRef.current.toBlob(resolve, 'image/png'));
  const syncHist = () => setHist({ undo: undoRef.current.length, redo: redoRef.current.length });

  /** Call before changing the drawing, so the change can be undone. */
  const pushUndo = () => {
    undoRef.current.push(snapshot());
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
    redoRef.current = [];
    syncHist();
  };

  const restore = async (blobPromise) => {
    const blob = await blobPromise;
    const bmp = blob ? await createImageBitmap(blob) : null;
    const c = baseRef.current;
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, c.width, c.height);
    if (bmp) {
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
    }
    changed();
  };

  // ------------------------------------------------ floating pictures, text ---

  /** Put a pasted picture or a moved selection down onto the page. */
  const commitFloating = () => {
    const f = floatRef.current;
    if (!f) return;
    if (!f.lifted) pushUndo(); // a selection recorded its undo step when it was lifted
    baseCtx().drawImage(f.canvas, f.x, f.y, f.w, f.h);
    setFloating(null);
    changed();
  };

  const discardFloating = () => {
    const f = floatRef.current;
    if (!f) return;
    setFloating(null);
    if (f.lifted) changed(); // the hole it left is the change
  };

  const commitText = async () => {
    const box = textBoxRef.current;
    if (!box) return;
    textBoxRef.current = null;
    setTextBox(null);
    if (!box.value.trim()) return;
    const fs = textSize(box.size);
    const family = fontFamily(box.font);
    const weight = fontWeight(box.font);
    try {
      await document.fonts.load(`${weight} ${fs}px ${family}`);
    } catch {
      // fall back to whatever font is available
    }
    pushUndo();
    const ctx = baseCtx();
    ctx.font = `${weight} ${fs}px ${family}`;
    ctx.fillStyle = box.color;
    ctx.textBaseline = 'middle';
    const lh = fs * 1.25;
    box.value.split('\n').forEach((line, i) => {
      ctx.fillText(line, box.x + 5, box.y + 3 + i * lh + lh / 2);
    });
    changed();
  };

  /** Finish whatever is half-done (a floating picture, a text box). */
  const settle = async () => {
    commitFloating();
    await commitText();
  };

  const setTool = (next) => {
    if (next === tool) return;
    settle();
    if (next === 'picker') prevToolRef.current = tool;
    setToolState(next);
  };

  /** Show a picture (pasted, dropped or inserted) as a floating selection at `at`, or at the top of the view. */
  const placePicture = async (blob, at) => {
    let bmp;
    try {
      bmp = await createImageBitmap(blob);
    } catch {
      setStatus("That picture couldn't be opened");
      return;
    }
    await settle();
    const wrap = wrapRef.current;
    const viewW = wrap.clientWidth;
    const viewH = wrap.clientHeight;
    const scale = Math.min(1, (viewW * 0.8) / bmp.width, (viewH * 0.8) / bmp.height);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    const x = at ? at.x - w / 2 : wrap.scrollLeft + 24;
    const y = at ? at.y - h / 2 : wrap.scrollTop + 24;
    ensurePage(x + w, y + h);
    setFloating({ canvas: c, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)), w, h, lifted: false });
    setToolState('select');
  };

  /** Lift part of the drawing into a floating selection that can be moved, resized, copied or deleted. */
  const liftSelection = (x, y, w, h) => {
    const { w: pw, h: ph } = pageRef.current;
    x = Math.max(0, Math.round(x));
    y = Math.max(0, Math.round(y));
    w = Math.min(pw - x, Math.round(w));
    h = Math.min(ph - y, Math.round(h));
    if (w < 2 || h < 2) return;
    pushUndo();
    const c = document.createElement('canvas');
    c.width = Math.round(w * R);
    c.height = Math.round(h * R);
    c.getContext('2d').drawImage(baseRef.current, x * R, y * R, w * R, h * R, 0, 0, c.width, c.height);
    baseCtx().clearRect(x, y, w, h);
    setFloating({ canvas: c, x, y, w, h, lifted: true });
  };

  const copyFloating = async () => {
    const f = floatRef.current;
    if (!f) return false;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(f.w * R));
    c.height = Math.max(1, Math.round(f.h * R));
    c.getContext('2d').drawImage(f.canvas, 0, 0, c.width, c.height);
    api.copyPng(await canvasPng(c));
    return true;
  };

  // ------------------------------------------------------- pointer drawing ---

  const toPage = (e) => {
    const rect = baseRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * pageRef.current.w) / rect.width,
      y: ((e.clientY - rect.top) * pageRef.current.h) / rect.height,
    };
  };

  const moveCursor = (e) => {
    const el = cursorRef.current;
    if (!el) return;
    if (!BRUSHES.includes(tool)) {
      el.style.display = 'none';
      return;
    }
    const p = toPage(e);
    const d = brushWidth(tool, size);
    el.style.display = 'block';
    el.style.width = `${d}px`;
    el.style.height = `${d}px`;
    el.style.transform = `translate(${p.x - d / 2}px, ${p.y - d / 2}px)`;
  };

  const strokeSegment = (ctx, g, p, pressure) => {
    const mid = { x: (g.last.x + p.x) / 2, y: (g.last.y + p.y) / 2 };
    ctx.lineWidth = g.width * pressure;
    ctx.beginPath();
    ctx.moveTo(g.mid.x, g.mid.y);
    ctx.quadraticCurveTo(g.last.x, g.last.y, mid.x, mid.y);
    ctx.stroke();
    g.last = p;
    g.mid = mid;
  };

  const drawMarkerPreview = (g) => {
    clearOverlay();
    const ctx = overlayCtx();
    ctx.strokeStyle = g.color;
    ctx.lineWidth = g.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(g.points[0].x, g.points[0].y);
    if (g.points.length === 1) ctx.lineTo(g.points[0].x + 0.01, g.points[0].y);
    for (let i = 1; i < g.points.length; i++) ctx.lineTo(g.points[i].x, g.points[i].y);
    ctx.stroke();
  };

  const pressureOf = (e) => (e.pointerType === 'pen' && e.pressure > 0 ? 0.35 + e.pressure * 1.1 : 1);

  const onPointerDown = (e) => {
    if (!ready || (e.button !== 0 && e.pointerType === 'mouse')) return;
    e.preventDefault();
    const p = toPage(e);

    // Clicking off a floating picture or text box puts it down, like Paint.
    if (floatRef.current) {
      commitFloating();
      if (tool !== 'select') return;
    }
    if (textBoxRef.current) {
      commitText();
      return;
    }

    if (tool === 'text') {
      setTextBox({ x: Math.round(p.x), y: Math.round(p.y - textSize(size) * 0.65), value: '', color, size, font });
      return;
    }
    if (tool === 'fill') {
      pushUndo();
      const n = floodFill(baseRef.current, p.x * R, p.y * R, hexToRgba(color));
      if (n) changed();
      else {
        undoRef.current.pop();
        syncHist();
      }
      return;
    }
    if (tool === 'picker') {
      const px = baseRef.current.getContext('2d').getImageData(Math.floor(p.x * R), Math.floor(p.y * R), 1, 1).data;
      if (px[3] > 0) setColor(rgbToHex(px[0], px[1], px[2]));
      setToolState(prevToolRef.current === 'picker' ? 'pen' : prevToolRef.current);
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    const g = { tool, start: p, last: p, mid: p, points: [p], color, width: brushWidth(tool, size), maxY: p.y };
    dragRef.current = g;

    if (tool === 'pen' || tool === 'eraser') {
      pushUndo();
      const ctx = baseCtx();
      ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const dot = (g.width * pressureOf(e)) / 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, dot), 0, Math.PI * 2);
      ctx.fill();
      g.ctx = ctx;
    } else if (tool === 'marker') {
      drawMarkerPreview(g);
    }
  };

  const onPointerMove = (e) => {
    moveCursor(e);
    const g = dragRef.current;
    if (!g) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    if (g.tool === 'pen' || g.tool === 'eraser') {
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const p = toPage(ev);
        g.maxY = Math.max(g.maxY, p.y);
        strokeSegment(g.ctx, g, p, pressureOf(ev));
      }
      return;
    }
    const p = toPage(e);
    g.maxY = Math.max(g.maxY, p.y);
    if (g.tool === 'marker') {
      for (const ev of events.length ? events : [e.nativeEvent]) g.points.push(toPage(ev));
      drawMarkerPreview(g);
    } else if (SHAPES.includes(g.tool)) {
      g.end = e.shiftKey ? constrain(g.tool, g.start, p) : p;
      clearOverlay();
      drawShape(overlayCtx(), g.tool, g.start, g.end, { color: g.color, width: size, fill: fillShapes });
    } else if (g.tool === 'select') {
      g.end = p;
      clearOverlay();
      const ctx = overlayCtx();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#3550a8';
      ctx.fillStyle = 'rgba(53, 80, 168, 0.06)';
      const x = Math.min(g.start.x, p.x);
      const y = Math.min(g.start.y, p.y);
      ctx.fillRect(x, y, Math.abs(p.x - g.start.x), Math.abs(p.y - g.start.y));
      ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(p.x - g.start.x), Math.abs(p.y - g.start.y));
    }
  };

  const onPointerUp = (e) => {
    const g = dragRef.current;
    if (!g) return;
    dragRef.current = null;
    if (g.tool === 'pen' || g.tool === 'eraser') {
      g.ctx.globalCompositeOperation = 'source-over';
      changed();
    } else if (g.tool === 'marker') {
      pushUndo();
      const ctx = baseRef.current.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 0.38;
      ctx.globalCompositeOperation = 'multiply'; // like real highlighter ink: dark lines stay dark
      ctx.drawImage(overlayRef.current, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      clearOverlay();
      changed();
    } else if (SHAPES.includes(g.tool)) {
      clearOverlay();
      if (g.end && Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) > 1) {
        pushUndo();
        drawShape(baseCtx(), g.tool, g.start, g.end, { color: g.color, width: size, fill: fillShapes });
        changed();
      }
    } else if (g.tool === 'select') {
      clearOverlay();
      if (g.end) {
        liftSelection(
          Math.min(g.start.x, g.end.x),
          Math.min(g.start.y, g.end.y),
          Math.abs(g.end.x - g.start.x),
          Math.abs(g.end.y - g.start.y),
        );
      }
    }
    // Drawing near the bottom edge adds more paper below, like turning a page.
    if (g.tool !== 'select' && g.maxY > pageRef.current.h - 80) ensurePage(pageRef.current.w, pageRef.current.h + 480);
    if (e?.currentTarget?.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // ------------------------------------------- moving / resizing a selection ---

  const onFloatDown = (e, handle) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const f = floatRef.current;
    dragRef.current = { tool: 'float', handle, start: toPage(e), orig: { ...f } };
  };

  const onFloatMove = (e) => {
    const g = dragRef.current;
    if (!g || g.tool !== 'float') return;
    e.stopPropagation();
    const p = toPage(e);
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    const o = g.orig;
    let { x, y, w, h } = o;
    if (g.handle === 'move') {
      x = o.x + dx;
      y = o.y + dy;
    } else {
      const left = g.handle.includes('w');
      const top = g.handle.includes('n');
      w = Math.max(8, o.w + (left ? -dx : dx));
      h = Math.max(8, o.h + (top ? -dy : dy));
      if (!e.shiftKey) {
        // keep the picture's proportions unless Shift is held
        const ratio = o.w / o.h;
        if (w / h > ratio) h = w / ratio;
        else w = h * ratio;
      }
      x = left ? o.x + o.w - w : o.x;
      y = top ? o.y + o.h - h : o.y;
    }
    setFloating({ ...floatRef.current, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
  };

  const onFloatUp = (e) => {
    const g = dragRef.current;
    if (!g || g.tool !== 'float') return;
    e.stopPropagation();
    dragRef.current = null;
    const f = floatRef.current;
    if (f) ensurePage(f.x + f.w, f.y + f.h);
  };

  // ------------------------------------------------------------ commands ---

  const undo = () =>
    (historyChain.current = historyChain.current.then(async () => {
      await settle();
      if (!undoRef.current.length) return;
      const prev = undoRef.current.pop();
      redoRef.current.push(snapshot());
      syncHist();
      await restore(prev);
    }));

  const redo = () =>
    (historyChain.current = historyChain.current.then(async () => {
      await settle();
      if (!redoRef.current.length) return;
      const next = redoRef.current.pop();
      undoRef.current.push(snapshot());
      syncHist();
      await restore(next);
    }));

  const clearPage = async () => {
    await settle();
    pushUndo();
    const c = baseRef.current;
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    changed();
    setStatus('Page cleared (Ctrl+Z to undo)');
  };

  const morePaper = () => {
    const wrap = wrapRef.current;
    if (ensurePage(pageRef.current.w, pageRef.current.h + wrap.clientHeight)) {
      changed();
      requestAnimationFrame(() => wrap.scrollTo({ top: wrap.scrollHeight, behavior: 'smooth' }));
    }
  };

  const exportPicture = async () => {
    await settle();
    const { w, h } = pageRef.current;
    const c = document.createElement('canvas');
    c.width = baseRef.current.width;
    c.height = baseRef.current.height;
    const ctx = c.getContext('2d');
    ctx.setTransform(R, 0, 0, R, 0, 0);
    paintPaper(ctx, w, h, paperStyleRef.current);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(baseRef.current, 0, 0);
    try {
      const result = await api.exportPng(await canvasPng(c));
      if (result === 'saved') setStatus('Picture saved');
      else if (result === 'failed') setStatus("Couldn't save the picture");
    } catch {
      setStatus("Couldn't save the picture");
    }
  };

  const toggleFullScreen = () => api.setFullScreen(!fullscreen);

  /** Save everything, then let the window close. */
  const flushAndClose = async () => {
    await settle();
    if (dirtyRef.current || saveTimer.current) await save();
    else await savingRef.current;
    api.close();
  };

  const changePaper = (next) => {
    setPaper(next);
    paperStyleRef.current = next;
    redrawPaper();
    changed();
  };

  // --------------------------------------------------------- lifecycle ---

  // Load the saved drawing once the page has a size.
  useLayoutEffect(() => {
    let alive = true;
    const wrap = wrapRef.current;
    ensurePage(wrap.clientWidth, wrap.clientHeight);
    api
      .load()
      .then(async (saved) => {
        if (!alive || !saved) return;
        setTitle(saved.title ?? '');
        paperStyleRef.current = saved.paper;
        setPaper(saved.paper);
        ensurePage(saved.width, saved.height);
        redrawPaper();
        if (saved.image && saved.width && saved.height) {
          const bmp = await createImageBitmap(new Blob([saved.image], { type: 'image/png' }));
          const ctx = baseCtx();
          ctx.drawImage(bmp, 0, 0, saved.width, saved.height);
          bmp.close();
        }
      })
      .catch(() => setStatus("Couldn't open the saved drawing"))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A bigger window (or full screen) gets more paper.
  useEffect(() => {
    const wrap = wrapRef.current;
    const ro = new ResizeObserver(() => ensurePage(wrap.clientWidth, wrap.clientHeight));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [ensurePage]);

  useEffect(() => api.onFullScreen(setFullscreen), [api]);

  useEffect(() => {
    document.title = title.trim() || 'Notepad';
  }, [title]);

  const rename = (value) => {
    setTitle(value);
    api.rename(value);
  };

  // Changing the colour, size or font while typing restyles the text box.
  useEffect(() => {
    const box = textBoxRef.current;
    if (box && (box.color !== color || box.size !== size || box.font !== font)) setTextBox({ ...box, color, size, font });
  }, [color, size, font]);

  // Handlers that need the latest state, used by window-level listeners.
  const live = useRef({});
  live.current = { flushAndClose, save, placePicture, onKey: null };

  useEffect(() => {
    const offFlush = api.onFlush(() => live.current.flushAndClose());
    const onBlur = () => {
      if (dirtyRef.current) live.current.save();
    };
    const onPaste = (e) => {
      if (isTyping(e.target)) return;
      const items = [...(e.clipboardData?.items ?? [])];
      const img = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
      if (img) {
        e.preventDefault();
        live.current.placePicture(img.getAsFile());
        return;
      }
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        e.preventDefault();
        live.current.pasteText(text);
      }
    };
    const onKeyDown = (e) => live.current.onKey(e);
    window.addEventListener('blur', onBlur);
    document.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      offFlush();
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [api]);

  live.current.pasteText = async (text) => {
    await settle();
    const wrap = wrapRef.current;
    setToolState('text');
    setTextBox({ x: wrap.scrollLeft + 80, y: wrap.scrollTop + 80, value: text.slice(0, 5000), color, size, font });
  };

  live.current.onKey = (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'F11') {
      e.preventDefault();
      toggleFullScreen();
      return;
    }
    if (isTyping(e.target)) {
      if (e.target === textRef.current && (e.key === 'Escape' || (e.key === 'Enter' && ctrl))) {
        e.preventDefault();
        commitText();
      }
      return;
    }
    const k = e.key.toLowerCase();
    if (ctrl && k === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
    } else if (ctrl && k === 's') {
      e.preventDefault();
      exportPicture();
    } else if (ctrl && k === 'a') {
      e.preventDefault();
      commitFloating();
      setToolState('select');
      liftSelection(0, 0, pageRef.current.w, pageRef.current.h);
    } else if (ctrl && (k === 'c' || k === 'x') && floatRef.current) {
      e.preventDefault();
      copyFloating().then(() => k === 'x' && discardFloating());
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && floatRef.current) {
      e.preventDefault();
      discardFloating();
    } else if (e.key === 'Enter' && floatRef.current) {
      e.preventDefault();
      commitFloating();
    } else if (e.key === 'Escape') {
      if (floatRef.current) commitFloating();
      else if (fullscreen) api.setFullScreen(false);
    } else if (!ctrl && !e.altKey) {
      const t = TOOLS.find((x) => x.key === k);
      if (t) setTool(t.id);
      else if (e.key === '[') setSize((s) => Math.max(1, s - 1));
      else if (e.key === ']') setSize((s) => Math.min(40, s + 1));
    }
  };

  // Draw the floating picture into its own little canvas.
  useEffect(() => {
    const el = floatCanvasRef.current;
    if (!el || !floating) return;
    if (el.width !== floating.canvas.width || el.height !== floating.canvas.height || el.__src !== floating.canvas) {
      el.width = floating.canvas.width;
      el.height = floating.canvas.height;
      el.getContext('2d').drawImage(floating.canvas, 0, 0);
      el.__src = floating.canvas;
    }
  }, [floating]);

  useEffect(() => {
    if (textBox) requestAnimationFrame(() => textRef.current?.focus());
  }, [textBox?.x, textBox?.y]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!status || status === 'Saving…') return undefined;
    const t = setTimeout(() => setStatus(''), 2600);
    return () => clearTimeout(t);
  }, [status]);

  // ---------------------------------------------------------------- view ---

  const onDrop = (e) => {
    e.preventDefault();
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) placePicture(file, toPage(e));
  };

  const textLines = textBox ? textBox.value.split('\n') : [];
  const textFs = textBox ? textSize(textBox.size) : 0;
  const isShape = SHAPES.includes(tool);

  return (
    <div className={`np-shell${fullscreen ? ' is-fullscreen' : ''}`}>
      <header className="np-header">
        {/* The title can be renamed, like a sticky note's. The sizer keeps the field as wide as its text. */}
        <span className="np-title-sizer" data-value={title || 'Notepad'}>
          <input
            className="np-title"
            value={title}
            maxLength={80}
            placeholder="Notepad"
            spellCheck={false}
            aria-label="Notepad title"
            title="Rename this notepad"
            onChange={(e) => rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
            }}
          />
        </span>
        <span className="np-status" role="status">{status}</span>
        <span className="header-spacer" />
        <div className="np-group">
          <button type="button" className="np-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!hist.undo} onClick={undo}>
            <IconUndo />
          </button>
          <button type="button" className="np-btn" title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!hist.redo} onClick={redo}>
            <IconRedo />
          </button>
        </div>
        <div className="np-group">
          <button type="button" className="np-btn" title="Insert a picture (or paste one with Ctrl+V, or drop it here)" aria-label="Insert picture" onClick={() => fileRef.current.click()}>
            <IconImage />
          </button>
          <button type="button" className="np-btn" title="Save as a picture (Ctrl+S)" aria-label="Save as picture" onClick={exportPicture}>
            <IconSave />
          </button>
        </div>
        <div className="np-group">
          <button type="button" className="np-btn" title={fullscreen ? 'Exit full screen (F11)' : 'Full screen (F11)'} aria-label={fullscreen ? 'Exit full screen' : 'Full screen'} onClick={toggleFullScreen}>
            {fullscreen ? <IconExitFull /> : <IconFull />}
          </button>
          {!fullscreen && (
            <>
              <button type="button" className="np-btn" title="Minimize" aria-label="Minimize" onClick={() => api.minimize()}>
                <IconMin />
              </button>
              <button type="button" className="np-btn" title="Maximize" aria-label="Maximize" onClick={() => api.toggleMaximize()}>
                <IconMax />
              </button>
            </>
          )}
          <button type="button" className="np-btn np-close" title="Close (find it again under Hidden notes; your drawing is saved)" aria-label="Close Notepad" onClick={flushAndClose}>
            <IconClose />
          </button>
        </div>
      </header>

      <div className="np-toolbar" role="toolbar" aria-label="Drawing tools">
        <div className="np-tools" role="radiogroup" aria-label="Tool">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={tool === t.id}
              className={tool === t.id ? 'np-tool is-active' : 'np-tool'}
              title={`${t.label} (${t.key.toUpperCase()})`}
              aria-label={t.label}
              onClick={() => setTool(t.id)}
            >
              {t.icon}
            </button>
          ))}
        </div>

        <span className="np-sep" />

        <label className="np-size" title="Size ([ and ])">
          <span className="np-size-dot" style={{ width: Math.min(22, 3 + size / 2), height: Math.min(22, 3 + size / 2), background: color }} />
          <input type="range" min={1} max={40} value={size} aria-label="Size" onChange={(e) => setSize(Number(e.target.value))} />
          <span className="np-size-num">{size}</span>
        </label>

        {isShape && (
          <button type="button" className={fillShapes ? 'np-chip is-active' : 'np-chip'} aria-pressed={fillShapes} onClick={() => setFillShapes((f) => !f)} title="Fill rectangles and ellipses">
            Filled
          </button>
        )}
        {tool === 'text' && (
          <div className="np-seg" role="group" aria-label="Font">
            <button type="button" className={font === 'hand' ? 'is-active' : ''} aria-pressed={font === 'hand'} onClick={() => setFont('hand')} style={{ fontFamily: fontFamily('hand'), fontSize: 16 }}>
              Hand
            </button>
            <button type="button" className={font === 'ui' ? 'is-active' : ''} aria-pressed={font === 'ui'} onClick={() => setFont('ui')}>
              Clean
            </button>
          </div>
        )}

        <span className="np-sep" />

        <div className="np-colors" role="radiogroup" aria-label="Colour">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c}
              title={c}
              className={color === c ? 'np-swatch is-active' : 'np-swatch'}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
          <label className="np-custom" title="More colours">
            <span style={{ background: COLORS.includes(color) ? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' : color }} />
            <input type="color" value={color} aria-label="Custom colour" onChange={(e) => setColor(e.target.value)} />
          </label>
        </div>

        <span className="np-sep" />

        <select className="np-select" value={paper} aria-label="Paper" title="Paper" onChange={(e) => changePaper(e.target.value)}>
          {PAPERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} paper
            </option>
          ))}
        </select>
        <button type="button" className="np-btn" title="More paper (adds space below)" aria-label="More paper" onClick={morePaper}>
          <IconPage />
        </button>
        <button type="button" className="np-btn danger" title="Clear the page" aria-label="Clear the page" onClick={clearPage}>
          <IconTrash />
        </button>
      </div>

      <div className="np-wrap" ref={wrapRef} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div
          className={`np-page tool-${tool}`}
          style={{ width: page.w, height: page.h }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => cursorRef.current && (cursorRef.current.style.display = 'none')}
        >
          <canvas ref={paperRef} className="np-canvas" style={{ width: page.w, height: page.h }} />
          <canvas ref={baseRef} className="np-canvas" style={{ width: page.w, height: page.h }} />
          <canvas
            ref={overlayRef}
            className="np-canvas"
            style={{ width: page.w, height: page.h, opacity: tool === 'marker' ? 0.38 : 1 }}
          />
          <div ref={cursorRef} className={`np-cursor${tool === 'eraser' ? ' is-eraser' : ''}`} />

          {floating && (
            <div
              className="np-float"
              style={{ left: floating.x, top: floating.y, width: floating.w, height: floating.h }}
              onPointerDown={(e) => onFloatDown(e, 'move')}
              onPointerMove={onFloatMove}
              onPointerUp={onFloatUp}
              onPointerCancel={onFloatUp}
              title="Drag to move · corners resize (Shift: free) · Enter to place · Delete to remove · Ctrl+C to copy"
            >
              <canvas ref={floatCanvasRef} />
              {['nw', 'ne', 'sw', 'se'].map((h) => (
                <span key={h} className={`np-handle h-${h}`} onPointerDown={(e) => onFloatDown(e, h)} onPointerMove={onFloatMove} onPointerUp={onFloatUp} />
              ))}
            </div>
          )}

          {textBox && (
            <textarea
              ref={textRef}
              className="np-text"
              spellCheck
              value={textBox.value}
              placeholder="Type here…"
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setTextBox({ ...textBox, value: e.target.value })}
              style={{
                left: textBox.x,
                top: textBox.y,
                color: textBox.color,
                fontFamily: fontFamily(textBox.font),
                fontWeight: fontWeight(textBox.font),
                fontSize: textFs,
                lineHeight: `${textFs * 1.25}px`,
                width: Math.max(180, Math.max(...textLines.map((l) => l.length)) * textFs * 0.62 + 24),
                height: textLines.length * textFs * 1.25 + 8,
              }}
            />
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) placePicture(file);
        }}
      />
    </div>
  );
}
