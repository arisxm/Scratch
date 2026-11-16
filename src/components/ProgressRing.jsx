const R = 7;
const C = 2 * Math.PI * R;

/** Small circular progress indicator: completed tasks out of all tasks. */
export default function ProgressRing({ done, total, size = 18 }) {
  const fraction = total ? done / total : 0;
  return (
    <svg
      className={fraction === 1 ? 'ring is-complete' : 'ring'}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role="img"
      aria-label={`${done} of ${total} tasks done (${Math.round(fraction * 100)}%)`}
    >
      <circle className="ring-track" cx="10" cy="10" r={R} />
      <circle
        className="ring-fill"
        cx="10"
        cy="10"
        r={R}
        strokeDasharray={C}
        strokeDashoffset={C * (1 - fraction)}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}
