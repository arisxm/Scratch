import { useEffect, useState } from 'react';
import { IconClose } from './icons.jsx';
import { closePanel } from '../lib/hooks.js';

// About Scratch: version, the people who made it, and the licence.
export default function About() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let alive = true;
    window.sticky.about.get().then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (info) document.title = `About ${info.name}`;
    const onKey = (e) => e.key === 'Escape' && closePanel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [info]);

  if (!info) return <div className="panel-shell" />;

  return (
    <div className="panel-shell">
      <section className="panel about paper-yellow" aria-label={`About ${info.name}`}>
        <header className="panel-header">
          <h1>About</h1>
          <span className="header-spacer" />
          <button type="button" className="icon-btn" aria-label="Close" title="Close" onClick={() => closePanel()}>
            <IconClose />
          </button>
        </header>

        <div className="about-body">
          <div className="about-title">
            <h2>{info.name}</h2>
            <p className="about-version">Version {info.version}</p>
          </div>

          <p className="about-tagline">Sticky-note to-do lists that stay on top of your other windows.</p>

          <div className="about-section">
            <h3>Developed by</h3>
            <ol className="about-people">
              {info.developers.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ol>
          </div>

          <footer className="about-footer">
            <p>
              © {info.year} · Open source under the {info.license}
            </p>
            {info.repository && (
              <button type="button" className="text-btn" onClick={() => window.sticky.about.openRepository()}>
                View on GitHub
              </button>
            )}
            <p className="about-runtime">{info.runtime}</p>
          </footer>
        </div>
      </section>
    </div>
  );
}
