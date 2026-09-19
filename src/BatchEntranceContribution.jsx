import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Layers3,
  MapPin,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  buildings,
  boundsForFeatures,
  entranceFeatures,
  footprintFeatures,
  groupedFootprints,
  metersBetween,
  pathForGeometry,
  project,
  todayLocalDate,
  unproject,
} from './entrance-map-data.js';
import './batch-entrance.css';

const DATA_REPOSITORY = 'https://github.com/Gapwise-for-UofT/data';
const MAX_BATCH_SIZE = 40;
const DUPLICATE_WARNING_METERS = 7;

function initialBuildingCode() {
  const requested = new URLSearchParams(window.location.search).get('building')?.trim().toUpperCase();
  return buildings.some((building) => building.code === requested) ? requested : buildings[0]?.code ?? '';
}

function createDefaults() {
  return {
    publicAccess: 'unknown',
    direction: 'unknown',
    barrierFree: 'unknown',
    observationMethod: 'field_observation',
    observedAt: todayLocalDate(),
  };
}

function humanize(value) {
  return String(value ?? '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function issueTitle(entries) {
  const codes = [...new Set(entries.map((entry) => entry.buildingCode))];
  if (codes.length === 1) return `New entrances: ${codes[0]} (${entries.length})`;
  return `New entrances batch (${entries.length})`;
}

function machinePayload(entries) {
  return {
    schemaVersion: 2,
    contributionType: 'new_entrance_batch',
    entrances: entries.map((entry) => ({
      buildingCode: entry.buildingCode,
      buildingName: entry.buildingName,
      geometry: { type: 'Point', coordinates: entry.coordinates },
      proposedLabel: entry.label || null,
      entranceKind: 'exterior_entrance',
      claims: {
        publicAccess: entry.publicAccess,
        direction: entry.direction,
        barrierFree: entry.barrierFree,
      },
      evidence: {
        method: entry.observationMethod,
        observedAt: entry.observedAt,
      },
      contributorNotes: entry.notes || null,
    })),
    submittedVia: 'https://data.gapwise.ca/contribute',
    createdAt: new Date().toISOString(),
  };
}

function issueBody(entries) {
  const codes = [...new Set(entries.map((entry) => entry.buildingCode))];
  const summary = entries
    .map((entry, index) => {
      const [longitude, latitude] = entry.coordinates;
      return `| ${index + 1} | ${entry.buildingCode} | ${entry.label || '—'} | ${latitude.toFixed(7)}, ${longitude.toFixed(7)} | ${humanize(entry.publicAccess)} | ${humanize(entry.direction)} | ${humanize(entry.barrierFree)} |`;
    })
    .join('\n');

  return `## Entrance batch contribution

**Entrances:** ${entries.length}  
**Buildings:** ${codes.join(', ')}  
**Evidence:** contributor-provided observation data

This issue was produced by the Gapwise Data batch entrance studio. Each marker was placed visually on the campus map. Reviewers should use the visual PR review link once the corresponding data PR exists.

### Entrances

| # | Building | Label | Coordinates | Public access | Direction | Barrier-free |
|---:|---|---|---|---|---|---|
${summary}

### Machine-readable contribution

\`\`\`json
${JSON.stringify(machinePayload(entries), null, 2)}
\`\`\`

---
Submitted from [Gapwise Data](${DATA_REPOSITORY}).`;
}

function SelectField({ label, value, onChange, children }) {
  return (
    <label className="batch-field">
      <span>{label}</span>
      <div className="batch-select-wrap">
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {children}
        </select>
        <ChevronDown size={15} aria-hidden="true" />
      </div>
    </label>
  );
}

function nearestExisting(entry) {
  let nearest = null;
  entranceFeatures.forEach((feature) => {
    if (feature.properties.buildingCode?.toUpperCase() !== entry.buildingCode) return;
    const distance = metersBetween(entry.coordinates, feature.geometry.coordinates);
    if (!nearest || distance < nearest.distance) nearest = { feature, distance };
  });
  return nearest;
}

export default function BatchEntranceContribution() {
  const [buildingCode, setBuildingCode] = useState(initialBuildingCode);
  const [buildingQuery, setBuildingQuery] = useState('');
  const [showBuildingPicker, setShowBuildingPicker] = useState(false);
  const [defaults, setDefaults] = useState(createDefaults);
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [notice, setNotice] = useState('');
  const svgRef = useRef(null);

  const selectedBuilding = useMemo(
    () => buildings.find((building) => building.code === buildingCode) ?? buildings[0],
    [buildingCode],
  );
  const selectedFootprints = groupedFootprints.get(selectedBuilding?.code) ?? [];
  const viewBox = boundsForFeatures(selectedFootprints);
  const viewBoxValue = `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;
  const selectedCanonicalEntrances = entranceFeatures.filter(
    (feature) => feature.properties.buildingCode?.toUpperCase() === selectedBuilding?.code,
  );
  const selectedBatchEntries = entries.filter((entry) => entry.buildingCode === selectedBuilding?.code);
  const selectedEntry = entries.find((entry) => entry.id === selectedId) ?? null;

  const filteredBuildings = useMemo(() => {
    const query = buildingQuery.trim().toLowerCase();
    if (!query) return buildings;
    return buildings.filter(
      (building) =>
        building.code.toLowerCase().includes(query) || building.name.toLowerCase().includes(query),
    );
  }, [buildingQuery]);

  function selectBuilding(code) {
    setBuildingCode(code);
    setBuildingQuery('');
    setShowBuildingPicker(false);
    setSelectedId(null);
    setReviewing(false);
    const params = new URLSearchParams(window.location.search);
    params.set('building', code);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }

  function addAtEvent(event) {
    if (reviewing || entries.length >= MAX_BATCH_SIZE || !svgRef.current || !selectedBuilding) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width;
    const y = viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height;
    const coordinates = unproject([x, y]);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextEntry = {
      id,
      buildingCode: selectedBuilding.code,
      buildingName: selectedBuilding.name,
      coordinates,
      label: '',
      notes: '',
      ...defaults,
    };
    setEntries((current) => [...current, nextEntry]);
    setSelectedId(id);
    setNotice('');
  }

  function updateSelected(patch) {
    if (!selectedId) return;
    setEntries((current) =>
      current.map((entry) => (entry.id === selectedId ? { ...entry, ...patch } : entry)),
    );
  }

  function removeEntry(id) {
    setEntries((current) => current.filter((entry) => entry.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function undoLast() {
    setEntries((current) => {
      if (!current.length) return current;
      const next = current.slice(0, -1);
      if (current[current.length - 1].id === selectedId) setSelectedId(null);
      return next;
    });
  }

  function openIssue() {
    if (!entries.length) return;
    const url = new URL(`${DATA_REPOSITORY}/issues/new`);
    url.searchParams.set('title', issueTitle(entries));
    url.searchParams.set('body', issueBody(entries));
    const href = url.toString();
    if (href.length > 65000) {
      setNotice('This batch is too large for one GitHub issue. Submit part of it, then start another batch.');
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  const warningCount = entries.filter((entry) => {
    const nearest = nearestExisting(entry);
    return nearest && nearest.distance <= DUPLICATE_WARNING_METERS;
  }).length;

  return (
    <div className="batch-shell">
      <header className="batch-topbar">
        <a className="batch-brand" href="/">
          <span className="batch-brand-mark">Y</span>
          <strong>Gapwise <em>Data</em></strong>
          <span className="batch-brand-divider" />
          <span className="batch-section-label">BATCH CONTRIBUTE</span>
        </a>
        <nav>
          <a href="/">Data home</a>
          <a className="active" href="/contribute">Contribute</a>
          <a href="/studio/entrances">Studio</a>
          <a href={DATA_REPOSITORY} target="_blank" rel="noreferrer">
            GitHub <ExternalLink size={13} />
          </a>
        </nav>
      </header>

      <main className="batch-main">
        <aside className="batch-sidebar">
          <section className="batch-side-section batch-building-section">
            <div className="batch-eyebrow">1 · BUILDING</div>
            <button
              type="button"
              className="batch-building-button"
              onClick={() => setShowBuildingPicker((value) => !value)}
            >
              <span className="batch-code-chip">{selectedBuilding?.code}</span>
              <span>
                <strong>{selectedBuilding?.name}</strong>
                <small>{selectedBuilding?.entranceCount ?? 0} mapped entrances</small>
              </span>
              <ChevronDown size={16} />
            </button>
            {showBuildingPicker ? (
              <div className="batch-building-picker">
                <label className="batch-search">
                  <Search size={15} />
                  <input
                    autoFocus
                    value={buildingQuery}
                    onChange={(event) => setBuildingQuery(event.target.value)}
                    placeholder="Code or building name"
                  />
                </label>
                <div className="batch-building-results">
                  {filteredBuildings.slice(0, 18).map((building) => (
                    <button key={building.code} type="button" onClick={() => selectBuilding(building.code)}>
                      <span>{building.code}</span>
                      <strong>{building.name}</strong>
                      <small>{building.entranceCount}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <section className="batch-side-section">
            <div className="batch-eyebrow">2 · DEFAULTS FOR NEW MARKERS</div>
            <p className="batch-muted">Set these once, then click every entrance you can verify.</p>
            <div className="batch-field-grid">
              <SelectField
                label="Public access"
                value={defaults.publicAccess}
                onChange={(publicAccess) => setDefaults((current) => ({ ...current, publicAccess }))}
              >
                <option value="verified">Verified</option>
                <option value="restricted">Restricted</option>
                <option value="unknown">Unknown</option>
              </SelectField>
              <SelectField
                label="Direction"
                value={defaults.direction}
                onChange={(direction) => setDefaults((current) => ({ ...current, direction }))}
              >
                <option value="bidirectional">Bidirectional</option>
                <option value="entry_only">Entry only</option>
                <option value="exit_only">Exit only</option>
                <option value="unknown">Unknown</option>
              </SelectField>
              <SelectField
                label="Barrier-free"
                value={defaults.barrierFree}
                onChange={(barrierFree) => setDefaults((current) => ({ ...current, barrierFree }))}
              >
                <option value="verified">Verified</option>
                <option value="not_barrier_free">Not barrier-free</option>
                <option value="unknown">Unknown</option>
              </SelectField>
              <SelectField
                label="Evidence"
                value={defaults.observationMethod}
                onChange={(observationMethod) =>
                  setDefaults((current) => ({ ...current, observationMethod }))
                }
              >
                <option value="field_observation">Field observation</option>
                <option value="official_source">Official source</option>
                <option value="other">Other</option>
              </SelectField>
            </div>
            <label className="batch-field batch-date-field">
              <span>Observed</span>
              <input
                type="date"
                value={defaults.observedAt}
                onChange={(event) =>
                  setDefaults((current) => ({ ...current, observedAt: event.target.value }))
                }
              />
            </label>
          </section>

          <section className="batch-side-section batch-queue-section">
            <div className="batch-queue-heading">
              <div>
                <div className="batch-eyebrow">3 · BATCH</div>
                <strong>{entries.length} entrance{entries.length === 1 ? '' : 's'} queued</strong>
              </div>
              {entries.length ? (
                <button type="button" className="batch-icon-button" onClick={undoLast} title="Undo last marker">
                  <Undo2 size={16} />
                </button>
              ) : null}
            </div>
            {!entries.length ? (
              <div className="batch-empty-queue">
                <MapPin size={18} />
                <p>Click the map to start. Keep clicking—each point joins the same review batch.</p>
              </div>
            ) : (
              <div className="batch-queue-list">
                {entries.map((entry, index) => {
                  const nearest = nearestExisting(entry);
                  const warning = nearest && nearest.distance <= DUPLICATE_WARNING_METERS;
                  return (
                    <button
                      type="button"
                      key={entry.id}
                      className={`batch-queue-item ${entry.id === selectedId ? 'selected' : ''}`}
                      onClick={() => {
                        if (entry.buildingCode !== buildingCode) selectBuilding(entry.buildingCode);
                        setSelectedId(entry.id);
                      }}
                    >
                      <span className="batch-number">{index + 1}</span>
                      <span className="batch-queue-copy">
                        <strong>{entry.label || `${entry.buildingCode} entrance`}</strong>
                        <small>{entry.coordinates[1].toFixed(6)}, {entry.coordinates[0].toFixed(6)}</small>
                      </span>
                      {warning ? <CircleAlert size={15} className="batch-warning-icon" /> : <Check size={15} />}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <div className="batch-sidebar-actions">
            <a className="batch-secondary-button" href="/contribute/single">
              Guided single mode
            </a>
            <button
              type="button"
              className="batch-primary-button"
              disabled={!entries.length}
              onClick={() => setReviewing(true)}
            >
              Review {entries.length || ''} entrance{entries.length === 1 ? '' : 's'}
            </button>
          </div>
        </aside>

        <section className="batch-workspace">
          <div className="batch-map-toolbar">
            <div>
              <span className="batch-map-kicker">{reviewing ? 'REVIEW MODE' : 'FAST CAPTURE'}</span>
              <h1>
                {reviewing ? 'Check the whole batch visually.' : `Click every ${selectedBuilding?.code} entrance.`}
              </h1>
              <p>
                {reviewing
                  ? 'Red numbered points are this batch. Gray points are already canonical.'
                  : 'No save button between points. Click, click, click—then edit only the exceptions.'}
              </p>
            </div>
            <div className="batch-map-actions">
              {reviewing ? (
                <button type="button" onClick={() => setReviewing(false)}>
                  <ArrowLeft size={16} /> Back to editing
                </button>
              ) : null}
              <button
                type="button"
                disabled={!selectedBatchEntries.length}
                onClick={() => {
                  setEntries((current) => current.filter((entry) => entry.buildingCode !== buildingCode));
                  setSelectedId(null);
                }}
              >
                <RotateCcw size={16} /> Clear {selectedBuilding?.code}
              </button>
            </div>
          </div>

          <div className={`batch-map-frame ${reviewing ? 'reviewing' : ''}`}>
            <svg
              ref={svgRef}
              viewBox={viewBoxValue}
              role="img"
              aria-label={`Entrance map for ${selectedBuilding?.name}`}
              onClick={addAtEvent}
            >
              <rect x="0" y="0" width="1000" height="760" className="batch-map-bg" />
              {footprintFeatures.map((feature, index) => {
                const code = feature.properties.buildingCode?.toUpperCase();
                const selected = code === selectedBuilding?.code;
                return (
                  <path
                    key={`${code}-${index}`}
                    d={pathForGeometry(feature.geometry)}
                    className={selected ? 'batch-footprint selected' : 'batch-footprint'}
                  />
                );
              })}

              {selectedCanonicalEntrances.map((feature) => {
                const [x, y] = project(feature.geometry.coordinates);
                return <circle key={feature.id ?? `${x}-${y}`} cx={x} cy={y} r="5" className="batch-canonical-dot" />;
              })}

              {selectedBatchEntries.map((entry) => {
                const [x, y] = project(entry.coordinates);
                const index = entries.findIndex((candidate) => candidate.id === entry.id) + 1;
                const nearest = nearestExisting(entry);
                const warning = nearest && nearest.distance <= DUPLICATE_WARNING_METERS;
                return (
                  <g
                    key={entry.id}
                    className={`batch-new-marker ${entry.id === selectedId ? 'selected' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(entry.id);
                    }}
                  >
                    {warning ? <circle cx={x} cy={y} r="16" className="batch-warning-ring" /> : null}
                    <circle cx={x} cy={y} r="11" />
                    <circle cx={x} cy={y} r="4" className="batch-new-marker-core" />
                    <text x={x + 14} y={y - 12}>{index}</text>
                  </g>
                );
              })}
            </svg>

            <div className="batch-map-legend">
              <span><i className="canonical" /> mapped entrance</span>
              <span><i className="new" /> your batch</span>
              <span><i className="warning" /> near existing</span>
            </div>
            {!reviewing ? (
              <div className="batch-map-hint"><MapPin size={16} /> Click map to add marker</div>
            ) : null}
          </div>

          {selectedEntry && !reviewing ? (
            <div className="batch-editor-card">
              <div className="batch-editor-title">
                <div>
                  <span className="batch-number">{entries.findIndex((entry) => entry.id === selectedEntry.id) + 1}</span>
                  <div>
                    <strong>{selectedEntry.buildingCode} entrance</strong>
                    <small>{selectedEntry.coordinates[1].toFixed(7)}, {selectedEntry.coordinates[0].toFixed(7)}</small>
                  </div>
                </div>
                <button type="button" className="batch-icon-button danger" onClick={() => removeEntry(selectedEntry.id)}>
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="batch-editor-grid">
                <label className="batch-field">
                  <span>Optional label</span>
                  <input
                    value={selectedEntry.label}
                    onChange={(event) => updateSelected({ label: event.target.value })}
                    placeholder="e.g. West doors"
                  />
                </label>
                <SelectField label="Public access" value={selectedEntry.publicAccess} onChange={(publicAccess) => updateSelected({ publicAccess })}>
                  <option value="verified">Verified</option>
                  <option value="restricted">Restricted</option>
                  <option value="unknown">Unknown</option>
                </SelectField>
                <SelectField label="Direction" value={selectedEntry.direction} onChange={(direction) => updateSelected({ direction })}>
                  <option value="bidirectional">Bidirectional</option>
                  <option value="entry_only">Entry only</option>
                  <option value="exit_only">Exit only</option>
                  <option value="unknown">Unknown</option>
                </SelectField>
                <SelectField label="Barrier-free" value={selectedEntry.barrierFree} onChange={(barrierFree) => updateSelected({ barrierFree })}>
                  <option value="verified">Verified</option>
                  <option value="not_barrier_free">Not barrier-free</option>
                  <option value="unknown">Unknown</option>
                </SelectField>
                <label className="batch-field batch-notes-field">
                  <span>Optional note</span>
                  <input
                    value={selectedEntry.notes}
                    onChange={(event) => updateSelected({ notes: event.target.value })}
                    placeholder="Anything a reviewer should know"
                  />
                </label>
              </div>
              {(() => {
                const nearest = nearestExisting(selectedEntry);
                if (!nearest || nearest.distance > DUPLICATE_WARNING_METERS) return null;
                return (
                  <div className="batch-duplicate-warning">
                    <CircleAlert size={16} />
                    <span>
                      About {nearest.distance.toFixed(1)} m from an existing mapped entrance. Keep it if these are genuinely separate doors.
                    </span>
                  </div>
                );
              })()}
            </div>
          ) : null}

          {reviewing ? (
            <div className="batch-review-bar">
              <div className="batch-review-summary">
                <span className="batch-review-icon"><Layers3 size={19} /></span>
                <div>
                  <strong>{entries.length} entrance{entries.length === 1 ? '' : 's'} ready for review</strong>
                  <small>
                    {new Set(entries.map((entry) => entry.buildingCode)).size} building{new Set(entries.map((entry) => entry.buildingCode)).size === 1 ? '' : 's'}
                    {warningCount ? ` · ${warningCount} proximity warning${warningCount === 1 ? '' : 's'}` : ' · no proximity warnings'}
                  </small>
                </div>
              </div>
              <div className="batch-review-actions">
                {notice ? <span className="batch-submit-notice">{notice}</span> : null}
                <button type="button" className="batch-primary-button" onClick={openIssue}>
                  Open one GitHub review issue <ExternalLink size={14} />
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
