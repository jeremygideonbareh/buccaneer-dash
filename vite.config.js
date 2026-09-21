import { defineConfig } from 'vite'

// Relative base so the build works from any folder or GitHub Pages path
export default defineConfig({
  base: './',
  server: { port: 5190 },
})
