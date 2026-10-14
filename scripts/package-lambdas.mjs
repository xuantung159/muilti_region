import { createRequire } from 'node:module';
import { createWriteStream } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const src = path.join(root, 'src');
const require = createRequire(path.join(src, 'package.json'));
const archiver = require('archiver');
await access(path.join(src, 'node_modules', '@aws-sdk', 'lib-dynamodb'));
const outputDir = path.join(root, 'artifacts', 'lambda');
await mkdir(outputDir, { recursive: true });

for (const name of ['api', 'dashboard', 'authorizer', 'monitoring']) {
  try { await access(path.join(src, name, 'index.mjs')); }
  catch { console.log(`Skip ${name}: chưa có handler`); continue; }
  const output = createWriteStream(path.join(outputDir, `${name}.zip`));
  const archive = archiver('zip', { zlib: { level: 9 } });
  const finished = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', reject);
  });
  archive.pipe(output);
  archive.directory(path.join(src, name), name);
  archive.directory(path.join(src, 'shared'), 'shared');
  archive.directory(path.join(src, 'node_modules', '@aws-sdk'), 'node_modules/@aws-sdk');
  // Include all production transitive dependencies; exclude archiver and other dev dependencies.
  const { execFileSync } = await import('node:child_process');
  if (!process.env.npm_execpath) throw new Error('Chạy bằng npm run package --prefix src.');
  const listing = execFileSync(process.execPath, [process.env.npm_execpath, 'ls', '--omit=dev', '--all', '--parseable'], {
    cwd: src, encoding: 'utf8', windowsHide: true,
  });
  const dirs = listing.trim().split(/\r?\n/).slice(1);
  for (const dir of new Set(dirs)) {
    const relative = path.relative(src, dir).replaceAll('\\', '/');
    if (!relative.startsWith('node_modules/') || relative.startsWith('node_modules/@aws-sdk/')) continue;
    archive.directory(dir, relative);
  }
  archive.file(path.join(src, 'package.json'), { name: 'package.json' });
  await archive.finalize();
  await finished;
  console.log(`${name}.zip → handler ${name}/index.handler`);
}
