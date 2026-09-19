import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  boundsForFeatures,
  groupedFootprints,
  pathForGeometry,
  project,
} from './entrance-map-data.js';
import './entrance-pr-review.css';

const REPOSITORY = 'Gapwise-for-UofT/data';
const ENTRANCE_PATH = 'data/utm/entrances.geojson';

function parsePrNumber() {
  const value = new URLSearchParams(window.location.search).get('pr');
  const number = Number.parseInt(value ?? '', 10);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function featureKey(feature) {
  if (feature?.id) return `id:${feature.id}`;
  const code = feature?.properties?.buildingCode ?? '';
  const coordinates = feature?.geometry?.coordinates ?? [];
  return `fallback:${code}:${coordinates.join(',')}`;
}

function isSameFeature(a, b) {
  return JSON.stringify(a?.geometry) === JSON.stringify(b?.geometry)
    && JSON.stringify(a?.properties) === JSON.stringify(b?.properties);
}

function diffEntrances(baseData, headData) {
  const base = new Map((baseData?.features ?? []).map((feature) => [featureKey(feature), feature]));
  const head = new Map((headData?.features ?? []).map((feature) => [featureKey(feature), feature]));
  const changes = [];

  head.forEach((feature, key) => {
    const previous = base.get(key);
    if (!previous) changes.push({ key, status: 'added', feature, previous: null });
    else if (!isSameFeature(previous, feature)) changes.push({ key, status: 'modified', feature, previous });
  });

  base.forEach((feature, key) => {
    if (!head.has(key)) changes.push({ key, status: 'removed', feature, previous: feature });
  });

  return changes.sort((a, b) => {
    const codeA = a.feature?.properties?.buildingCode ?? '';
    const codeB = b.feature?.properties?.buildingCode ?? '';
    return codeA.localeCompare(codeB) || a.status.localeCompare(b.status);
  });
}

function statusLabel(status) {
  if (status === 'added') return 'New';
  if (status === 'modified') return 'Changed';
  return 'Removed';
}

function coordinatesText(feature) {
  const [longitude, latitude] = feature?.geometry?.coordinates ?? [];
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return 'No point coordinates';
  return `${latitude.toFixed(7)}, ${longitude.toFixed(7)}`;
}

export default function EntrancePrReview() {
  const [prNumber, setPrNumber] = useState(parsePrNumber);
  const [inputValue, setInputValue] = useState(() => String(parsePrNumber() ?? ''));
  const [state, setState] = useState({ status: prNumber ? 'loading' : 'idle', error: '', pr: null, headData: null, changes: [] });
  const [selectedBuildingCode, setSelectedBuildingCode] = useState('');
  const [selectedKey, setSelectedKey] = useState('');

  useEffect(() => {
    if (!prNumber) return undefined;
    let cancelled = false;

    async function load() {
      setState((current) => ({ ...current, status: 'loading', error: '' }));
      try {
        const prResponse = await fetch(`https://api.github.com/repos/${REPOSITORY}/pulls/${prNumber}`, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!prResponse.ok) throw new Error(`GitHub returned ${prResponse.status} for PR #${prNumber}.`);
        const pr = await prResponse.json();
        const baseRepo = pr.base?.repo?.full_name ?? REPOSITORY;
        const headRepo = pr.head?.repo?.full_name ?? REPOSITORY;
        const baseSha = pr.base?.sha;
        const headSha = pr.head?.sha;
        if (!baseSha || !headSha) throw new Error('The PR is missing a base or head commit.');

        const [baseResponse, headResponse] = await Promise.all([
          fetch(`https://raw.githubusercontent.com/${baseRepo}/${baseSha}/${ENTRANCE_PATH}`, { cache: 'no-store' }),
          fetch(`https://raw.githubusercontent.com/${headRepo}/${headSha}/${ENTRANCE_PATH}`, { cache: 'no-store' }),
        ]);
        if (!baseResponse.ok || !headResponse.ok) {
          throw new Error('Could not load entrances.geojson from both sides of this PR.');
        }
        const [baseData, headData] = await Promise.all([baseResponse.json(), headResponse.json()]);
        const changes = diffEntrances(baseData, headData);
        if (cancelled) return;
        setState({ status: 'ready', error: '', pr, headData, changes });
        const firstCode = changes[0]?.feature?.properties?.buildingCode?.toUpperCase() ?? '';
        setSelectedBuildingCode(firstCode);
        setSelectedKey(changes[0]?.key ?? '');
      } catch (error) {
        if (!cancelled) setState({ status: 'error', error: error.message, pr: null, headData: null, changes: [] });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [prNumber]);

  const buildingCodes = useMemo(
    () => [...new Set(state.changes.map((change) => change.feature?.properties?.buildingCode?.toUpperCase()).filter(Boolean))],
    [state.changes],
  );

  const selectedFootprints = groupedFootprints.get(selectedBuildingCode) ?? [];
  const viewBox = boundsForFeatures(selectedFootprints.length ? selectedFootprints : [...groupedFootprints.values()].flat());
  const viewBoxValue = `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
  const changesForBuilding = state.changes.filter(
    (change) => change.feature?.properties?.buildingCode?.toUpperCase() === selectedBuildingCode,
  );
  const headContext = (state.headData?.features ?? []).filter(
    (feature) => feature.properties?.buildingCode?.toUpperCase() === selectedBuildingCode,
  );
  const selectedChange = state.changes.find((change) => change.key === selectedKey) ?? changesForBuilding[0] ?? null;

  function loadPr(event) {
    event.preventDefault();
    const parsed = Number.parseInt(inputValue, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    setPrNumber(parsed);
    const params = new URLSearchParams(window.location.search);
    params.set('pr', String(parsed));
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }

  return (
    <div className="pr-review-shell">
      <header className="pr-review-topbar">
        <a href="/" className="pr-review-brand">
          <span>Y</span><strong>Gapwise <em>Data</em></strong><i /> <small>VISUAL PR REVIEW</small>
        </a>
        <div className="pr-review-top-actions">
          <a href="/contribute">Contribute entrances</a>
          <a href={`https://github.com/${REPOSITORY}`} target="_blank" rel="noreferrer">GitHub <ExternalLink size={13} /></a>
        </div>
      </header>

      {!prNumber ? (
        <main className="pr-review-empty-page">
          <div className="pr-review-empty-card">
            <div className="pr-review-logo"><MapPin size={24} /></div>
            <span className="pr-review-kicker">NO RAW GEOJSON REQUIRED</span>
            <h1>Open an entrance PR on the map.</h1>
            <p>GitHub review comments link here automatically. You can also enter a PR number manually.</p>
            <form onSubmit={loadPr}>
              <Search size={17} />
              <input value={inputValue} onChange={(event) => setInputValue(event.target.value)} placeholder="Pull request number" inputMode="numeric" />
              <button type="submit">Open review</button>
            </form>
          </div>
        </main>
      ) : (
        <main className="pr-review-main">
          <aside className="pr-review-sidebar">
            <div className="pr-review-side-head">
              <span className="pr-review-kicker">PULL REQUEST</span>
              <h1>#{prNumber}</h1>
              {state.pr ? <p>{state.pr.title}</p> : null}
              <form className="pr-review-inline-search" onSubmit={loadPr}>
                <input value={inputValue} onChange={(event) => setInputValue(event.target.value)} aria-label="Pull request number" />
                <button type="submit"><RefreshCw size={14} /></button>
              </form>
            </div>

            {state.status === 'loading' ? (
              <div className="pr-review-state"><LoaderCircle className="spin" size={20} /><strong>Loading PR map…</strong><span>Comparing base and head entrance datasets.</span></div>
            ) : null}
            {state.status === 'error' ? (
              <div className="pr-review-state error"><CircleAlert size={20} /><strong>Could not build visual review</strong><span>{state.error}</span></div>
            ) : null}

            {state.status === 'ready' ? (
              <>
                <section className="pr-review-summary">
                  <div><strong>{state.changes.length}</strong><span>entrance changes</span></div>
                  <div><strong>{buildingCodes.length}</strong><span>buildings</span></div>
                  <div><strong>{state.changes.filter((change) => change.status === 'added').length}</strong><span>new points</span></div>
                </section>

                {buildingCodes.length ? (
                  <section className="pr-review-building-tabs">
                    <span>Buildings</span>
                    <div>
                      {buildingCodes.map((code) => (
                        <button key={code} className={code === selectedBuildingCode ? 'selected' : ''} type="button" onClick={() => {
                          setSelectedBuildingCode(code);
                          const first = state.changes.find((change) => change.feature?.properties?.buildingCode?.toUpperCase() === code);
                          setSelectedKey(first?.key ?? '');
                        }}>{code}</button>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section className="pr-review-change-list">
                  <div className="pr-review-list-heading"><span>Changes in {selectedBuildingCode || 'dataset'}</span><small>{changesForBuilding.length}</small></div>
                  {!state.changes.length ? (
                    <div className="pr-review-no-changes"><CheckCircle2 size={18} /><span>This PR does not change entrance features.</span></div>
                  ) : null}
                  {changesForBuilding.map((change, index) => (
                    <button key={change.key} type="button" className={change.key === selectedKey ? 'selected' : ''} onClick={() => setSelectedKey(change.key)}>
                      <span className={`pr-review-status ${change.status}`}>{statusLabel(change.status)}</span>
                      <span className="pr-review-change-copy">
                        <strong>{change.feature.properties?.label || change.feature.id || `Entrance ${index + 1}`}</strong>
                        <small>{coordinatesText(change.feature)}</small>
                      </span>
                    </button>
                  ))}
                </section>

                {state.pr ? (
                  <a className="pr-review-github-button" href={state.pr.html_url} target="_blank" rel="noreferrer">
                    Open PR on GitHub <ExternalLink size={13} />
                  </a>
                ) : null}
              </>
            ) : null}
          </aside>

          <section className="pr-review-workspace">
            <div className="pr-review-workspace-head">
              <div>
                <span className="pr-review-kicker">VISUAL DIFF</span>
                <h2>{selectedBuildingCode ? `${selectedBuildingCode} entrances` : 'Entrance changes'}</h2>
                <p>Canonical head points are gray. This PR’s additions/changes are highlighted and numbered.</p>
              </div>
              {state.pr ? <span className={`pr-review-pr-state ${state.pr.state}`}>{state.pr.state}</span> : null}
            </div>

            <div className="pr-review-map">
              {state.status === 'ready' && selectedBuildingCode ? (
                <svg viewBox={viewBoxValue} role="img" aria-label={`Visual entrance diff for ${selectedBuildingCode}`}>
                  <rect x="0" y="0" width="1000" height="760" className="pr-review-map-bg" />
                  {selectedFootprints.map((feature, index) => (
                    <path key={`${selectedBuildingCode}-${index}`} d={pathForGeometry(feature.geometry)} className="pr-review-footprint" />
                  ))}
                  {headContext.map((feature) => {
                    const [x, y] = project(feature.geometry.coordinates);
                    return <circle key={featureKey(feature)} cx={x} cy={y} r="5" className="pr-review-context-dot" />;
                  })}
                  {changesForBuilding.map((change, index) => {
                    const [x, y] = project(change.feature.geometry.coordinates);
                    const selected = change.key === selectedKey;
                    return (
                      <g key={change.key} className={`pr-review-marker ${change.status} ${selected ? 'selected' : ''}`} onClick={() => setSelectedKey(change.key)}>
                        {change.status === 'modified' && change.previous?.geometry?.type === 'Point' ? (() => {
                          const [oldX, oldY] = project(change.previous.geometry.coordinates);
                          return <line x1={oldX} y1={oldY} x2={x} y2={y} className="pr-review-move-line" />;
                        })() : null}
                        <circle cx={x} cy={y} r={selected ? 13 : 10} />
                        <circle cx={x} cy={y} r="3.5" className="pr-review-marker-core" />
                        <text x={x + 14} y={y - 12}>{index + 1}</text>
                      </g>
                    );
                  })}
                </svg>
              ) : (
                <div className="pr-review-map-placeholder">
                  {state.status === 'loading' ? <LoaderCircle className="spin" size={28} /> : <MapPin size={28} />}
                  <span>{state.status === 'loading' ? 'Building visual diff…' : 'No entrance geometry to display.'}</span>
                </div>
              )}
              <div className="pr-review-legend">
                <span><i className="context" /> canonical in PR</span>
                <span><i className="added" /> new</span>
                <span><i className="modified" /> changed</span>
                <span><i className="removed" /> removed</span>
              </div>
            </div>

            {selectedChange ? (
              <div className="pr-review-detail">
                <div className="pr-review-detail-title">
                  <span className={`pr-review-status ${selectedChange.status}`}>{statusLabel(selectedChange.status)}</span>
                  <div><strong>{selectedChange.feature.properties?.label || selectedChange.feature.id || 'Entrance'}</strong><small>{coordinatesText(selectedChange.feature)}</small></div>
                </div>
                <div className="pr-review-detail-grid">
                  <div><span>Building</span><strong>{selectedChange.feature.properties?.buildingCode ?? '—'}</strong></div>
                  <div><span>Kind</span><strong>{selectedChange.feature.properties?.kind ?? '—'}</strong></div>
                  <div><span>Accessibility</span><strong>{selectedChange.feature.properties?.accessibility ?? selectedChange.feature.properties?.barrierFree ?? '—'}</strong></div>
                  <div><span>Verification</span><strong>{selectedChange.feature.properties?.verificationStatus ?? '—'}</strong></div>
                  <div><span>Source</span><strong>{selectedChange.feature.properties?.source ?? '—'}</strong></div>
                  <div><span>Feature ID</span><strong>{selectedChange.feature.id ?? '—'}</strong></div>
                </div>
                {selectedChange.status === 'modified' ? (
                  <div className="pr-review-modified-note"><ArrowLeftRight size={15} /> Compare the highlighted point with the gray canonical context; movement is drawn when coordinates changed.</div>
                ) : null}
              </div>
            ) : null}
          </section>
        </main>
      )}
    </div>
  );
}
