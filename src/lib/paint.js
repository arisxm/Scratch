// Drawing helpers for the Notepad: the paper backgrounds, shapes and the
// paint-bucket fill. Everything here works in page (CSS) pixels unless a
// function says otherwise; the caller sets the canvas transform.

export const PAPERS = [
  { id: 'lined', label: 'Lined' },
  { id: 'grid', label: 'Grid' },
  { id: 'dotted', label: 'Dotted' },
  { id: 'plain', label: 'Plain' },
];

const PAPER_BG = '#fffdf5';
const RULE = 'rgba(86, 132, 196, 0.38)';
const MARGIN = 'rgba(214, 86, 86, 0.55)';
export const LINE_GAP = 32; // lined paper: distance between rules
const TOP_GAP = 64; // lined paper: blank band at the top of the pad
const MARGIN_X = 64;
const GRID_GAP = 24;

/** Paint the paper itself (background colour and its rules) on a canvas already scaled to page pixels. */
export function paintPaper(ctx, w, h, paper) {
  ctx.fillStyle = PAPER_BG;
  ctx.fillRect(0, 0, w, h);
  if (paper === 'lined') {
    ctx.fillStyle = RULE;
    for (let y = TOP_GAP + LINE_GAP; y < h; y += LINE_GAP) ctx.fillRect(0, y, w, 1);
    ctx.fillStyle = MARGIN;
    ctx.fillRect(MARGIN_X, 0, 1.5, h);
    ctx.fillRect(MARGIN_X + 4, 0, 1, h);
  } else if (paper === 'grid') {
    ctx.fillStyle = 'rgba(86, 132, 196, 0.22)';
    for (let x = GRID_GAP; x < w; x += GRID_GAP) ctx.fillRect(x, 0, 1, h);
    for (let y = GRID_GAP; y < h; y += GRID_GAP) ctx.fillRect(0, y, w, 1);
    ctx.fillStyle = 'rgba(86, 132, 196, 0.2)';
    for (let x = GRID_GAP * 5; x < w; x += GRID_GAP * 5) ctx.fillRect(x, 0, 1, h);
    for (let y = GRID_GAP * 5; y < h; y += GRID_GAP * 5) ctx.fillRect(0, y, w, 1);
  } else if (paper === 'dotted') {
    ctx.fillStyle = 'rgba(70, 90, 130, 0.42)';
    for (let y = GRID_GAP; y < h; y += GRID_GAP) {
      for (let x = GRID_GAP; x < w; x += GRID_GAP) {
        ctx.beginPath();
        ctx.arc(x, y, 1.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** With Shift held: lines snap to 45°, rectangles and ellipses become squares and circles. */
export function constrain(kind, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (kind === 'line' || kind === 'arrow') {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + Math.sign(dx || 1) * side, y: a.y + Math.sign(dy || 1) * side };
}

export function drawShape(ctx, kind, a, b, { color, width, fill }) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'line' || kind === 'arrow') {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (kind === 'arrow' && (a.x !== b.x || a.y !== b.y)) {
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(12, width * 3.2);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - head * Math.cos(angle - Math.PI / 7), b.y - head * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(b.x - head * Math.cos(angle + Math.PI / 7), b.y - head * Math.sin(angle + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (kind === 'rect') {
    ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    if (fill) ctx.fill();
    ctx.stroke();
  } else if (kind === 'ellipse') {
    const rx = Math.abs(b.x - a.x) / 2;
    const ry = Math.abs(b.y - a.y) / 2;
    ctx.ellipse(Math.min(a.x, b.x) + rx, Math.min(a.y, b.y) + ry, rx, ry, 0, 0, Math.PI * 2);
    if (fill) ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

export function hexToRgba(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Paint-bucket fill on the canvas's raw pixels (device pixels, not page
 * pixels). Fills the area connected to (sx, sy) whose colour is within
 * `tolerance` of the clicked colour. Returns how many pixels changed.
 */
export function floodFill(canvas, sx, sy, rgba, tolerance = 48) {
  const W = canvas.width;
  const H = canvas.height;
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return 0;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const start = (sy * W + sx) * 4;
  const [tr, tg, tb, ta] = [d[start], d[start + 1], d[start + 2], d[start + 3]];
  const [fr, fg, fb, fa] = rgba;
  if (tr === fr && tg === fg && tb === fb && ta === fa) return 0;

  // The page is transparent where nothing is drawn: there, match by alpha alone.
  const match =
    ta === 0
      ? (i) => d[i + 3] <= tolerance
      : (i) =>
          Math.abs(d[i] - tr) <= tolerance &&
          Math.abs(d[i + 1] - tg) <= tolerance &&
          Math.abs(d[i + 2] - tb) <= tolerance &&
          Math.abs(d[i + 3] - ta) <= tolerance;

  const seen = new Uint8Array(W * H);
  const stack = [sx, sy];
  let count = 0;
  while (stack.length) {
    const y = stack.pop();
    let x = stack.pop();
    let p = y * W + x;
    while (x >= 0 && !seen[p] && match(p * 4)) {
      x--;
      p--;
    }
    x++;
    p++;
    let up = false;
    let down = false;
    while (x < W && !seen[p] && match(p * 4)) {
      const i = p * 4;
      d[i] = fr;
      d[i + 1] = fg;
      d[i + 2] = fb;
      d[i + 3] = fa;
      seen[p] = 1;
      count++;
      if (y > 0) {
        const q = p - W;
        if (!seen[q] && match(q * 4)) {
          if (!up) {
            stack.push(x, y - 1);
            up = true;
          }
        } else up = false;
      }
      if (y < H - 1) {
        const q = p + W;
        if (!seen[q] && match(q * 4)) {
          if (!down) {
            stack.push(x, y + 1);
            down = true;
          }
        } else down = false;
      }
      x++;
      p++;
    }
  }
  if (count) ctx.putImageData(img, 0, 0);
  return count;
}

/** PNG bytes of a canvas, for saving over IPC. */
export async function canvasPng(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('could not encode the drawing');
  return new Uint8Array(await blob.arrayBuffer());
}
