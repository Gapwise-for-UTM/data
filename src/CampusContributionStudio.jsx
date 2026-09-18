import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  MapPin,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  CAMPUSES,
  CAMPUS_IDS,
  MAP_HEIGHT,
  MAP_WIDTH,
  campusFromQuery,
  canonicalBuildingsForCampus,
  canonicalEntrancesForCampus,
  canonicalFootprintsForCampus,
  createCampusProjection,
  geometryBounds,
  geometryPath,
  makeId,
  metersBetween,
  tilesForCampus,
  todayLocalDate,
} from './campus-contribution-data.js';
import './campus-contribution.css';

const DATA_REPOSITORY = 'https://github.com/Gapwise-for-UTM/data';
const DUPLICATE_WARNING_METERS = 7;
const MAX_ITEMS = 120;

function createDefaults() {
  return {
    publicAccess: 'unknown',
    direction: 'unknown',
    barrierFree: 'unknown',
    observationMethod: 'field_observation',
    observedAt: todayLocalDate(),
  };
}

function createBuildingForm() {
  return { code: '', name: '', category: 'academic' };
}

function createPathForm() {
  return { pathKind: 'pedestrian_path', barrierFree: 'unknown', label: '' };
}

function humanize(value) {
  return String(value ?? '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function SelectField({ label, value, onChange, children }) {
  return (
    <label className="campus-field">
      <span>{label}</span>
      <div className="campus-select-wrap">
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {children}
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </div>
    </label>
  );
}

function inputPoint(event, svg, viewBox, unproject) {
  const rect = svg.getBoundingClientRect();
  const x = viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.width;
  const y = viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.height;
  return unproject([x, y]);
}

function mergeViewBoxes(viewBoxes) {
  if (!viewBoxes.length) return { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT };
  const minX = Math.min(...viewBoxes.map((box) => box.x));
  const minY = Math.min(...viewBoxes.map((box) => box.y));
  const maxX = Math.max(...viewBoxes.map((box) => box.x + box.width));
  const maxY = Math.max(...viewBoxes.map((box) => box.y + box.height));
  return {
    x: Math.max(0, minX),
    y: Math.max(0, minY),
    width: Math.min(MAP_WIDTH, maxX - minX),
    height: Math.min(MAP_HEIGHT, maxY - minY),
  };
}

const UTSG_DEFAULT_MAP_BOUNDS = {
  minLon: -79.4085,
  maxLon: -79.3825,
  minLat: 43.6555,
  maxLat: 43.6710,
};

function defaultCampusViewBox(campusId, project) {
  if (campusId !== 'utsg') {
    return { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT };
  }

  const [x1, y1] = project([UTSG_DEFAULT_MAP_BOUNDS.minLon, UTSG_DEFAULT_MAP_BOUNDS.minLat]);
  const [x2, y2] = project([UTSG_DEFAULT_MAP_BOUNDS.maxLon, UTSG_DEFAULT_MAP_BOUNDS.maxLat]);
  let minX = Math.min(x1, x2);
  let maxX = Math.max(x1, x2);
  let minY = Math.min(y1, y2);
  let maxY = Math.max(y1, y2);

  // Match the SVG canvas aspect ratio so the browser does not letterbox the
  // tighter St. George camera with unrelated surrounding Toronto space.
  const targetAspect = MAP_WIDTH / MAP_HEIGHT;
  let width = maxX - minX;
  let height = maxY - minY;
  if (width / height < targetAspect) {
    const expandedWidth = height * targetAspect;
    const delta = (expandedWidth - width) / 2;
    minX -= delta;
    maxX += delta;
    width = expandedWidth;
  } else {
    const expandedHeight = width / targetAspect;
    const delta = (expandedHeight - height) / 2;
    minY -= delta;
    maxY += delta;
    height = expandedHeight;
  }

  minX = Math.max(0, Math.min(minX, MAP_WIDTH - width));
  minY = Math.max(0, Math.min(minY, MAP_HEIGHT - height));
  return { x: minX, y: minY, width, height };
}

function draftBuildingKey(item) {
  return `draft:${item.id}`;
}

function canonicalBuildingKey(code) {
  return `canonical:${code}`;
}

function itemName(item) {
  if (item.type === 'entrance') return `${item.buildingCode} entrance`;
  if (item.type === 'building') return `${item.buildingCode || 'Building'} · ${item.buildingName || 'Unnamed'}`;
  return item.label || humanize(item.pathKind);
}

function machinePayload(items) {
  return {
    schemaVersion: 3,
    contributionType: 'campus_map_batch',
    campuses: [...new Set(items.map((item) => item.campus))],
    items: items.map((item) => {
      if (item.type === 'entrance') {
        return {
          kind: 'new_entrance',
          campus: item.campus,
          building: {
            code: item.buildingCode,
            name: item.buildingName,
            source: item.buildingSource,
            draftId: item.buildingDraftId || null,
          },
          geometry: { type: 'Point', coordinates: item.coordinates },
          proposedLabel: item.label || null,
          entranceKind: 'exterior_entrance',
          claims: {
            publicAccess: item.publicAccess,
            direction: item.direction,
            barrierFree: item.barrierFree,
          },
          evidence: { method: item.observationMethod, observedAt: item.observedAt },
          contributorNotes: item.notes || null,
        };
      }
      if (item.type === 'building') {
        return {
          kind: 'new_building',
          campus: item.campus,
          draftId: item.id,
          buildingCode: item.buildingCode,
          buildingName: item.buildingName,
          category: item.category,
          geometry: item.geometry,
          evidence: { method: item.observationMethod, observedAt: item.observedAt },
        };
      }
      return {
        kind: 'new_path',
        campus: item.campus,
        pathKind: item.pathKind,
        proposedLabel: item.label || null,
        geometry: item.geometry,
        claims: { barrierFree: item.barrierFree },
        evidence: { method: item.observationMethod, observedAt: item.observedAt },
      };
    }),
    submittedVia: 'https://data.gapwise.ca/contribute',
    createdAt: new Date().toISOString(),
  };
}

function issueTitle(items) {
  const campuses = [...new Set(items.map((item) => CAMPUSES[item.campus]?.shortName || item.campus.toUpperCase()))];
  return `Campus map contribution: ${campuses.join(' + ')} (${items.length} changes)`;
}

function issueBody(items) {
  const rows = items
    .map((item, index) => {
      const campus = CAMPUSES[item.campus]?.shortName || item.campus.toUpperCase();
      const geometryType = item.type === 'entrance' ? 'Point' : item.geometry.type;
      return `| ${index + 1} | ${campus} | ${humanize(item.type)} | ${itemName(item).replaceAll('|', '\\|')} | ${geometryType} |`;
    })
    .join('\n');

  return `## Campus map contribution\n\n**Changes:** ${items.length}  \n**Campuses:** ${[
    ...new Set(items.map((item) => CAMPUSES[item.campus]?.shortName)),
  ].join(', ')}\n\nThis batch was drawn visually in the Gapwise Data contribution studio. It may contain entrances, building footprints, and pedestrian paths. Claims default to **unknown** unless the contributor explicitly changes them.\n\n### Changes\n\n| # | Campus | Type | Name / target | Geometry |\n|---:|---|---|---|---|\n${rows}\n\n### Machine-readable contribution\n\n\`\`\`json\n${JSON.stringify(machinePayload(items), null, 2)}\n\`\`\`\n\n---\nSubmitted from [Gapwise Data](${DATA_REPOSITORY}).`;
}

export default function CampusContributionStudio() {
  const [campusId, setCampusId] = useState(campusFromQuery);
  const [tool, setTool] = useState('entrance');
  const [selectedBuildingKey, setSelectedBuildingKey] = useState(null);
  const [selectedEntranceId, setSelectedEntranceId] = useState(null);
  const [buildingQuery, setBuildingQuery] = useState('');
  const [showBuildingPicker, setShowBuildingPicker] = useState(false);
  const [defaults, setDefaults] = useState(createDefaults);
  const [buildingForm, setBuildingForm] = useState(createBuildingForm);
  const [pathForm, setPathForm] = useState(createPathForm);
  const [drawingPoints, setDrawingPoints] = useState([]);
  const [items, setItems] = useState([]);
  const [notice, setNotice] = useState('');
  const svgRef = useRef(null);

  const projection = useMemo(() => createCampusProjection(campusId), [campusId]);
  const { project, unproject } = projection;
  const tiles = useMemo(() => tilesForCampus(campusId, project), [campusId, project]);
  const canonicalBuildings = useMemo(() => canonicalBuildingsForCampus(campusId), [campusId]);
  const canonicalFootprints = useMemo(() => canonicalFootprintsForCampus(campusId), [campusId]);
  const canonicalEntrances = useMemo(() => canonicalEntrancesForCampus(campusId), [campusId]);
  const campusItems = items.filter((item) => item.campus === campusId);
  const draftBuildings = campusItems.filter((item) => item.type === 'building');
  const draftEntrances = campusItems.filter((item) => item.type === 'entrance');
  const draftPaths = campusItems.filter((item) => item.type === 'path');

  const selectableBuildings = useMemo(() => {
    const canonical = canonicalBuildings.map((building) => ({
      key: canonicalBuildingKey(building.code),
      code: building.code,
      name: building.name,
      source: 'canonical',
      features: building.features,
      entranceCount: building.entranceCount,
    }));
    const drafted = items
      .filter((item) => item.type === 'building' && item.campus === campusId)
      .map((item) => ({
        key: draftBuildingKey(item),
        code: item.buildingCode,
        name: item.buildingName,
        source: 'batch_draft',
        draftId: item.id,
        geometry: item.geometry,
        entranceCount: items.filter(
          (candidate) => candidate.type === 'entrance' && candidate.buildingDraftId === item.id,
        ).length,
      }));
    return [...drafted, ...canonical];
  }, [canonicalBuildings, campusId, items]);

  const selectedBuilding = selectableBuildings.find((building) => building.key === selectedBuildingKey) ?? null;
  const selectedEntrance = items.find((item) => item.id === selectedEntranceId && item.type === 'entrance') ?? null;

  const filteredBuildings = useMemo(() => {
    const query = buildingQuery.trim().toLowerCase();
    if (!query) return selectableBuildings;
    return selectableBuildings.filter(
      (building) =>
        building.code.toLowerCase().includes(query) || building.name.toLowerCase().includes(query),
    );
  }, [buildingQuery, selectableBuildings]);

  const viewBox = useMemo(() => {
    if (!selectedBuilding || tool !== 'entrance') {
      return defaultCampusViewBox(campusId, project);
    }
    if (selectedBuilding.geometry) return geometryBounds(selectedBuilding.geometry, project, 1.0);
    const boxes = (selectedBuilding.features ?? []).map((feature) =>
      geometryBounds(feature.geometry, project, 0.55),
    );
    return mergeViewBoxes(boxes);
  }, [campusId, project, selectedBuilding, tool]);
  const viewBoxValue = `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`;

  function setCampus(nextCampus) {
    setCampusId(nextCampus);
    setSelectedBuildingKey(null);
    setSelectedEntranceId(null);
    setDrawingPoints([]);
    setBuildingQuery('');
    setShowBuildingPicker(false);
    setNotice('');
    const params = new URLSearchParams(window.location.search);
    params.set('campus', nextCampus);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }

  function chooseTool(nextTool) {
    setTool(nextTool);
    setSelectedEntranceId(null);
    setDrawingPoints([]);
    setNotice('');
  }

  function selectBuilding(key) {
    setSelectedEntranceId(null);
    setSelectedBuildingKey(key);
    setShowBuildingPicker(false);
    setBuildingQuery('');
  }

  function toggleBuilding(key) {
    if (selectedBuildingKey === key) {
      setSelectedBuildingKey(null);
      setSelectedEntranceId(null);
      return;
    }
    selectBuilding(key);
  }

  function clearSelection() {
    setSelectedEntranceId(null);
    setSelectedBuildingKey(null);
  }

  function addEntrance(coordinates) {
    if (!selectedBuilding) {
      setNotice('Select a building on the map or from the list before adding entrances.');
      return;
    }
    if (items.length >= MAX_ITEMS) {
      setNotice(`One batch can contain up to ${MAX_ITEMS} changes.`);
      return;
    }
    const id = makeId('entrance');
    const item = {
      id,
      type: 'entrance',
      campus: campusId,
      buildingCode: selectedBuilding.code,
      buildingName: selectedBuilding.name,
      buildingSource: selectedBuilding.source,
      buildingDraftId: selectedBuilding.draftId || null,
      coordinates,
      label: '',
      notes: '',
      ...defaults,
    };
    setItems((current) => [...current, item]);
    setSelectedEntranceId(id);
    setNotice('');
  }

  function handleMapClick(event) {
    if (!svgRef.current) return;
    const coordinates = inputPoint(event, svgRef.current, viewBox, unproject);
    if (tool === 'entrance') {
      addEntrance(coordinates);
      return;
    }
    setSelectedEntranceId(null);
    setDrawingPoints((current) => [...current, coordinates]);
  }

  function finishDrawing() {
    if (items.length >= MAX_ITEMS) {
      setNotice(`One batch can contain up to ${MAX_ITEMS} changes.`);
      return;
    }

    if (tool === 'building') {
      if (drawingPoints.length < 3) {
        setNotice('A building footprint needs at least three points.');
        return;
      }
      const code = buildingForm.code.trim().toUpperCase();
      const name = buildingForm.name.trim();
      if (!code || !name) {
        setNotice('Give the building a code and name before finishing the footprint.');
        return;
      }
      const item = {
        id: makeId('building'),
        type: 'building',
        campus: campusId,
        buildingCode: code,
        buildingName: name,
        category: buildingForm.category,
        geometry: { type: 'Polygon', coordinates: [[...drawingPoints, drawingPoints[0]]] },
        observationMethod: defaults.observationMethod,
        observedAt: defaults.observedAt,
      };
      setItems((current) => [...current, item]);
      setDrawingPoints([]);
      setBuildingForm(createBuildingForm());
      setSelectedBuildingKey(draftBuildingKey(item));
      setTool('entrance');
      setNotice('Building added and selected. You can place its entrances immediately.');
      return;
    }

    if (tool === 'path') {
      if (drawingPoints.length < 2) {
        setNotice('A path needs at least two points.');
        return;
      }
      const item = {
        id: makeId('path'),
        type: 'path',
        campus: campusId,
        pathKind: pathForm.pathKind,
        label: pathForm.label.trim(),
        barrierFree: pathForm.barrierFree,
        geometry: { type: 'LineString', coordinates: drawingPoints },
        observationMethod: defaults.observationMethod,
        observedAt: defaults.observedAt,
      };
      setItems((current) => [...current, item]);
      setDrawingPoints([]);
      setPathForm(createPathForm());
      setNotice('Path added to the batch.');
    }
  }

  function updateSelectedEntrance(patch) {
    if (!selectedEntranceId) return;
    setItems((current) =>
      current.map((item) => (item.id === selectedEntranceId ? { ...item, ...patch } : item)),
    );
  }

  function removeItem(id) {
    const removed = items.find((item) => item.id === id);
    setItems((current) => {
      let next = current.filter((item) => item.id !== id);
      if (removed?.type === 'building') {
        next = next.filter((item) => item.buildingDraftId !== removed.id);
      }
      return next;
    });
    if (selectedEntranceId === id) setSelectedEntranceId(null);
    if (removed?.type === 'building' && selectedBuildingKey === draftBuildingKey(removed)) {
      setSelectedBuildingKey(null);
    }
  }

  function openIssue() {
    if (!items.length) return;
    const url = new URL(`${DATA_REPOSITORY}/issues/new`);
    url.searchParams.set('title', issueTitle(items));
    url.searchParams.set('body', issueBody(items));
    if (url.toString().length > 65000) {
      setNotice('This batch is too large for one GitHub issue. Submit part of it, then continue in another batch.');
      return;
    }
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  }

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        if (selectedEntranceId) setSelectedEntranceId(null);
        else if (drawingPoints.length) setDrawingPoints([]);
        else if (selectedBuildingKey) setSelectedBuildingKey(null);
      }
      if (event.key === 'Enter' && drawingPoints.length && (tool === 'building' || tool === 'path')) {
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLTextAreaElement
        ) return;
        event.preventDefault();
        finishDrawing();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const selectedCanonicalEntrances = selectedBuilding?.source === 'canonical'
    ? canonicalEntrances.filter(
        (feature) => feature.properties.buildingCode?.toUpperCase() === selectedBuilding.code,
      )
    : [];

  const warningCount = draftEntrances.filter((entry) => {
    if (campusId !== 'utm' || entry.buildingSource !== 'canonical') return false;
    return canonicalEntrances.some(
      (feature) =>
        feature.properties.buildingCode?.toUpperCase() === entry.buildingCode &&
        metersBetween(entry.coordinates, feature.geometry.coordinates) <= DUPLICATE_WARNING_METERS,
    );
  }).length;

  return (
    <div className="campus-shell">
      <header className="campus-topbar">
        <a className="campus-brand" href="/">
          <span className="campus-brand-mark">Y</span>
          <strong>Gapwise <em>Data</em></strong>
          <span className="campus-brand-divider" />
          <span className="campus-section-label">CONTRIBUTE</span>
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

      <div className="campus-campusbar">
        <span>Campus</span>
        {CAMPUS_IDS.map((id) => (
          <button
            type="button"
            key={id}
            className={campusId === id ? 'active' : ''}
            onClick={() => setCampus(id)}
          >
            <strong>{CAMPUSES[id].shortName}</strong>
            <small>{CAMPUSES[id].name}</small>
          </button>
        ))}
      </div>

      <main className="campus-main">
        <aside className="campus-sidebar">
          <section className="campus-section">
            <div className="campus-eyebrow">1 · WHAT ARE YOU ADDING?</div>
            <div className="campus-tool-tabs">
              <button type="button" className={tool === 'entrance' ? 'active' : ''} onClick={() => chooseTool('entrance')}>
                <MapPin size={16} /> Entrances
              </button>
              <button type="button" className={tool === 'building' ? 'active' : ''} onClick={() => chooseTool('building')}>
                <span className="campus-tool-glyph">▰</span> Buildings
              </button>
              <button type="button" className={tool === 'path' ? 'active' : ''} onClick={() => chooseTool('path')}>
                <span className="campus-tool-glyph">⌁</span> Paths
              </button>
            </div>
          </section>

          {tool === 'entrance' ? (
            <>
              <section className="campus-section campus-building-section">
                <div className="campus-section-heading">
                  <div>
                    <div className="campus-eyebrow">2 · SELECT BUILDING</div>
                    <p>Click a footprint on the map, or use the list.</p>
                  </div>
                  {selectedBuilding ? (
                    <button type="button" className="campus-clear-button" onClick={() => clearSelection()}>
                      Deselect
                    </button>
                  ) : null}
                </div>

                {selectedBuilding ? (
                  <button type="button" className="campus-selected-building" onClick={() => clearSelection()} title="Deselect building">
                    <span>{selectedBuilding.code}</span>
                    <strong>{selectedBuilding.name}</strong>
                    <small>Selected · click to clear ×</small>
                  </button>
                ) : (
                  <div className="campus-no-building">
                    <MapPin size={17} />
                    <span>No building selected. Click a mapped footprint or draw a building first.</span>
                  </div>
                )}

                <button type="button" className="campus-picker-button" onClick={() => setShowBuildingPicker((value) => !value)}>
                  <Search size={15} /> Find by code or name <ChevronDown size={14} />
                </button>
                {showBuildingPicker ? (
                  <div className="campus-building-picker">
                    <label className="campus-search">
                      <Search size={14} />
                      <input
                        autoFocus
                        value={buildingQuery}
                        onChange={(event) => setBuildingQuery(event.target.value)}
                        placeholder="Search buildings"
                      />
                    </label>
                    <div className="campus-building-results">
                      {filteredBuildings.length ? filteredBuildings.slice(0, 24).map((building) => (
                        <button
                          type="button"
                          key={building.key}
                          className={building.key === selectedBuildingKey ? 'selected' : ''}
                          onClick={() => toggleBuilding(building.key)}
                        >
                          <span>{building.code}</span>
                          <strong>{building.name}</strong>
                          <small>{building.source === 'batch_draft' ? 'this batch' : `${building.entranceCount ?? 0} entrances`}</small>
                        </button>
                      )) : (
                        <p className="campus-picker-empty">
                          No canonical buildings mapped here yet. Use <strong>Buildings</strong> to draw one, then add its entrances.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
              </section>

              <section className="campus-section">
                <div className="campus-eyebrow">3 · ENTRANCE DEFAULTS</div>
                <div className="campus-field-grid">
                  <SelectField label="Public access" value={defaults.publicAccess} onChange={(publicAccess) => setDefaults((current) => ({ ...current, publicAccess }))}>
                    <option value="unknown">Unknown</option><option value="verified">Verified</option><option value="restricted">Restricted</option>
                  </SelectField>
                  <SelectField label="Direction" value={defaults.direction} onChange={(direction) => setDefaults((current) => ({ ...current, direction }))}>
                    <option value="unknown">Unknown</option><option value="bidirectional">Bidirectional</option><option value="entry_only">Entry only</option><option value="exit_only">Exit only</option>
                  </SelectField>
                  <SelectField label="Barrier-free" value={defaults.barrierFree} onChange={(barrierFree) => setDefaults((current) => ({ ...current, barrierFree }))}>
                    <option value="unknown">Unknown</option><option value="verified">Verified</option><option value="not_barrier_free">Not barrier-free</option>
                  </SelectField>
                </div>
              </section>
            </>
          ) : null}

          {tool === 'building' ? (
            <section className="campus-section">
              <div className="campus-eyebrow">2 · BUILDING DETAILS</div>
              <p className="campus-hint">Fill these in, click around the footprint, then press Enter or Finish.</p>
              <div className="campus-field-grid">
                <label className="campus-field"><span>Building code</span><input value={buildingForm.code} onChange={(event) => setBuildingForm((current) => ({ ...current, code: event.target.value }))} placeholder="e.g. BA" /></label>
                <label className="campus-field"><span>Name</span><input value={buildingForm.name} onChange={(event) => setBuildingForm((current) => ({ ...current, name: event.target.value }))} placeholder="Building name" /></label>
                <SelectField label="Category" value={buildingForm.category} onChange={(category) => setBuildingForm((current) => ({ ...current, category }))}>
                  <option value="academic">Academic</option><option value="residence">Residence</option><option value="library">Library</option><option value="athletics">Athletics</option><option value="facility">Facility</option><option value="other">Other</option>
                </SelectField>
              </div>
              <div className="campus-draw-actions">
                <button type="button" disabled={!drawingPoints.length} onClick={() => setDrawingPoints((current) => current.slice(0, -1))}><Undo2 size={14} /> Undo point</button>
                <button type="button" disabled={drawingPoints.length < 3} className="finish" onClick={finishDrawing}><Check size={14} /> Finish building</button>
              </div>
              <small className="campus-draw-count">{drawingPoints.length} vertices</small>
            </section>
          ) : null}

          {tool === 'path' ? (
            <section className="campus-section">
              <div className="campus-eyebrow">2 · PATH DETAILS</div>
              <p className="campus-hint">Click points along the path in order, then press Enter or Finish.</p>
              <div className="campus-field-grid">
                <SelectField label="Path type" value={pathForm.pathKind} onChange={(pathKind) => setPathForm((current) => ({ ...current, pathKind }))}>
                  <option value="pedestrian_path">Pedestrian path</option><option value="stairs">Stairs</option><option value="ramp">Ramp</option><option value="covered_walkway">Covered walkway</option><option value="indoor_connection">Indoor connection</option>
                </SelectField>
                <label className="campus-field"><span>Label (optional)</span><input value={pathForm.label} onChange={(event) => setPathForm((current) => ({ ...current, label: event.target.value }))} placeholder="e.g. Library ramp" /></label>
                <SelectField label="Barrier-free" value={pathForm.barrierFree} onChange={(barrierFree) => setPathForm((current) => ({ ...current, barrierFree }))}>
                  <option value="unknown">Unknown</option><option value="verified">Verified</option><option value="not_barrier_free">Not barrier-free</option>
                </SelectField>
              </div>
              <div className="campus-draw-actions">
                <button type="button" disabled={!drawingPoints.length} onClick={() => setDrawingPoints((current) => current.slice(0, -1))}><Undo2 size={14} /> Undo point</button>
                <button type="button" disabled={drawingPoints.length < 2} className="finish" onClick={finishDrawing}><Check size={14} /> Finish path</button>
              </div>
              <small className="campus-draw-count">{drawingPoints.length} points</small>
            </section>
          ) : null}

          <section className="campus-section campus-evidence-section">
            <div className="campus-eyebrow">EVIDENCE</div>
            <div className="campus-field-grid compact">
              <SelectField label="Method" value={defaults.observationMethod} onChange={(observationMethod) => setDefaults((current) => ({ ...current, observationMethod }))}>
                <option value="field_observation">Field observation</option><option value="official_source">Official source</option><option value="other">Other</option>
              </SelectField>
              <label className="campus-field"><span>Date</span><input type="date" value={defaults.observedAt} onChange={(event) => setDefaults((current) => ({ ...current, observedAt: event.target.value }))} /></label>
            </div>
          </section>

          <section className="campus-section campus-batch-section">
            <div className="campus-batch-heading">
              <div><div className="campus-eyebrow">BATCH</div><strong>{items.length} change{items.length === 1 ? '' : 's'} queued</strong></div>
              {items.length ? <button type="button" className="campus-icon-button" onClick={() => removeItem(items[items.length - 1].id)} title="Undo last change"><Undo2 size={15} /></button> : null}
            </div>
            <div className="campus-batch-list">
              {items.length ? items.map((item, index) => (
                <div className={`campus-batch-item ${item.id === selectedEntranceId ? 'selected' : ''}`} key={item.id}>
                  <button type="button" className="campus-batch-main" onClick={() => {
                    setCampus(item.campus);
                    if (item.type === 'entrance') {
                      setTool('entrance');
                      setSelectedEntranceId((current) => current === item.id ? null : item.id);
                      setSelectedBuildingKey(item.buildingSource === 'batch_draft' ? `draft:${item.buildingDraftId}` : `canonical:${item.buildingCode}`);
                    } else if (item.type === 'building') {
                      setTool('entrance');
                      setSelectedBuildingKey(`draft:${item.id}`);
                    } else {
                      setTool('path');
                    }
                  }}>
                    <span className="campus-batch-number">{index + 1}</span>
                    <span><strong>{itemName(item)}</strong><small>{CAMPUSES[item.campus].shortName} · {humanize(item.type)}</small></span>
                  </button>
                  <button type="button" className="campus-delete-item" onClick={() => removeItem(item.id)} title={`Remove ${itemName(item)}`}><Trash2 size={14} /></button>
                </div>
              )) : <p className="campus-empty-batch">Nothing queued yet. Select a tool and draw directly on the map.</p>}
            </div>
          </section>

          <div className="campus-sidebar-actions">
            <button type="button" className="campus-submit" disabled={!items.length} onClick={openIssue}>Open GitHub review · {items.length || 0}</button>
            <a href="/contribute/single">Guided single-entrance mode</a>
          </div>
        </aside>

        <section className="campus-workspace">
          <div className="campus-map-toolbar">
            <div>
              <span>{CAMPUSES[campusId].shortName} · {humanize(tool)}</span>
              <h1>
                {tool === 'entrance'
                  ? selectedBuilding ? `Add entrances to ${selectedBuilding.code}.` : 'Select a building on the map.'
                  : tool === 'building' ? 'Trace the building footprint.' : 'Trace the path.'}
              </h1>
              <p>
                {tool === 'entrance'
                  ? selectedBuilding
                    ? 'Click anywhere on the map to add entrances. Use the selected-building chip on the map, Esc, or Deselect to clear the building. Click a red entrance again to deselect it.'
                    : 'Click a building footprint to select it. You can also draw a new building first.'
                  : `Click to add ${tool === 'building' ? 'vertices' : 'points'}. Enter finishes; Esc cancels the current drawing.`}
              </p>
            </div>
            <div className="campus-map-actions">
              {(selectedBuilding || selectedEntranceId || drawingPoints.length) ? (
                <button type="button" onClick={() => { clearSelection(); setDrawingPoints([]); }}><RotateCcw size={14} /> Clear selection</button>
              ) : null}
              <span>{campusItems.length} queued here</span>
            </div>
          </div>

          <div className="campus-map-wrap">
            {selectedBuilding && tool === 'entrance' ? (
              <button
                type="button"
                className="campus-map-selected-chip"
                onClick={() => clearSelection()}
                title="Deselect building"
              >
                <span>{selectedBuilding.code}</span>
                <strong>{selectedBuilding.name}</strong>
                <X size={14} />
              </button>
            ) : null}

            <svg
              ref={svgRef}
              className={`campus-map tool-${tool}`}
              viewBox={viewBoxValue}
              onClick={handleMapClick}
              role="application"
              aria-label={`${CAMPUSES[campusId].name} contribution map`}
            >
              <rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} className="campus-map-bg" />
              <g className="campus-osm-tiles" pointerEvents="none">
                {tiles.map((tile) => (
                  <image key={tile.key} href={tile.href} x={tile.x} y={tile.y} width={tile.width} height={tile.height} preserveAspectRatio="none" />
                ))}
              </g>

              <g className="campus-canonical-footprints">
                {canonicalFootprints.map((feature, index) => {
                  const code = feature.properties.buildingCode?.toUpperCase();
                  const key = canonicalBuildingKey(code);
                  const selected = selectedBuildingKey === key;
                  return (
                    <path
                      key={`${code}-${index}`}
                      d={geometryPath(feature.geometry, project)}
                      className={selected ? 'selected' : ''}
                      onClick={tool === 'entrance' && !selected ? (event) => {
                        event.stopPropagation();
                        selectBuilding(key);
                      } : undefined}
                    />
                  );
                })}
              </g>

              <g className="campus-draft-buildings">
                {draftBuildings.map((item) => {
                  const key = draftBuildingKey(item);
                  const selected = selectedBuildingKey === key;
                  return (
                    <path
                      key={item.id}
                      d={geometryPath(item.geometry, project)}
                      className={selected ? 'selected' : ''}
                      onClick={tool === 'entrance' && !selected ? (event) => {
                        event.stopPropagation();
                        selectBuilding(key);
                      } : undefined}
                    />
                  );
                })}
              </g>

              <g className="campus-draft-paths" pointerEvents="none">
                {draftPaths.map((item) => <path key={item.id} d={geometryPath(item.geometry, project)} />)}
              </g>

              {selectedCanonicalEntrances.map((feature) => {
                const [x, y] = project(feature.geometry.coordinates);
                return <circle key={feature.id || `${x}-${y}`} cx={x} cy={y} r="6" className="campus-existing-entrance" />;
              })}

              <g className="campus-draft-entrances">
                {draftEntrances.map((item) => {
                  const [x, y] = project(item.coordinates);
                  const selected = item.id === selectedEntranceId;
                  return (
                    <g
                      key={item.id}
                      className={selected ? 'selected' : ''}
                      onClick={(event) => {
                        event.stopPropagation();
                        setTool('entrance');
                        setSelectedEntranceId((current) => current === item.id ? null : item.id);
                        setSelectedBuildingKey(
                          item.buildingSource === 'batch_draft'
                            ? `draft:${item.buildingDraftId}`
                            : `canonical:${item.buildingCode}`,
                        );
                      }}
                    >
                      <circle cx={x} cy={y} r={selected ? 13 : 10} />
                      <text x={x} y={y + 4}>{items.indexOf(item) + 1}</text>
                    </g>
                  );
                })}
              </g>

              {drawingPoints.length ? (
                <g className={`campus-active-drawing ${tool}`} pointerEvents="none">
                  {tool === 'building' && drawingPoints.length > 1 ? (
                    <path d={`${drawingPoints.map((point, index) => {
                      const [x, y] = project(point);
                      return `${index ? 'L' : 'M'}${x} ${y}`;
                    }).join(' ')} Z`} />
                  ) : null}
                  {tool === 'path' && drawingPoints.length > 1 ? (
                    <path d={drawingPoints.map((point, index) => {
                      const [x, y] = project(point);
                      return `${index ? 'L' : 'M'}${x} ${y}`;
                    }).join(' ')} />
                  ) : null}
                  {drawingPoints.map((point, index) => {
                    const [x, y] = project(point);
                    return <circle key={`${x}-${y}-${index}`} cx={x} cy={y} r="7" />;
                  })}
                </g>
              ) : null}
            </svg>

            <div className="campus-map-legend">
              <span><i className="mapped" /> Existing building</span>
              <span><i className="draft-building" /> Batch building</span>
              <span><i className="entrance" /> Batch entrance</span>
              <span><i className="path" /> Batch path</span>
            </div>
            <a className="campus-osm-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
          </div>

          {selectedEntrance ? (
            <div className="campus-inspector">
              <div className="campus-inspector-heading">
                <div>
                  <span>SELECTED ENTRANCE</span>
                  <strong>{selectedEntrance.buildingCode} · {selectedEntrance.label || 'Unlabelled entrance'}</strong>
                </div>
                <button type="button" className="campus-deselect-entrance" onClick={() => setSelectedEntranceId(null)}>
                  Deselect entrance <X size={13} />
                </button>
              </div>
              <div className="campus-inspector-fields">
                <label className="campus-field"><span>Label</span><input value={selectedEntrance.label} onChange={(event) => updateSelectedEntrance({ label: event.target.value })} placeholder="Optional label" /></label>
                <SelectField label="Public access" value={selectedEntrance.publicAccess} onChange={(publicAccess) => updateSelectedEntrance({ publicAccess })}>
                  <option value="unknown">Unknown</option><option value="verified">Verified</option><option value="restricted">Restricted</option>
                </SelectField>
                <SelectField label="Direction" value={selectedEntrance.direction} onChange={(direction) => updateSelectedEntrance({ direction })}>
                  <option value="unknown">Unknown</option><option value="bidirectional">Bidirectional</option><option value="entry_only">Entry only</option><option value="exit_only">Exit only</option>
                </SelectField>
                <SelectField label="Barrier-free" value={selectedEntrance.barrierFree} onChange={(barrierFree) => updateSelectedEntrance({ barrierFree })}>
                  <option value="unknown">Unknown</option><option value="verified">Verified</option><option value="not_barrier_free">Not barrier-free</option>
                </SelectField>
              </div>
              <div className="campus-inspector-actions">
                <span>{selectedEntrance.coordinates[1].toFixed(7)}, {selectedEntrance.coordinates[0].toFixed(7)}</span>
                <button type="button" className="delete" onClick={() => removeItem(selectedEntrance.id)}><Trash2 size={14} /> Delete entrance</button>
              </div>
            </div>
          ) : null}

          <footer className="campus-statusbar">
            <span>{CAMPUSES[campusId].name}</span>
            <span>{selectableBuildings.length} selectable building{selectableBuildings.length === 1 ? '' : 's'}</span>
            <span>
              {warningCount
                ? <><CircleAlert size={13} /> {warningCount} possible duplicate{warningCount === 1 ? '' : 's'}</>
                : <><Check size={13} /> no duplicate warnings</>}
            </span>
          </footer>
        </section>
      </main>

      {notice ? (
        <div className="campus-notice" role="status">
          <span>{notice}</span><button type="button" onClick={() => setNotice('')}>×</button>
        </div>
      ) : null}
    </div>
  );
}
