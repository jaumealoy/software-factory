import "@testing-library/jest-dom/vitest";
import { Headers, Request, Response } from "whatwg-fetch";

Object.assign(globalThis, { Headers, Request, Response });

if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.assign(globalThis, { ResizeObserver: ResizeObserverStub });
}
