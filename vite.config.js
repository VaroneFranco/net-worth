import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base relativa para que funcione en GitHub Pages (usuario.github.io/repo/)
export default defineConfig({
  base: './',
  plugins: [react()],
})
