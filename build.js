const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['./out/extension.js'],
  bundle: true,
  outfile: './out/extension.bundle.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: false,
  minify: true
}).catch(() => process.exit(1));
