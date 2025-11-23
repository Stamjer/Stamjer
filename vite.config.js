/* eslint-env node */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import pwaManifest from './src/pwa/pwa-manifest.js'

const PWA_INCLUDE_ASSETS = [
  'favicon.ico',
  'fonts/Inter-400.woff2',
  'stam_H.png',
  'icons/96x96.png',
  'icons/192x192.png',
  'icons/512x512.png',
  'icons/720x1280.png',
  'icons/1280x720.png'
]

export default defineConfig(async ({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const isBuild = command === 'build'
  const isDev = command === 'serve'
  const enableDevSW = env.VITE_ENABLE_PWA_DEV === 'true'

  const plugins = [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: PWA_INCLUDE_ASSETS,
      manifest: pwaManifest,
      manifestFilename: 'manifest.webmanifest',
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,json,woff,woff2,ttf}'],
        globIgnores: ['**/stats.html'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024
      },
      devOptions: {
        enabled: enableDevSW, // enable with VITE_ENABLE_PWA_DEV=true
        suppressWarnings: true,
        navigateFallback: 'index.html',
        type: 'module' // ensure dev service worker supports ES modules if enabled
      }
    })
  ]

  // Only load visualizer in build mode with ANALYZE flag
  if (isBuild && process.env.ANALYZE === 'true') {
    const { visualizer } = await import('rollup-plugin-visualizer')
    plugins.push(
      visualizer({
        filename: './dist/stats.html',
        open: true,
        gzipSize: true,
        brotliSize: true
      })
    )
  }

  return {
    base: '/',
    plugins,
    define: {
      __APP_VERSION__: JSON.stringify(
        process.env.npm_package_version || process.env.VITE_APP_VERSION || '0.0.0'
      )
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3002',
          changeOrigin: true
        }
      },
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0'
      }
    },
    build: {
      outDir: 'dist',
      // Enable source maps for production debugging (can disable for smaller builds)
      sourcemap: false,
      // Optimize chunk size
      chunkSizeWarningLimit: 1000,
      // Rollup options for better code splitting
      rollupOptions: {
        output: {
          // Manual chunks for better caching and loading
          manualChunks: {
            // Core React libraries
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            // FullCalendar - large library, separate chunk
            'calendar-vendor': [
              '@fullcalendar/react',
              '@fullcalendar/daygrid',
              '@fullcalendar/list',
              '@fullcalendar/interaction',
              '@fullcalendar/core'
            ],
            // React Query
            'query-vendor': ['@tanstack/react-query']
          },
          // Better chunk naming for caching
          chunkFileNames: (chunkInfo) => {
            const facadeModuleId = chunkInfo.facadeModuleId
              ? chunkInfo.facadeModuleId.split('/').pop()
              : ''
            return `assets/js/[name]-[hash].js`
          },
          entryFileNames: 'assets/js/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name.split('.')
            const ext = info[info.length - 1]
            if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
              return `assets/images/[name]-[hash][extname]`
            } else if (/woff2?|ttf|otf|eot/i.test(ext)) {
              return `assets/fonts/[name]-[hash][extname]`
            } else if (/css/i.test(ext)) {
              return `assets/css/[name]-[hash][extname]`
            }
            return `assets/[name]-[hash][extname]`
          }
        }
      },
      // Minification options
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true, // Remove console.logs in production
          drop_debugger: true,
          pure_funcs: ['console.log', 'console.info', 'console.debug']
        },
        format: {
          comments: false // Remove comments
        }
      },
      // CSS code splitting
      cssCodeSplit: true,
      // Asset inline limit (smaller assets will be inlined as base64)
      assetsInlineLimit: 4096,
      // Enable/disable reporting compressed size
      reportCompressedSize: true,
      // Use esbuild for faster builds
      target: 'es2015'
    },
    // Optimize dependencies
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-router-dom',
        '@tanstack/react-query',
        '@fullcalendar/react',
        '@fullcalendar/daygrid',
        '@fullcalendar/list',
        '@fullcalendar/interaction'
      ],
      // Exclude devtools from optimization
      exclude: ['@tanstack/react-query-devtools']
    }
  }
})
