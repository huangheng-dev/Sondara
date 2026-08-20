import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 4175,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4176', changeOrigin: true } },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-ui': ['lucide-react', 'zustand'],
          'vendor-antd-css': ['@ant-design/cssinjs'],
          'vendor-antd-runtime': ['@rc-component/util'],
        },
      },
    },
  },
})
