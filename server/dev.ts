import { createServer, normalizePath } from 'vite';
import { resolve } from 'node:path';

export function createDevServer(dataDir: string) {
  return createServer({
    server: {
      middlewareMode: true,
      fs: {
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem}',
          '**/.git/**',
          `${normalizePath(resolve(dataDir))}/**`,
        ],
      },
    },
    appType: 'spa',
  });
}
