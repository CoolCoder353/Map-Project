import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetFakeApi } from './fakeApi';
import { currentFakeMap } from './fakeMap';

// findBy/waitFor give up after 1 s by default; a busy CI machine can need longer.
configure({ asyncUtilTimeout: 5000 });

// The real map is MapLibre on WebGL, which jsdom can't run; every component gets the fake from
// test/fakeMap.ts instead. The map itself is covered by the Playwright suite.
vi.mock('../src/map/MapProvider', () => ({
  MapProvider: ({ children }: { children: unknown }) => children,
  useMapApi: () => currentFakeMap(),
}));

// jsdom has <dialog> but not its modal methods.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}
Element.prototype.scrollIntoView ??= () => undefined;
URL.createObjectURL ??= () => 'blob:test';
URL.revokeObjectURL ??= () => undefined;
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
})) as typeof window.matchMedia;
// Recharts measures its container.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  cleanup();
  resetFakeApi();
  localStorage.clear();
});
