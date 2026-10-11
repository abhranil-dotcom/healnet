import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const SERVER_URL = process.env.HEALNET_SERVER_URL ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    // The dashboard connects to VITE_SOCKET_URL (default http://localhost:4000) directly.
    // This proxy is only a convenience for opening /api/* via the Vite port.
    proxy: {
      '/socket.io': { target: SERVER_URL, ws: true },
      '/api': { target: SERVER_URL },
    },
  },
});
