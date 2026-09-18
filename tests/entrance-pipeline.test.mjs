import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "gapwise-entrances-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ["scripts", "data", "public/data"]) {
    await cp(resolve(repository, path), resolve(root, path), { recursive: true });
  }
  const load = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
  const save = (path, value) => writeFile(resolve(root, path), JSON.stringify(value) + "\n");
  const run = (script) => {
    const result = spawnSync(process.execPath, [resolve(root, `scripts/${script}.mjs`)], { encoding: "utf8" });
    return { code: result.status, output: result.stdout + result.stderr };
  };
  const bytes = async () => {
    const values = {};
    for (const directory of ["data", "public/data"]) {
      for (const path of (await readdir(resolve(root, directory), { recursive: true, withFileTypes: true }))) {
        if (path.isFile()) {
          const absolute = join(path.parentPath, path.name);
          values[absolute.slice(root.length)] = createHash("sha256").update(await readFile(absolute)).digest("hex");
        }
      }
    }
    return values;
  };
  return { root, load, save, run, bytes };
}
const entrancePath = "data/utm/entrances.geojson";
const nodePath = "data/utm/outdoor-nodes.geojson";
const edgePath = "data/utm/outdoor-edges.json";
const idFor = (feature) => feature.properties.routingNodeId ?? `osm-node-${feature.properties.osmNodeId}`;

test("current campus bytes remain unchanged by derivation", async (t) => {
  const f = await fixture(t);
  const before = await f.bytes();
  assert.equal(f.run("refresh-entrance-derived").code, 0);
  assert.deepEqual(await f.bytes(), before);
});

test("one moved entrance refreshes its graph, lengths, audit and checksums deterministically", async (t) => {
  const f = await fixture(t);
  const entrances = await f.load(entrancePath);
  const feature = entrances.features[0];
  feature.geometry.coordinates[0] += 0.00001;
  feature.properties.label = "Reviewed entrance";
  feature.properties.access = "restricted";
  feature.properties.notes = "";
  await f.save(entrancePath, entrances);
  assert.notEqual(f.run("verify-entrance-coherence").code, 0);
  assert.equal(f.run("refresh-entrance-derived").code, 0);
  const nodes = await f.load(nodePath);
  const node = nodes.features.find((entry) => entry.id === idFor(feature));
  assert.deepEqual(node.geometry.coordinates, feature.geometry.coordinates);
  assert.equal(node.properties.label, "Reviewed entrance");
  assert.equal(f.run("validate-campus-data").code, 0);
  assert.equal(f.run("verify-entrance-coherence").code, 0);
  const first = await f.bytes();
  assert.equal(f.run("refresh-entrance-derived").code, 0);
  assert.deepEqual(await f.bytes(), first);
});

test("stale edge lengths and graph semantic overrides fail verification and are repaired", async (t) => {
  const f = await fixture(t);
  const entrances = await f.load(entrancePath);
  const id = idFor(entrances.features[0]);
  const nodes = await f.load(nodePath);
  nodes.features.find((node) => node.id === id).properties.access = "public";
  await f.save(nodePath, nodes);
  const edges = await f.load(edgePath);
  edges.edges.find((edge) => edge.from === id || edge.to === id).distanceMeters += 10;
  await f.save(edgePath, edges);
  const check = f.run("verify-entrance-coherence");
  assert.notEqual(check.code, 0);
  assert.match(check.output, /overrides canonical entrance semantics/);
  assert.match(check.output, /entrance edge distance is stale/);
  assert.equal(f.run("refresh-entrance-derived").code, 0);
  assert.equal(f.run("verify-entrance-coherence").code, 0);
});

for (const [name, mutate, message] of [
  ["duplicate identity", (items) => items.push(structuredClone(items[0])), /duplicate id/],
  ["shared routing node", (items) => { items[1].properties.osmNodeId = items[0].properties.osmNodeId; }, /claimed by multiple entrances/],
  ["unknown building", (items) => { items[0].properties.buildingCode = "UNKNOWN"; }, /unknown public building/],
  ["missing graph node", (items) => { items[0].properties.routingNodeId = "missing"; }, /routing node missing does not exist/],
  ["invalid coordinate", (items) => { items[0].geometry.coordinates[0] = null; }, /finite WGS84/],
  ["unreviewed graph retirement", (items) => items.shift(), /removed entrance/],
]) {
  test(`${name} fails before any derived file is written`, async (t) => {
    const f = await fixture(t);
    const entrances = await f.load(entrancePath);
    mutate(entrances.features);
    await f.save(entrancePath, entrances);
    const before = await f.bytes();
    const result = f.run("refresh-entrance-derived");
    assert.notEqual(result.code, 0);
    assert.match(result.output, message);
    assert.deepEqual(await f.bytes(), before);
  });
}

test("extra generated entrance records and zero-entrance audit counts cannot silently drift", async (t) => {
  const f = await fixture(t);
  const path = "data/utm/generated/entrance-audit.geojson";
  const audit = await f.load(path);
  audit.features.push({ ...structuredClone(audit.features[0]), id: "removed-entrance" });
  await f.save(path, audit);
  const accessPath = "data/utm/generated/campus-access-audit.json";
  const access = await f.load(accessPath);
  const empty = access.buildings.find((b) => b.code === "WC");
  empty.graphConnectedAccessPoints = 1;
  await f.save(accessPath, access);
  const result = f.run("verify-entrance-coherence");
  assert.notEqual(result.code, 0);
  assert.match(result.output, /stale generated entrance-audit/);
  assert.match(result.output, /WC: campus-access-audit/);
  assert.equal(f.run("refresh-entrance-derived").code, 0);
  assert.equal(f.run("verify-entrance-coherence").code, 0);
});

test("duplicate checksum entries are rejected", async (t) => {
  const f = await fixture(t);
  const path = resolve(f.root, "data/utm/SHA256SUMS");
  const original = await readFile(path, "utf8");
  await writeFile(path, original + original.split("\n")[0] + "\n");
  const result = f.run("validate-campus-data");
  assert.notEqual(result.code, 0);
  assert.match(result.output, /duplicate SHA256SUMS entry/);
});
