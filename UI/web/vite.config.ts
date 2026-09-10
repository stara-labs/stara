import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function readInterLicense() {
  const requireUi = createRequire(new URL('../shared/package.json', import.meta.url));
  const fontDirectory = dirname(requireUi.resolve('@fontsource-variable/inter/package.json'));
  return readFileSync(join(fontDirectory, 'LICENSE'), 'utf8');
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inter-license',
      configureServer(server) {
        const license = readInterLicense();
        server.middlewares.use((request, response, next) => {
          if (
            (request.method !== 'GET' && request.method !== 'HEAD') ||
            request.url?.split('?')[0] !== '/licenses/Inter-OFL.txt'
          ) {
            next();
            return;
          }
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/plain; charset=utf-8');
          response.end(request.method === 'HEAD' ? undefined : license);
        });
      },
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'licenses/Inter-OFL.txt',
          source: readInterLicense(),
        });
      },
    },
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@stara/ui/styles': fileURLToPath(new URL('../shared/src/styles.css', import.meta.url)),
      '@stara/ui': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000' },
  },
  preview: { proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000' } },
});
