/// <reference types="vite/client" />

import type { BenchLocalDesktopApi } from "@/shared/desktop-api";

declare global {
  interface Window {
    benchlocal: BenchLocalDesktopApi;
  }
}

export {};
