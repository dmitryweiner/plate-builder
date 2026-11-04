import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './pwa';

function fakeWindow() {
  let onLoad: (() => void) | undefined;
  return {
    addEventListener: vi.fn<(type: string, fn: () => void) => void>((_, fn) => (onLoad = fn)),
    load: () => onLoad?.(),
  };
}

describe('registerServiceWorker', () => {
  it('registers the worker next to the page after load', () => {
    const register = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve());
    const win = fakeWindow();
    registerServiceWorker({ serviceWorker: { register } }, win);
    expect(register).not.toHaveBeenCalled();
    win.load();
    expect(register).toHaveBeenCalledWith('./sw.js');
  });

  it('does nothing when service workers are not supported', () => {
    const win = fakeWindow();
    registerServiceWorker({}, win);
    expect(win.addEventListener).not.toHaveBeenCalled();
  });

  it('swallows registration errors', async () => {
    const win = fakeWindow();
    registerServiceWorker({ serviceWorker: { register: () => Promise.reject(new Error('nope')) } }, win);
    expect(() => win.load()).not.toThrow();
  });
});
