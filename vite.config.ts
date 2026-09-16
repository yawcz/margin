import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import express from 'express';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pdfjs = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')));
const assetDirs = ['cmaps', 'standard_fonts', 'wasm'];

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'pdfjs-assets',
      configureServer(server) {
        const app = express();
        app.disable('x-powered-by');
        for (const dir of assetDirs) app.use(`/pdfjs/${dir}`, express.static(join(pdfjs, dir)));
        server.middlewares.use(app);
      },
      generateBundle() {
        for (const dir of assetDirs)
          for (const filename of readdirSync(join(pdfjs, dir)))
            this.emitFile({
              type: 'asset',
              fileName: `pdfjs/${dir}/${filename}`,
              source: readFileSync(join(pdfjs, dir, filename)),
            });
      },
    },
  ],
  server: { host: '127.0.0.1' },
});
