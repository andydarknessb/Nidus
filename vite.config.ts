import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Bind to IPv4 loopback so http://127.0.0.1:5173 works; the Google OAuth
  // origin allow-list and docs/google-sign-in.md use this host.
  server: { host: '127.0.0.1' },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
