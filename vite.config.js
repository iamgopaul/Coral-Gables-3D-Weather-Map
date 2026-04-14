import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: '.',
    /** Load `.env` / `.env.local` from the repo root (same folder as this file). */
    envDir: __dirname,
    publicDir: false,
    server: {
        port: 8000,
        strictPort: false
    },
    preview: {
        port: 8000,
        strictPort: false
    },
    build: {
        outDir: 'dist',
        assetsDir: 'assets',
        sourcemap: false
    }
});
