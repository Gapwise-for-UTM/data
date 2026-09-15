import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const required = [
  'public/robots.txt',
  'public/sitemap.xml',
  'public/.well-known/gapwise.json',
  'public/schemas/dataset-manifest.schema.json',
  'public/schemas/entrance-contribution.schema.json',
  'public/schemas/entrance-batch-contribution.schema.json',
  'schemas/entrance-contribution.schema.json',
  'schemas/entrance-batch-contribution.schema.json',
  'scripts/publish-datasets.mjs',
  'src/EntranceContribution.jsx',
  'src/BatchEntranceContribution.jsx',
  'src/EntrancePrReview.jsx',
];
for (const path of required) await access(resolve(root, path));

const robots = await readFile(resolve(root, 'public/robots.txt'), 'utf8');
if (!robots.includes('Sitemap: https://data.gapwise.ca/sitemap.xml')) {
  throw new Error('robots.txt must advertise the canonical Data sitemap');
}

const sitemap = await readFile(resolve(root, 'public/sitemap.xml'), 'utf8');
if (!sitemap.includes('<loc>https://data.gapwise.ca/contribute</loc>')) {
  throw new Error('sitemap.xml must index the public entrance contribution surface');
}

const vercel = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8'));
const rewriteSources = new Set((vercel.rewrites ?? []).map((rewrite) => rewrite.source));
for (const route of ['/contribute', '/contribute/:path*', '/review/entrances', '/studio/entrances']) {
  if (!rewriteSources.has(route)) {
    throw new Error(`vercel.json must preserve the ${route} client route`);
  }
}

for (const schemaName of ['entrance-contribution.schema.json', 'entrance-batch-contribution.schema.json']) {
  const canonicalSchema = await readFile(resolve(root, 'schemas', schemaName), 'utf8');
  const publicSchema = await readFile(resolve(root, 'public/schemas', schemaName), 'utf8');
  if (canonicalSchema !== publicSchema) {
    throw new Error(`Published ${schemaName} must match the canonical schema`);
  }
}

console.log('Public Gapwise Data distribution contract is present.');
