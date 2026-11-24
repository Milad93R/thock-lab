import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Generates dist/sw.js from sw/sw.template.js with a precache manifest that lists
 * the app shell and every built asset (hashed JS/CSS/fonts/textures + icons),
 * plus a cache version derived from the manifest contents.
 */
function serviceWorkerPrecache(): Plugin {
  let outDir = 'dist';
  const EXCLUDE = new Set(['index.html', '404.html', 'sw.js', 'og.png', 'robots.txt', '_headers', '_redirects']);
  return {
    name: 'thock-sw-precache',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const abs = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(abs);
          else files.push(path.relative(outDir, abs).split(path.sep).join('/'));
        }
      };
      walk(outDir);
      const urls = ['/', ...files.filter((f) => !EXCLUDE.has(f)).sort().map((f) => `/${f}`)];
      const hash = createHash('sha256');
      for (const f of files.filter((f) => !EXCLUDE.has(f) || f === 'index.html').sort()) {
        hash.update(f);
        hash.update(fs.readFileSync(path.join(outDir, f)));
      }
      const version = hash.digest('hex').slice(0, 12);
      const template = fs.readFileSync(path.resolve(__dirname, 'sw/sw.template.js'), 'utf8');
      const out = template
        .replace('__CACHE_VERSION__', version)
        .replace('__PRECACHE_MANIFEST__', JSON.stringify(urls, null, 2));
      fs.writeFileSync(path.join(outDir, 'sw.js'), out);
      this.info?.(`sw.js: ${urls.length} precached URLs, version ${version}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorkerPrecache()],
  server: {
    host: '127.0.0.1',
    port: 6803,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 6803,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
