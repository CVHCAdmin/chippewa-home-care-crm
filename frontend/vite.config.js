// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
  optimizeDeps: {
    exclude: ['@capacitor-community/background-geolocation'],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      external: ['@capacitor-community/background-geolocation'],
    },
  },
  define: {
    // Don't wipe process.env — it prevents import.meta.env from working
    // Explicitly define the API URL so it's always baked into the build
    '__API_URL__': JSON.stringify('https://chippewa-home-care-api.onrender.com'),
  },
});
