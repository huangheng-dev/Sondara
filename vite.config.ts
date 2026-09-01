import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const apiPort = Number(process.env.SONDARA_API_PORT || 4176)
const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'sondara-build-version',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ buildId, builtAt: new Date().toISOString() }),
        })
      },
    },
  ],
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
  },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    port: 4175,
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true } },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll('\\', '/')

          if (
            moduleId.includes('/node_modules/react/')
            || moduleId.includes('/node_modules/react-dom/')
            || moduleId.includes('/node_modules/react-router-dom/')
          ) {
            return 'vendor-react'
          }
          if (moduleId.includes('/node_modules/@tanstack/react-query/')) {
            return 'vendor-query'
          }
          if (
            moduleId.includes('/node_modules/lucide-react/')
            || moduleId.includes('/node_modules/zustand/')
          ) {
            return 'vendor-ui'
          }
          if (moduleId.includes('/node_modules/@ant-design/cssinjs/')) {
            return 'vendor-antd-css'
          }
          if (moduleId.includes('/node_modules/@rc-component/util/')) {
            return 'vendor-antd-runtime'
          }
        },
      },
    },
  },
})
