interface ServiceWorkerHost {
  serviceWorker?: { register: (url: string) => Promise<unknown> };
}

/** Registers the offline worker once the page has loaded; failures only disable offline mode. */
export function registerServiceWorker(nav: ServiceWorkerHost, win: Pick<Window, 'addEventListener'>): void {
  const sw = nav.serviceWorker;
  if (!sw) return;
  win.addEventListener('load', () => {
    sw.register('./sw.js').catch(() => {});
  });
}
