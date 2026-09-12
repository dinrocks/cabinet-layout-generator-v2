import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages 部署在仓库子路径；Vercel/本地仍使用根路径。
  base: process.env.GITHUB_PAGES === 'true' ? '/cabinet-layout-generator-v2/' : '/',
  server: { port: 5180, strictPort: true },
})
