import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** POST /__debug_log — forwards client debugLog() lines to the Node process stdout (dev + preview). */
function debugLogToTerminalPlugin() {
    const middleware = (req, res, next) => {
        const pathOnly = req.url?.split('?')[0] ?? '';
        if (pathOnly !== '/__debug_log') {
            next();
            return;
        }
        if (req.method !== 'POST') {
            res.statusCode = 405;
            res.end();
            return;
        }
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
        });
        req.on('end', () => {
            try {
                const j = JSON.parse(body || '{}');
                const line = typeof j.line === 'string' ? j.line : '';
                if (j.isError) {
                    console.error('[browser]', line);
                } else {
                    console.log('[browser]', line);
                }
            } catch {
                console.log('[browser]', body);
            }
            res.statusCode = 204;
            res.end();
        });
    };
    return {
        name: 'debug-log-to-terminal',
        configureServer(server) {
            server.middlewares.use(middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(middleware);
        }
    };
}

export default defineConfig({
    plugins: [debugLogToTerminalPlugin()],
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
