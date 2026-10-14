// Bundles the two renderer entry points (main window and mini island) for the browser.
import { build } from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: { renderer: 'src/renderer/app.js', mini: 'src/mini/mini.js' },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome130',
  sourcemap: true,
  minify: !watch,
  logLevel: 'info'
};

if (watch) {
  const { context } = await import('esbuild');
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
