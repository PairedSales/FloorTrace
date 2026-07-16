import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/FloorTrace/',
  // Honor an externally assigned port (e.g. parallel dev sessions); Vite
  // ignores the PORT env var by default.
  server: globalThis.process?.env?.PORT
    ? { port: Number(globalThis.process.env.PORT) }
    : undefined,
  build: {
    rollupOptions: {
      output: {
        // Add hash to filenames for cache busting
        entryFileNames: `assets/[name].[hash].js`,
        chunkFileNames: `assets/[name].[hash].js`,
        assetFileNames: `assets/[name].[hash].[ext]`,
        // Split heavy dependencies into separate chunks for faster initial load
        manualChunks: {
          'tesseract': ['tesseract.js'],
          'konva': ['konva', 'react-konva'],
        }
      }
    }
  }
})
