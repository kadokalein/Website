import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Two builds of the same app:
//   npm run build      → dist/      the website on GitHub Pages, served from /Website/
//   npm run build:ios  → dist-ios/  the iPhone app; Capacitor serves it from the app bundle,
//                                   so asset paths are relative (./) — see capacitor.config.json
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === 'ios' ? './' : '/Website/',
  build: {
    outDir: mode === 'ios' ? 'dist-ios' : 'dist',
  },
}))
