import fs from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import { rimraf } from 'rimraf';

/**
 * @param i18nPath {string}
 */
export async function build(i18nPath) {
  fs.cpSync(i18nPath, path.resolve('lib', 'i18n.ts'));

  await esbuild.build({
    entryPoints: ['./index.ts'],
    tsconfig: './tsconfig.json',
    bundle: true,
    packages: 'bundle',
    target: 'es6',
    outdir: './dist',
    sourcemap: true,
    format: 'esm',
  });

  const outDir = path.resolve('..', '..', 'dist');
  const localePath = path.resolve(outDir, '_locales');
  rimraf.sync(localePath);
  fs.cpSync(path.resolve('locales'), localePath, { recursive: true });

  // 持节: Chrome still resolves __MSG_*__ via browser language.
  // Ship en (and other non-zh packs) as zh_CN so English Chrome UI still shows Chinese.
  const zhCnMessages = path.resolve('locales', 'zh_CN', 'messages.json');
  for (const locale of fs.readdirSync(localePath)) {
    if (locale === 'zh_CN' || locale === 'zh_TW') continue;
    const target = path.resolve(localePath, locale, 'messages.json');
    if (fs.existsSync(target)) {
      fs.copyFileSync(zhCnMessages, target);
    }
  }

  console.log('I18n build complete (product UI locked to zh_CN)');
}
