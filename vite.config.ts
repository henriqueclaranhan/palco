import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function resolveSiteUrl(mode: string): string | null {
  const loaded = loadEnv(mode, process.cwd(), '');
  const raw =
    loaded.VITE_SITE_URL?.trim() ||
    process.env.VITE_SITE_URL?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`
      : '');

  if (!raw) return null;

  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return parsed.origin;
  } catch {
    return null;
  }
}

function seoPlugin(siteUrl: string | null): Plugin {
  let outDir = 'dist';

  return {
    name: 'palco-seo',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    transformIndexHtml(html) {
      if (!siteUrl) return html;

      const canonicalUrl = `${siteUrl}/`;
      const ogImageUrl = `${siteUrl}/og-image.png`;

      let transformed = html
        .replace(
          /<meta property="og:image" content="\/og-image\.png" \/>/,
          `<meta property="og:url" content="${canonicalUrl}" />\n    <meta property="og:image" content="${ogImageUrl}" />`
        )
        .replace(
          /<meta name="twitter:image" content="\/og-image\.png" \/>/,
          `<meta name="twitter:image" content="${ogImageUrl}" />`
        )
        .replace(
          /<title>([^<]+)<\/title>/,
          `<title>$1</title>\n    <link rel="canonical" href="${canonicalUrl}" />`
        )
        .replace(
          /"@type": "WebApplication",/,
          `"@type": "WebApplication",\n        "url": "${canonicalUrl}",\n        "image": "${ogImageUrl}",`
        );

      return transformed;
    },
    closeBundle() {
      if (!siteUrl) return;

      const absOutDir = path.resolve(process.cwd(), outDir);
      if (!fs.existsSync(absOutDir)) return;

      const sitemap = /* XML */ `<?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url>
            <loc>${siteUrl}/</loc>
            <changefreq>weekly</changefreq>
            <priority>1.0</priority>
          </url>
          <url>
            <loc>${siteUrl}/privacidade</loc>
            <changefreq>monthly</changefreq>
            <priority>0.3</priority>
          </url>
        </urlset>
      `;

      fs.writeFileSync(path.join(absOutDir, 'sitemap.xml'), sitemap, 'utf8');

      const robotsPath = path.join(absOutDir, 'robots.txt');
      const sitemapDirective = `Sitemap: ${siteUrl}/sitemap.xml\n`;
      if (fs.existsSync(robotsPath)) {
        const current = fs.readFileSync(robotsPath, 'utf8');
        if (!current.includes('Sitemap:')) {
          const separator = current.endsWith('\n') ? '\n' : '\n\n';
          fs.writeFileSync(
            robotsPath,
            `${current}${separator}${sitemapDirective}`,
            'utf8'
          );
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const siteUrl = resolveSiteUrl(mode);

  return {
    plugins: [react(), seoPlugin(siteUrl)],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
      },
    },
    build: {
      target: 'esnext',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('pdfjs-dist')) return 'pdfjs';
            if (id.includes('peerjs')) return 'webrtc';
            return undefined;
          },
        },
      },
    },
    optimizeDeps: {
      exclude: ['pdfjs-dist'],
    },
  };
});
