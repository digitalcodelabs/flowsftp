// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  // 1. SPA Mode: Tauri desktop applications do not run a Node server; they require static client-side rendering.
  ssr: false,

  // 2. CSS & UI Styling
  css: ['~/assets/css/main.css'],

  // 3. Nuxt Modules
  modules: [
    '@pinia/nuxt',
    '@nuxtjs/tailwindcss',
  ],

  // 4. Development Server Configuration
  devServer: {
    // Tauri sets TAURI_DEV_HOST when developing on mobile or LAN, fallback to localhost
    host: process.env.TAURI_DEV_HOST || 'localhost',
    port: 1420,
  },

  // 5. Vite Configuration tailored for Tauri v2
  vite: {
    // Prevent Vite from obscuring Rust/Tauri compiler errors
    clearScreen: false,

    server: {
      // Don't auto-increment port if 1420 is busy; fail early to avoid Tauri mismatch
      strictPort: true,
      watch: {
        // Tell Vite to ignore watching `src-tauri` Rust files
        ignored: ['**/src-tauri/**'],
      },
    },

    // Expose Tauri environment variables to the client code
    envPrefix: ['VITE_', 'TAURI_ENV_*'],

    build: {
      // Modern target for Tauri (WebView2 on Windows, WebKit on macOS/Linux)
      target:
        process.env.TAURI_ENV_PLATFORM === 'windows'
          ? 'chrome105'
          : ['es2022', 'safari15'],
      // Don't minify in debug builds for faster iteration and easier debugging
      minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
      // Produce sourcemaps in debug mode
      sourcemap: !!process.env.TAURI_ENV_DEBUG,
    },
  },

  // 6. Router & App Settings
  router: {
    options: {
      hashMode: false,
    },
  },

  telemetry: false,
})
