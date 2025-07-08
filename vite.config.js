import { defineConfig } from 'vite'
import react           from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        secure: false,
        rewrite: path => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('Proxying request:', req.method, req.url, '->', proxyReq.path)
          })
          proxy.on('error', (err) => {
            console.log('Proxy error:', err)
          })
        }
      }
    }
  },
  define: {
    'process.env': {
      VITE_API_BASE_URL: JSON.stringify('/api')
    }
  }
})
