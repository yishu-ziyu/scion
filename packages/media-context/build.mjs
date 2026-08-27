import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['./index.ts', './src/**/*.ts'],
  tsconfig: './tsconfig.json',
  bundle: false,
  target: 'es6',
  outdir: './dist',
  sourcemap: true,
});
