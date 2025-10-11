import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/FloorTrace/',
  build: {
    rollupOptions: {
      output: {
        // Add hash to filenames for cache busting
        entryFileNames: `assets/[name].[hash].js`,
        chunkFileNames: `assets/[name].[hash].js`,
        assetFileNames: (assetInfo) => {
          // Don't hash the webmanifest file
          if (assetInfo.name === 'site.webmanifest') {
            return 'assets/[name].[ext]';
          }
          return 'assets/[name].[hash].[ext]';
        }
      }
    }
  }
})
