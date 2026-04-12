import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const projectRoot = __dirname;

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@": path.resolve(projectRoot, "src"),
        "@core": path.resolve(projectRoot, "../packages/benchlocal-core/src"),
        "@benchpack-host": path.resolve(projectRoot, "../packages/benchpack-host/src")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "index.js"
        }
      }
    },
    resolve: {
      alias: {
        "@": path.resolve(projectRoot, "src"),
        "@core": path.resolve(projectRoot, "../packages/benchlocal-core/src"),
        "@benchpack-host": path.resolve(projectRoot, "../packages/benchpack-host/src")
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        "@renderer": path.resolve(projectRoot, "src/renderer/src"),
        "@core": path.resolve(projectRoot, "../packages/benchlocal-core/src"),
        "@benchpack-host": path.resolve(projectRoot, "../packages/benchpack-host/src")
      }
    }
  }
});
