import './style.css';
import { startApp } from './app';
import { registerServiceWorker } from './pwa';
import { browserStorage } from './storage';
import { csgClient } from './worker/client';

const csg = csgClient();

startApp({
  storage: browserStorage(),
  languages: navigator.languages,
  ping: async () => {
    const done = await csg.run({ kind: 'ping' });
    if (!done) throw new Error('the ping was replaced');
    return { ms: done.ms };
  },
});
if (import.meta.env.PROD) registerServiceWorker(navigator, window);
