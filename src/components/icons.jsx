const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

export const IconDrop = () => (
  <svg {...base}>
    <path d="M8 2.2c2.3 2.7 4 4.9 4 7a4 4 0 0 1-8 0c0-2.1 1.7-4.3 4-7Z" />
  </svg>
);

export const IconChevronUp = () => (
  <svg {...base}>
    <path d="M4 10l4-4 4 4" />
  </svg>
);

export const IconChevronDown = () => (
  <svg {...base}>
    <path d="M4 6l4 4 4-4" />
  </svg>
);

export const IconChevronLeft = () => (
  <svg {...base}>
    <path d="M10 4L6 8l4 4" />
  </svg>
);

export const IconChevronRight = () => (
  <svg {...base}>
    <path d="M6 4l4 4-4 4" />
  </svg>
);

export const IconClose = () => (
  <svg {...base}>
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
  </svg>
);

export const IconCalendar = () => (
  <svg {...base}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
  </svg>
);

export const IconMore = () => (
  <svg {...base} strokeWidth={2.4}>
    <path d="M4 8h.01M8 8h.01M12 8h.01" />
  </svg>
);

export const IconTimer = () => (
  <svg {...base}>
    <circle cx="8" cy="9" r="5" />
    <path d="M8 6.5V9l1.6 1.2M6.5 1.8h3" />
  </svg>
);

export const IconRestore = () => (
  <svg {...base}>
    <path d="M3 8a5 5 0 1 0 1.6-3.7" />
    <path d="M3 3v2.8h2.8" />
  </svg>
);

export const IconTrash = () => (
  <svg {...base}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8" />
  </svg>
);

export const IconArchive = () => (
  <svg {...base}>
    <rect x="2.5" y="3" width="11" height="3" rx="0.8" />
    <path d="M3.5 6v6.5h9V6M6.5 9h3" />
  </svg>
);

export const IconPlay = () => (
  <svg {...base} fill="currentColor" stroke="none">
    <path d="M5 3.2v9.6a.5.5 0 0 0 .77.42l7.3-4.8a.5.5 0 0 0 0-.84l-7.3-4.8A.5.5 0 0 0 5 3.2Z" />
  </svg>
);

export const IconPause = () => (
  <svg {...base} strokeWidth={2.4}>
    <path d="M5.5 3.5v9M10.5 3.5v9" />
  </svg>
);

export const IconSkip = () => (
  <svg {...base}>
    <path d="M4 3.5l6 4.5-6 4.5zM12 3.5v9" />
  </svg>
);

export const IconMinus = () => (
  <svg {...base} strokeWidth={2}>
    <path d="M4 8h8" />
  </svg>
);

export const IconPlus = () => (
  <svg {...base} strokeWidth={2}>
    <path d="M8 4v8M4 8h8" />
  </svg>
);
