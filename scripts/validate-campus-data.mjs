import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = resolve(root, "data/utm");
const sourceManifestPath = resolve(root, "data/utm-source.json");
const snapshotPath = resolve(root, "public/data/utm-campus-v1.json");
const checksumPath = resolve(dataRoot, "SHA256SUMS");

const fail = (message) => {
  console.error(`campus-data validation failed: ${message}`);
  process.exit(1);
};

for (const required of [dataRoot, sourceManifestPath, snapshotPath, checksumPath]) {
  if (!existsSync(required)) fail(`missing required path ${relative(root, required)}`);
}

const manifest = JSON.parse(await readFile(sourceManifestPath, "utf8"));
if (manifest.canonicalRepository !== "Gapwise-for-UTM/data") {
  fail("utm-source.json must identify Gapwise-for-UTM/data as canonicalRepository");
}
if (manifest.canonicalPath !== "data/utm") {
  fail("utm-source.json canonicalPath must be data/utm");
}
if (manifest.consumerContract?.runtimeFetchRequired !== false) {
  fail("runtime campus-data fetching must remain disabled");
}

const requiredCampusFiles = [
  "building-registry.ts",
  "buildings.geojson",
  "entrances.geojson",
  "provenance.ts",
  "routing-buildings.ts",
  "outdoor-edges.json",
  "outdoor-nodes.geojson",
];
for (const path of requiredCampusFiles) {
  if (!existsSync(resolve(dataRoot, path))) fail(`missing canonical campus file ${path}`);
}

const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
if (!Array.isArray(snapshot.buildings)) fail("public snapshot buildings must be an array");
if (snapshot.buildingCount !== snapshot.buildings.length) {
  fail("public snapshot buildingCount does not match buildings.length");
}
const codes = snapshot.buildings.map((building) => building.code);
if (new Set(codes).size !== codes.length) fail("public snapshot contains duplicate building codes");
if (snapshot.buildingCount !== 30) fail(`expected 30 canonical buildings, found ${snapshot.buildingCount}`);

async function listFiles(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(relative(directory, absolute).replaceAll("\\", "/"));
    }
  }
  await visit(directory);
  return files.sort();
}

for (const path of await listFiles(dataRoot)) {
  if (!path.endsWith(".json") && !path.endsWith(".geojson")) continue;
  try {
    JSON.parse(await readFile(resolve(dataRoot, path), "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const checksumLines = (await readFile(checksumPath, "utf8"))
  .trim()
  .split("\n")
  .filter(Boolean);
const checksummed = new Set();
for (const line of checksumLines) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (!match) fail(`invalid SHA256SUMS line: ${line}`);
  const [, expected, path] = match;
  if (path === "SHA256SUMS") fail("SHA256SUMS must not checksum itself");
  const absolute = resolve(dataRoot, path);
  if (!existsSync(absolute)) fail(`checksum references missing file ${path}`);
  const actual = createHash("sha256").update(await readFile(absolute)).digest("hex");
  if (actual !== expected) fail(`checksum mismatch for ${path}`);
  checksummed.add(path);
}

const canonicalFiles = (await listFiles(dataRoot)).filter((path) => path !== "SHA256SUMS");
for (const path of canonicalFiles) {
  if (!checksummed.has(path)) fail(`canonical file is missing from SHA256SUMS: ${path}`);
}
if (checksummed.size !== canonicalFiles.length) {
  fail("SHA256SUMS contains duplicate or unexpected entries");
}

console.log(
  `Validated ${canonicalFiles.length} canonical campus files and ${snapshot.buildingCount} public buildings.`,
);
