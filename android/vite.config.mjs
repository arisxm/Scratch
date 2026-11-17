import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Builds the desktop app's React UI (../src, unchanged) for the Android app.
// The only difference from the desktop build is the entry page, web/index.html,
// which loads web/bridge.js first: it provides window.sticky (the API the
// Electron preload script gives the desktop app) on top of the native
// Android bridge. The output goes straight into the APK's assets.

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// Same policy as the desktop build. The pages are served from
// https://appassets.androidplatform.net by the app itself, so 'self' is the app.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const injectCsp = {
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
  ],
};

export default defineConfig({
  root: here('./web'),
  base: './',
  publicDir: false,
  plugins: [react(), injectCsp],
  build: {
    outDir: here('./app/src/main/assets/web'),
    emptyOutDir: true,
    target: 'chrome100', // Android System WebView updates itself; 100 is from 2022
    assetsInlineLimit: 0,
  },
});
