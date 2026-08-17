import "@testing-library/jest-dom/vitest";
import { Headers, Request, Response } from "whatwg-fetch";

Object.assign(globalThis, { Headers, Request, Response });
