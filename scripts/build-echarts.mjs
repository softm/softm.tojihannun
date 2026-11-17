import {build} from 'esbuild';

await build({
  entryPoints: ['scripts/echarts-entry.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outfile: 'vendor/echarts-toji.min.js',
  legalComments: 'eof'
});
