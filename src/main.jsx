import { createRoot } from 'react-dom/client';
import '@fontsource-variable/caveat';
import '@fontsource-variable/figtree';
import './styles/base.css';
import './styles/note.css';
import './styles/launcher.css';
import './styles/panels.css';
import NoteApp from './components/Note.jsx';
import Launcher from './components/Launcher.jsx';
import Manager from './components/Manager.jsx';
import Timer from './components/Timer.jsx';
import About from './components/About.jsx';
import Settings from './components/Settings.jsx';

const params = new URLSearchParams(window.location.search);
const view = params.get('view');
document.documentElement.dataset.view = view ?? 'none';

const root = createRoot(document.getElementById('root'));

function show() {
  if (view === 'launcher') root.render(<Launcher />);
  else if (view === 'manager') root.render(<Manager />);
  else if (view === 'timer') root.render(<Timer />);
  else if (view === 'about') root.render(<About />);
  else if (view === 'settings') root.render(<Settings />);
  else root.render(<NoteApp fresh={params.get('fresh') === '1'} />);
}

if (!window.sticky) {
  // Opened in a normal browser (e.g. visiting the dev server URL directly).
  root.render(
    <p className="outside-app">
      This page runs inside the Scratch desktop app. Start it with <code>npm run dev</code>.
    </p>,
  );
} else {
  // The Animations setting switches every window's motion on or off. Read it
  // before the first paint so a window doesn't animate in when it shouldn't.
  const applyMotion = (s) => {
    document.documentElement.dataset.motion = s.animations === false ? 'off' : 'on';
  };
  window.sticky.settings
    .get()
    .then(applyMotion)
    .catch(() => {})
    .finally(() => {
      window.sticky.settings.onChanged(applyMotion);
      show();
    });
}
