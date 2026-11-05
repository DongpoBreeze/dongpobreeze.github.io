import { build } from 'esbuild';
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const blobSha = (value) => createHash('sha1').update('blob ' + Buffer.byteLength(value) + '\0').update(value).digest('hex');

export async function buildAdmin({ rootDir, outputDir }) {
  const adminOut = join(outputDir, 'admin');
  const authorOut = join(outputDir, 'author');
  await mkdir(adminOut, { recursive: true });
  await mkdir(authorOut, { recursive: true });
  await build({ entryPoints: [join(rootDir, 'admin/main.mjs')], bundle: true, outfile: join(adminOut, 'editor.js'), platform: 'browser', format: 'esm', target: ['chrome110', 'firefox115', 'safari16'], minify: true, charset: 'utf8', sourcemap: false, legalComments: 'linked', loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'dataurl', '.gif': 'dataurl', '.svg': 'dataurl' }, logLevel: 'silent' });
  await build({ entryPoints: [join(rootDir, 'admin/author.mjs')], bundle: true, outfile: join(authorOut, 'author.js'), platform: 'browser', format: 'esm', target: ['chrome110', 'firefox115', 'safari16'], minify: true, charset: 'utf8', sourcemap: false, legalComments: 'none', logLevel: 'silent' });
  await copyFile(join(rootDir, 'admin/index.html'), join(adminOut, 'index.html'));
  await copyFile(join(rootDir, 'admin/styles.css'), join(adminOut, 'styles.css'));
  await copyFile(join(rootDir, 'admin/author.html'), join(authorOut, 'index.html'));
  await copyFile(join(rootDir, 'admin/author.css'), join(authorOut, 'styles.css'));
  const config = await readFile(join(rootDir, 'blog.config.json'), 'utf8');
  let about = '';
  try { about = await readFile(join(rootDir, 'content/about.md'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(join(adminOut, 'initial.json'), JSON.stringify({ config, configSha: blobSha(config), about, aboutSha: about ? blobSha(about) : null }) + '\n');
}
