/**
 * tests/setup.ts
 * Test Environment Setup for Vitest and Node.js
 */

// 1. Mock window.scrollTo and Element.prototype.scrollTo
if (typeof window !== 'undefined') {
  window.scrollTo = (() => {}) as any;
  if (typeof Element !== 'undefined') {
    Element.prototype.scrollTo = (() => {}) as any;
  }
}

// 2. Mock ResizeObserver
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

// 3. Mock IntersectionObserver
if (typeof window !== 'undefined' && !window.IntersectionObserver) {
  window.IntersectionObserver = class IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds = [0];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as any;
}
