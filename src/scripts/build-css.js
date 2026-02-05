/**
 * CSS Build Script
 *
 * Combines and minifies CSS files for production.
 * Usage: node src/scripts/build-css.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS_DIR = path.join(__dirname, '../public/css');

const CSS_IMPORTS = [
  './base/reset.css',
  './base/typography.css',
  './design-system/tokens.css',
  './design-system/buttons.css',
  './design-system/forms.css',
  './design-system/cards.css',
  './design-system/badges.css',
  './design-system/animations.css',
  './components/page-header.css',
  './components/empty-state.css',
  './components/pagination.css',
  './components/loading.css',
  './components/filters.css',
  './components/tables.css',
  './components/status-badge.css',
  './components/modal.css',
];

/**
 * Simple CSS minifier
 * Removes comments, extra whitespace, and newlines
 */
function minifyCSS(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove comments
    .replace(/\s+/g, ' ')             // Collapse whitespace
    .replace(/\s*([\{\}\:\;\,])\s*/g, '$1')  // Remove space around special chars
    .replace(/;\}/g, '}')             // Remove last semicolon
    .trim();
}

/**
 * Bundle all CSS files into one
 */
function bundleCSS(minify = false) {
  const output = [];

  if (minify) {
    // Production: minified bundle
    output.push('/* CSS Bundle - Generated ' + new Date().toISOString() + ' */');
    for (const file of CSS_IMPORTS) {
      const filePath = path.join(CSS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      output.push(minifyCSS(content));
    }
  } else {
    // Development: readable bundle with file markers
    output.push('/* ============================================ */');
    output.push('/* CSS BUNDLE - Development Mode               */');
    output.push('/* Generated: ' + new Date().toISOString() + '  */');
    output.push('/* ============================================ */\n');

    for (const file of CSS_IMPORTS) {
      const filePath = path.join(CSS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      output.push('/* ============================================ */');
      output.push('/* ' + file + ' */');
      output.push('/* ============================================ */');
      output.push(content);
      output.push('\n');
    }
  }

  const bundledCSS = output.join('\n');
  const outputFile = minify
    ? path.join(CSS_DIR, 'main.bundle.min.css')
    : path.join(CSS_DIR, 'main.bundle.css');

  fs.writeFileSync(outputFile, bundledCSS);

  const size = (Buffer.byteLength(bundledCSS, 'utf8') / 1024).toFixed(2);
  console.log('✓ CSS bundle created: ' + path.relative(process.cwd(), outputFile));
  console.log('  Size: ' + size + ' KB');
}

// Check for --minify flag
const shouldMinify = process.argv.includes('--minify');
const isProduction = process.env.NODE_ENV === 'production';

bundleCSS(isProduction || shouldMinify);

if (isProduction || shouldMinify) {
  console.log('\n✓ CSS minified for production');
} else {
  console.log('\n✓ CSS bundled for development');
}
