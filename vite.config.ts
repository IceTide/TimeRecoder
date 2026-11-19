import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Electron 渲染进程用 file:// 加载，base 必须是相对路径
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
})
