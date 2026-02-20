// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
      output: {
        manualChunks: {
          // Split vendor libs into their own chunk
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Heavy admin components split separately
          'admin-scheduling': [
            './src/components/admin/SchedulingHub',
            './src/components/admin/DragDropScheduler',
            './src/components/admin/SmartScheduling',
            './src/components/admin/ScheduleCalendar',
          ],
          'admin-billing': [
            './src/components/admin/BillingDashboard',
            './src/components/admin/PayrollProcessing',
            './src/components/admin/ClaimsManagement',
          ],
          'admin-reports': [
            './src/components/admin/ReportsAnalytics',
            './src/components/admin/AuditLogs',
          ],
        },
      },
    },
  },
  define: {
    'process.env': {},
  },
});
