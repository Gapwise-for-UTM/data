import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'data/utm');
const output = resolve(root, 'dist/datasets/utm/latest');

async function filesUnder(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(relative(directory, absolute).replaceAll('\\', '/'));
    }
  }
  await visit(directory);
  return files.sort();
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true });

const files = (await filesUnder(source)).filter((file) => file !== 'SHA256SUMS');
const artifacts = [];
for (const file of files) {
  const bytes = await readFile(resolve(source, file));
  artifacts.push({
    path: file,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    url: `https://data.gapwise.ca/datasets/utm/latest/${file}`,
  });
}

const manifest = {
  schemaVersion: 1,
  dataset: 'utm-campus',
  channel: 'latest',
  canonicalRepository: 'https://github.com/Gapwise-for-UofT/data',
  documentation: 'https://docs.gapwise.ca/data/',
  api: 'https://api.gapwise.ca/v1',
  generatedAt: new Date().toISOString(),
  artifacts,
};

await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await mkdir(resolve(root, 'dist/.well-known'), { recursive: true });
await writeFile(resolve(root, 'dist/.well-known/gapwise-data.json'), `${JSON.stringify({
  dataset: manifest.dataset,
  manifest: 'https://data.gapwise.ca/datasets/utm/latest/manifest.json',
  docs: manifest.documentation,
  api: manifest.api,
  repository: manifest.canonicalRepository,
}, null, 2)}\n`, 'utf8');

console.log(`Published ${artifacts.length} canonical campus artifacts to dist/datasets/utm/latest.`);
