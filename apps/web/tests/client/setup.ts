import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, vi } from "vitest";
import i18n from "../../src/client/i18n.js";

const observers = new Set<ControlledIntersectionObserver>();

class ControlledIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[];
  readonly targets = new Set<Element>();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {}
  ) {
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? "0px";
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0];
    observers.add(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  intersect(target: Element, isIntersecting: boolean) {
    const bounds = target.getBoundingClientRect();
    this.callback([{
      boundingClientRect: bounds,
      intersectionRatio: isIntersecting ? 1 : 0,
      intersectionRect: isIntersecting ? bounds : new DOMRectReadOnly(),
      isIntersecting,
      rootBounds: null,
      target,
      time: performance.now()
    }], this);
  }
}

export const intersection = {
  intersect(target: Element, isIntersecting = true) {
    const observer = [...observers].find((candidate) => candidate.targets.has(target));
    if (!observer) throw new Error("Element is not observed");
    observer.intersect(target, isIntersecting);
  },
  reset() {
    for (const observer of [...observers]) observer.disconnect();
    observers.clear();
  }
};

class NoopResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, "IntersectionObserver", {
  configurable: true,
  value: ControlledIntersectionObserver,
  writable: true
});

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: NoopResizeObserver,
    writable: true
  });
}

if (!("PointerEvent" in globalThis)) {
  Object.defineProperty(globalThis, "PointerEvent", {
    configurable: true,
    value: MouseEvent,
    writable: true
  });
}

if (!("matchMedia" in window)) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false
    }),
    writable: true
  });
}

for (const [method, implementation] of [
  ["hasPointerCapture", () => false],
  ["setPointerCapture", () => undefined],
  ["releasePointerCapture", () => undefined],
  ["scrollIntoView", () => undefined]
] as const) {
  if (!(method in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, method, {
      configurable: true,
      value: implementation,
      writable: true
    });
  }
}

beforeAll(async () => {
  await i18n.changeLanguage("en-US");
  document.documentElement.lang = "en-US";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  intersection.reset();
  window.localStorage.clear();
});
