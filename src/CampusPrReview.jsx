import React, { useEffect, useMemo, useState } from 'react';
import { Check, CircleAlert, ExternalLink, RotateCcw } from 'lucide-react';
import {
  CAMPUSES,
  MAP_HEIGHT,
  MAP_WIDTH,
  canonicalFootprintsForCampus,
  createCampusProjection,
  geometryPath,
  tilesForCampus,
} from './campus-contribution-data.js';
import './campus-pr-review.css';

const REPOSITORY = 'Gapwise-for-UTM/data';
const API_ROOT = `https://api.github.com/repos/${REPOSITORY}`;
const RAW_ROOT = `https://raw.githubusercontent.com/${REPOSITORY}`;
const CAMPUSES_RE = /^data\/(utm|utsg|utsc)\/.+\.geojson$/;

function parsePrNumber() {
  const value = new URLSearchParams(window.location.search).get('pr');
  const number = Number.parseInt(value ?? '', 10);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function asFeatures(value) {
  if (!value) return [];
  if (value.type === 'FeatureCollection') return value.features ?? [];
  if (value.type === 'Feature') return [value];
  return [];
}

function featureKey(feature, index) {
  return String(
    feature?.id ??
    feature?.properties?.id ??
    feature?.properties?.buildingCode ??
    feature?.properties?.code ??
    feature?.properties?.osmNodeId ??
    `feature-${index}`,
  );
}

function normalizeFeature(feature) {
  return JSON.stringify({ geometry: feature?.geometry, properties: feature?.properties });
}

function diffFeatures(baseFeatures, headFeatures, file) {
  const base = new Map(baseFeatures.map((feature, index) => [featureKey(feature, index), feature]));
  const head = new Map(headFeatures.map((feature, index) => [featureKey(feature, index), feature]));
  const records = [];

  head.forEach((feature, key) => {
    if (!base.has(key)) {
      records.push({ key: `${file}:${key}:added`, file, state: 'added', feature });
      return;
    }
    if (normalizeFeature(base.get(key)) !== normalizeFeature(feature)) {
      records.push({ key: `${file}:${key}:changed`, file, state: 'changed', feature, before: base.get(key) });
    }
  });

  base.forEach((feature, key) => {
    if (!head.has(key)) records.push({ key: `${file}:${key}:removed`, file, state: 'removed', feature });
  });
  return records;
}

async function fetchJson(url, allowMissing = false) {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchRawJson(sha, path) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${RAW_ROOT}/${sha}/${encodedPath}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Could not load ${path} at ${sha.slice(0, 7)}`);
  return response.json();
}

function stateLabel(state) {
  if (state === 'added') return 'Added';
  if (state === 'removed') return 'Removed';
  return 'Changed';
}

function geometryLabel(geometry) {
  return geometry?.type || 'Unknown geometry';
}

function renderGeometry(record, project) {
  const { geometry } = record.feature;
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    const [x, y] = project(geometry.coordinates);
    return <circle cx={x} cy={y} r="10" className={`review-geometry ${record.state}`} />;
  }
  if (geometry.type === 'LineString') {
    return <path d={geometryPath(geometry, project)} className={`review-line review-geometry ${record.state}`} />;
  }
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    return <path d={geometryPath(geometry, project)} className={`review-polygon review-geometry ${record.state}`} />;
  }
  return null;
}

export default function CampusPrReview() {
  const prNumber = parsePrNumber();
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [pr, setPr] = useState(null);
  const [records, setRecords] = useState([]);
  const [changedFiles, setChangedFiles] = useState([]);
  const [campusId, setCampusId] = useState('utm');
  const [selectedFile, setSelectedFile] = useState('all');

  useEffect(() => {
    if (!prNumber) {
      setStatus('error');
      setError('Add a PR number to the URL, for example ?pr=35.');
      return;
    }

    let cancelled = false;
    async function load() {
      setStatus('loading');
      setError('');
      try {
        const [prData, files] = await Promise.all([
          fetchJson(`${API_ROOT}/pulls/${prNumber}`),
          fetchJson(`${API_ROOT}/pulls/${prNumber}/files?per_page=100`),
        ]);
        const geometryFiles = files
          .map((file) => file.filename)
          .filter((filename) => CAMPUSES_RE.test(filename));
        const loaded = [];
        for (const file of geometryFiles) {
          const campus = CAMPUSES_RE.exec(file)?.[1];
          const [baseJson, headJson] = await Promise.all([
            fetchRawJson(prData.base.sha, file),
            fetchRawJson(prData.head.sha, file),
          ]);
          loaded.push(
            ...diffFeatures(asFeatures(baseJson), asFeatures(headJson), file).map((record) => ({
              ...record,
              campus,
            })),
          );
        }
        if (cancelled) return;
        setPr(prData);
        setChangedFiles(geometryFiles);
        setRecords(loaded);
        const firstCampus = loaded[0]?.campus || CAMPUSES_RE.exec(geometryFiles[0] || '')?.[1] || 'utm';
        setCampusId(firstCampus);
        setStatus('ready');
      } catch (caught) {
        if (cancelled) return;
        setStatus('error');
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
    load();
    return () => { cancelled = true; };
  }, [prNumber]);

  const projection = useMemo(() => createCampusProjection(campusId), [campusId]);
  const tiles = useMemo(() => tilesForCampus(campusId, projection.project), [campusId, projection]);
  const canonicalFootprints = useMemo(() => canonicalFootprintsForCampus(campusId), [campusId]);
  const campusFiles = changedFiles.filter((file) => file.startsWith(`data/${campusId}/`));
  const visibleRecords = records.filter(
    (record) => record.campus === campusId && (selectedFile === 'all' || record.file === selectedFile),
  );
  const campusIds = [...new Set(changedFiles.map((file) => CAMPUSES_RE.exec(file)?.[1]).filter(Boolean))];
  const counts = visibleRecords.reduce(
    (result, record) => ({ ...result, [record.state]: (result[record.state] ?? 0) + 1 }),
    {},
  );

  if (status === 'loading') {
    return <div className="campus-review-state"><RotateCcw size={22} className="spin" /><strong>Loading PR geometry…</strong></div>;
  }

  if (status === 'error') {
    return <div className="campus-review-state error"><CircleAlert size={22} /><strong>Could not load visual review</strong><p>{error}</p></div>;
  }

  return (
    <div className="campus-review-shell">
      <header className="campus-review-topbar">
        <a href="/" className="campus-review-brand"><span>Y</span><strong>Gapwise <em>Data</em></strong><small>PR MAP REVIEW</small></a>
        <a href={`https://github.com/${REPOSITORY}/pull/${prNumber}`} target="_blank" rel="noreferrer">Open PR #{prNumber} <ExternalLink size={13} /></a>
      </header>

      <main className="campus-review-main">
        <aside className="campus-review-sidebar">
          <section>
            <div className="campus-review-eyebrow">PULL REQUEST</div>
            <h1>#{prNumber} · {pr?.title}</h1>
            <p>{pr?.head?.ref} → {pr?.base?.ref}</p>
          </section>

          <section>
            <div className="campus-review-eyebrow">CAMPUS</div>
            <div className="campus-review-campus-tabs">
              {(campusIds.length ? campusIds : ['utm']).map((id) => (
                <button type="button" key={id} className={campusId === id ? 'active' : ''} onClick={() => { setCampusId(id); setSelectedFile('all'); }}>
                  {CAMPUSES[id]?.shortName || id.toUpperCase()}
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="campus-review-eyebrow">CHANGED MAP FILES</div>
            <button type="button" className={selectedFile === 'all' ? 'campus-review-file active' : 'campus-review-file'} onClick={() => setSelectedFile('all')}>
              <strong>All geometry</strong><small>{visibleRecords.length} visible changes</small>
            </button>
            {campusFiles.map((file) => (
              <button type="button" key={file} className={selectedFile === file ? 'campus-review-file active' : 'campus-review-file'} onClick={() => setSelectedFile(file)}>
                <strong>{file.replace(`data/${campusId}/`, '')}</strong>
                <small>{records.filter((record) => record.file === file).length} changes</small>
              </button>
            ))}
            {!campusFiles.length ? <p>No GeoJSON map files for this campus.</p> : null}
          </section>

          <section>
            <div className="campus-review-eyebrow">VISIBLE DIFF</div>
            <div className="campus-review-counts">
              <span className="added"><b>{counts.added ?? 0}</b> added</span>
              <span className="changed"><b>{counts.changed ?? 0}</b> changed</span>
              <span className="removed"><b>{counts.removed ?? 0}</b> removed</span>
            </div>
          </section>

          <section className="campus-review-items">
            {visibleRecords.map((record, index) => (
              <div className={`campus-review-item ${record.state}`} key={record.key}>
                <span>{index + 1}</span>
                <div><strong>{stateLabel(record.state)} · {geometryLabel(record.feature.geometry)}</strong><small>{record.file.replace(`data/${campusId}/`, '')}</small></div>
              </div>
            ))}
            {!visibleRecords.length ? <div className="campus-review-empty"><Check size={18} /><p>No feature-level geometry differences in this filter.</p></div> : null}
          </section>
        </aside>

        <section className="campus-review-workspace">
          <div className="campus-review-heading">
            <div><span>VISUAL DIFF · {CAMPUSES[campusId]?.shortName}</span><h2>Check every changed shape in context.</h2><p>Green is added, amber is changed, red is removed. Existing UTM buildings remain faintly visible behind the diff.</p></div>
            <div className="campus-review-badges"><span className="added">Added</span><span className="changed">Changed</span><span className="removed">Removed</span></div>
          </div>

          <div className="campus-review-map-wrap">
            <svg className="campus-review-map" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}>
              <rect width={MAP_WIDTH} height={MAP_HEIGHT} className="review-map-bg" />
              <g className="review-osm" pointerEvents="none">
                {tiles.map((tile) => <image key={tile.key} href={tile.href} x={tile.x} y={tile.y} width={tile.width} height={tile.height} preserveAspectRatio="none" />)}
              </g>
              <g className="review-context" pointerEvents="none">
                {canonicalFootprints.map((feature, index) => <path key={index} d={geometryPath(feature.geometry, projection.project)} />)}
              </g>
              <g className="review-diff">
                {visibleRecords.map((record) => <g key={record.key}>{renderGeometry(record, projection.project)}</g>)}
              </g>
            </svg>
            <a className="review-osm-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
          </div>

          <footer className="campus-review-footer">
            <span><Check size={13} /> No raw-data interaction required</span>
            <span>{changedFiles.length} changed GeoJSON file{changedFiles.length === 1 ? '' : 's'}</span>
            <a href={`https://github.com/${REPOSITORY}/pull/${prNumber}/files`} target="_blank" rel="noreferrer">Return to PR files <ExternalLink size={12} /></a>
          </footer>
        </section>
      </main>
    </div>
  );
}
