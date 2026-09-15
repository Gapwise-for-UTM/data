import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accessibility,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Clipboard,
  DoorOpen,
  ExternalLink,
  FileJson,
  Info,
  Link2,
  LocateFixed,
  MapPin,
  Minus,
  MousePointer2,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import entranceDataRaw from '../data/utm/entrances.geojson?raw';
import './entrance-contribution.css';
import './entrance-contribution-polish.css';

const footprintModules = import.meta.glob('../data/utm/footprints/*.geojson', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const DATA_REPOSITORY = 'https://github.com/Gapwise-for-UTM/data';
const SVG_WIDTH = 1000;
const SVG_HEIGHT = 760;
const CAMPUS_PADDING = 34;

const footprintFeatures = Object.values(footprintModules)
  .flatMap((raw) => {
    const parsed = JSON.parse(raw);
    return parsed.type === 'FeatureCollection' ? parsed.features : [parsed];
  })
  .filter((feature) => feature?.geometry && feature?.properties?.buildingCode);

const entranceFeatures = (JSON.parse(entranceDataRaw).features ?? []).filter(
  (feature) => feature?.geometry?.type === 'Point' && feature?.properties?.buildingCode,
);

function geometryCoordinates(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates.flat();
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2);
  return [];
}

const allFootprintCoordinates = footprintFeatures.flatMap((feature) =>
  geometryCoordinates(feature.geometry),
);

const campusBounds = allFootprintCoordinates.reduce(
  (bounds, [longitude, latitude]) => ({
    minLon: Math.min(bounds.minLon, longitude),
    maxLon: Math.max(bounds.maxLon, longitude),
    minLat: Math.min(bounds.minLat, latitude),
    maxLat: Math.max(bounds.maxLat, latitude),
  }),
  { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity },
);

const middleLatitude = (campusBounds.minLat + campusBounds.maxLat) / 2;
const longitudeScale = Math.cos((middleLatitude * Math.PI) / 180);
const projectedCampusWidth = (campusBounds.maxLon - campusBounds.minLon) * longitudeScale;
const projectedCampusHeight = campusBounds.maxLat - campusBounds.minLat;
const campusAspect = projectedCampusWidth / projectedCampusHeight;
const canvasAspect = SVG_WIDTH / SVG_HEIGHT;
const contentWidth =
  campusAspect > canvasAspect
    ? SVG_WIDTH - CAMPUS_PADDING * 2
    : (SVG_HEIGHT - CAMPUS_PADDING * 2) * campusAspect;
const contentHeight =
  campusAspect > canvasAspect
    ? contentWidth / campusAspect
    : SVG_HEIGHT - CAMPUS_PADDING * 2;
const originX = (SVG_WIDTH - contentWidth) / 2;
const originY = (SVG_HEIGHT - contentHeight) / 2;

function project([longitude, latitude]) {
  const xRatio = ((longitude - campusBounds.minLon) * longitudeScale) / projectedCampusWidth;
  const yRatio = (campusBounds.maxLat - latitude) / projectedCampusHeight;
  return [originX + xRatio * contentWidth, originY + yRatio * contentHeight];
}

function unproject([x, y]) {
  const xRatio = (x - originX) / contentWidth;
  const yRatio = (y - originY) / contentHeight;
  return [
    campusBounds.minLon + (xRatio * projectedCampusWidth) / longitudeScale,
    campusBounds.maxLat - yRatio * projectedCampusHeight,
  ];
}

function pathForRing(ring) {
  return (
    ring
      .map((coordinate, index) => {
        const [x, y] = project(coordinate);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ') + ' Z'
  );
}

function pathForGeometry(geometry) {
  if (geometry.type === 'Polygon') return geometry.coordinates.map(pathForRing).join(' ');
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon) => polygon.map(pathForRing)).join(' ');
  }
  return '';
}

const groupedFootprints = footprintFeatures.reduce((grouped, feature) => {
  const code = feature.properties.buildingCode.toUpperCase();
  const records = grouped.get(code) ?? [];
  records.push(feature);
  grouped.set(code, records);
  return grouped;
}, new Map());

const buildings = [...groupedFootprints.entries()]
  .map(([code, features]) => ({
    code,
    name: features[0]?.properties?.name ?? code,
    category: features[0]?.properties?.category ?? 'facility',
    features,
    entranceCount: entranceFeatures.filter(
      (entrance) => entrance.properties.buildingCode.toUpperCase() === code,
    ).length,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

function boundsForFeatures(features) {
  const coordinates = features.flatMap((feature) => geometryCoordinates(feature.geometry));
  const xs = coordinates.map((coordinate) => project(coordinate)[0]);
  const ys = coordinates.map((coordinate) => project(coordinate)[1]);
  if (!xs.length || !ys.length) return { x: 0, y: 0, width: SVG_WIDTH, height: SVG_HEIGHT };
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(85, maxX - minX);
  const height = Math.max(85, maxY - minY);
  const pad = Math.max(width, height) * 0.72;
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    width: Math.min(SVG_WIDTH, width + pad * 2),
    height: Math.min(SVG_HEIGHT, height + pad * 2),
  };
}

function metersBetween([lonA, latA], [lonB, latB]) {
  const radius = 6371000;
  const toRadians = (value) => (value * Math.PI) / 180;
  const phi1 = toRadians(latA);
  const phi2 = toRadians(latB);
  const deltaPhi = toRadians(latB - latA);
  const deltaLambda = toRadians(lonB - lonA);
  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function todayLocalDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function createDraft() {
  return {
    contributionType: 'new_entrance',
    existingEntranceId: '',
    coordinates: null,
    label: '',
    kind: 'exterior_entrance',
    observationMethod: 'field_observation',
    observedAt: todayLocalDate(),
    publicAccess: 'unknown',
    direction: 'unknown',
    barrierFree: 'unknown',
    sourceUrl: '',
    notes: '',
    duplicateDecision: '',
  };
}

function OptionGroup({ label, help, value, onChange, options }) {
  return (
    <fieldset className="contrib-fieldset">
      <legend>{label}</legend>
      {help ? <p className="contrib-field-help">{help}</p> : null}
      <div className="contrib-option-grid">
        {options.map((option) => (
          <button
            type="button"
            className={`contrib-option ${value === option.value ? 'selected' : ''}`}
            onClick={() => onChange(option.value)}
            key={option.value}
          >
            <span className="contrib-option-icon">{option.icon}</span>
            <span>
              <strong>{option.label}</strong>
              {option.caption ? <small>{option.caption}</small> : null}
            </span>
            {value === option.value ? <Check size={15} className="contrib-option-check" /> : null}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function StepRail({ step }) {
  return (
    <div className="contrib-step-rail" aria-label="Contribution progress">
      {['Place', 'Describe', 'Review'].map((label, index) => (
        <div
          className={`contrib-step ${step === index ? 'active' : ''} ${step > index ? 'done' : ''}`}
          key={label}
        >
          <span>{step > index ? <Check size={12} /> : index + 1}</span>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
}

function MapLegend() {
  return (
    <div className="contrib-map-legend">
      <span><i className="existing" />Mapped entrance</span>
      <span><i className="draft" />Your contribution</span>
      <span><i className="selected-building" />Selected building</span>
    </div>
  );
}

function CampusEditorMap({
  selectedBuilding,
  draft,
  onPlace,
  onChooseExisting,
  onSelectBuilding,
  focusedEntranceId,
  compact = false,
}) {
  const svgRef = useRef(null);
  const dragRef = useRef(false);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: SVG_WIDTH, height: SVG_HEIGHT });

  useEffect(() => {
    setViewBox(
      selectedBuilding
        ? boundsForFeatures(selectedBuilding.features)
        : { x: 0, y: 0, width: SVG_WIDTH, height: SVG_HEIGHT },
    );
  }, [selectedBuilding?.code]);

  function zoom(factor) {
    setViewBox((current) => {
      const nextWidth = Math.min(SVG_WIDTH, Math.max(90, current.width * factor));
      const nextHeight = Math.min(SVG_HEIGHT, Math.max(70, current.height * factor));
      const centerX = current.x + current.width / 2;
      const centerY = current.y + current.height / 2;
      return {
        x: Math.max(0, Math.min(SVG_WIDTH - nextWidth, centerX - nextWidth / 2)),
        y: Math.max(0, Math.min(SVG_HEIGHT - nextHeight, centerY - nextHeight / 2)),
        width: nextWidth,
        height: nextHeight,
      };
    });
  }

  function resetView() {
    setViewBox(
      selectedBuilding
        ? boundsForFeatures(selectedBuilding.features)
        : { x: 0, y: 0, width: SVG_WIDTH, height: SVG_HEIGHT },
    );
  }

  function eventCoordinates(event) {
    const svg = svgRef.current;
    if (!svg) return null;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const coordinates = unproject([point.x, point.y]);
    if (
      coordinates[0] < campusBounds.minLon ||
      coordinates[0] > campusBounds.maxLon ||
      coordinates[1] < campusBounds.minLat ||
      coordinates[1] > campusBounds.maxLat
    ) return null;
    return coordinates;
  }

  function handleMapClick(event) {
    if (!selectedBuilding || compact || dragRef.current) return;
    const coordinates = eventCoordinates(event);
    if (coordinates) onPlace?.(coordinates);
  }

  const selectedCode = selectedBuilding?.code;
  const visibleEntrances = entranceFeatures.filter((entrance) => {
    if (!selectedCode) return true;
    return entrance.properties.buildingCode.toUpperCase() === selectedCode;
  });

  return (
    <div className={`contrib-map-shell ${compact ? 'compact' : ''}`}>
      <svg
        ref={svgRef}
        className="contrib-map-svg"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        role="img"
        aria-label="Interactive UTM campus entrance map"
        onClick={handleMapClick}
        onPointerMove={(event) => {
          if (!dragRef.current || compact) return;
          const coordinates = eventCoordinates(event);
          if (coordinates) onPlace?.(coordinates);
        }}
        onPointerUp={() => {
          window.setTimeout(() => {
            dragRef.current = false;
          }, 0);
        }}
        onPointerCancel={() => {
          dragRef.current = false;
        }}
      >
        <rect x="0" y="0" width={SVG_WIDTH} height={SVG_HEIGHT} className="contrib-map-background" />
        <g className="contrib-building-layer">
          {footprintFeatures.map((feature, index) => {
            const code = feature.properties.buildingCode.toUpperCase();
            const selected = selectedCode === code;
            return (
              <path
                key={`${feature.id ?? code}-${index}`}
                d={pathForGeometry(feature.geometry)}
                className={`contrib-building-shape ${selected ? 'selected' : ''} ${!selectedCode ? 'pickable' : ''}`}
                fillRule="evenodd"
                onClick={(event) => {
                  event.stopPropagation();
                  if (compact) return;
                  if (!selectedCode) {
                    onSelectBuilding?.(code);
                    return;
                  }
                  if (selected) {
                    const coordinates = eventCoordinates(event);
                    if (coordinates) onPlace?.(coordinates);
                  }
                }}
              />
            );
          })}
        </g>
        <g className="contrib-label-layer">
          {buildings.map((building) => {
            if (selectedCode && selectedCode !== building.code) return null;
            const coordinates = building.features.flatMap((feature) =>
              geometryCoordinates(feature.geometry),
            );
            const projected = coordinates.map(project);
            if (!projected.length) return null;
            const x = projected.reduce((sum, point) => sum + point[0], 0) / projected.length;
            const y = projected.reduce((sum, point) => sum + point[1], 0) / projected.length;
            return (
              <text key={building.code} x={x} y={y} className="contrib-building-label">
                {building.code}
              </text>
            );
          })}
        </g>
        <g className="contrib-entrance-layer">
          {visibleEntrances.map((entrance) => {
            const [x, y] = project(entrance.geometry.coordinates);
            const selected =
              focusedEntranceId === String(entrance.id) || draft.existingEntranceId === String(entrance.id);
            return (
              <g
                key={entrance.id}
                className={`contrib-existing-marker ${selected ? 'selected' : ''}`}
                transform={`translate(${x} ${y})`}
                onClick={(event) => {
                  event.stopPropagation();
                  onChooseExisting?.(entrance);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onChooseExisting?.(entrance);
                  }
                }}
                role="button"
                aria-label={`Use ${entrance.properties.label || entrance.id}`}
                tabIndex={compact ? -1 : 0}
              >
                <circle r={selected ? 9 : 7} />
                <circle r={selected ? 3.4 : 2.8} className="inner" />
              </g>
            );
          })}
        </g>
        {draft.coordinates
          ? (() => {
              const [x, y] = project(draft.coordinates);
              return (
                <g
                  className="contrib-draft-marker"
                  transform={`translate(${x} ${y})`}
                  onPointerDown={(event) => {
                    if (compact) return;
                    event.preventDefault();
                    event.stopPropagation();
                    dragRef.current = true;
                    svgRef.current?.setPointerCapture?.(event.pointerId);
                  }}
                >
                  <circle r="14" className="halo" />
                  <circle r="8" className="pin" />
                  <circle r="2.8" className="center" />
                </g>
              );
            })()
          : null}
      </svg>
      {!compact ? (
        <>
          <div className="contrib-map-controls">
            <button type="button" onClick={() => zoom(0.72)} aria-label="Zoom in"><Plus size={16} /></button>
            <button type="button" onClick={() => zoom(1.38)} aria-label="Zoom out"><Minus size={16} /></button>
            <button type="button" onClick={resetView} aria-label="Reset map"><RotateCcw size={15} /></button>
          </div>
          <div className="contrib-map-instruction">
            <MousePointer2 size={14} />
            {selectedBuilding
              ? draft.coordinates
                ? 'Drag the red pin or click to fine-tune the doorway'
                : 'Click the exact doorway location'
              : 'Click a building or choose one from the list'}
          </div>
          <MapLegend />
        </>
      ) : null}
    </div>
  );
}

function buildContributionPayload(building, draft) {
  return {
    schemaVersion: 1,
    contributionType: draft.contributionType,
    buildingCode: building.code,
    buildingName: building.name,
    ...(draft.existingEntranceId ? { existingEntranceId: draft.existingEntranceId } : {}),
    geometry: draft.coordinates
      ? { type: 'Point', coordinates: draft.coordinates.map((value) => Number(value.toFixed(7))) }
      : null,
    proposedLabel: draft.label.trim() || null,
    entranceKind: draft.kind,
    observedAt: draft.observedAt,
    observationMethod: draft.observationMethod,
    claims: {
      publicAccess: draft.publicAccess,
      direction: draft.direction,
      barrierFree: draft.barrierFree,
    },
    evidence: {
      ...(draft.sourceUrl.trim() ? { sourceUrl: draft.sourceUrl.trim() } : {}),
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
    },
  };
}

function buildIssue(building, draft) {
  const payload = buildContributionPayload(building, draft);
  const action = draft.contributionType === 'existing_entrance_update' ? 'Entrance update' : 'New entrance';
  const title = `${action}: ${building.code}${draft.label.trim() ? ` — ${draft.label.trim()}` : ''}`;
  const body = [
    '## Entrance contribution',
    '',
    `**Building:** ${building.name} (${building.code})`,
    `**Contribution:** ${draft.contributionType === 'existing_entrance_update' ? 'Update an existing mapped entrance' : 'Add a new exterior entrance'}`,
    draft.existingEntranceId ? `**Existing entrance:** \`${draft.existingEntranceId}\`` : null,
    draft.coordinates ? `**Coordinates:** ${draft.coordinates[1].toFixed(7)}, ${draft.coordinates[0].toFixed(7)}` : null,
    `**Observed:** ${draft.observedAt || 'Not supplied'} · ${draft.observationMethod === 'field_observation' ? 'field observation' : 'source-backed'}`,
    '',
    '### Claims',
    '',
    `- Public/student access: **${draft.publicAccess}**`,
    `- Direction: **${draft.direction}**`,
    `- Barrier-free: **${draft.barrierFree}**`,
    draft.sourceUrl.trim() ? `- Source: ${draft.sourceUrl.trim()}` : null,
    draft.notes.trim() ? `- Notes: ${draft.notes.trim()}` : null,
    '',
    '### Machine-readable contribution',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    '> Submitted with the visual Entrance Studio at data.gapwise.ca. Claims marked unknown should remain unknown unless independently verified during review.',
  ]
    .filter((line) => line !== null)
    .join('\n');
  return { title, body, payload };
}

function ReviewCard({ building, draft }) {
  return (
    <div className="contrib-review-card">
      <div className="contrib-review-map">
        <CampusEditorMap selectedBuilding={building} draft={draft} compact />
      </div>
      <div className="contrib-review-body">
        <div className="contrib-review-eyebrow">
          {draft.contributionType === 'existing_entrance_update' ? 'Entrance update' : 'New entrance'}
        </div>
        <h3>{building.name}</h3>
        <p className="contrib-review-code">
          {building.code}{draft.label.trim() ? ` · ${draft.label.trim()}` : ''}
        </p>
        <dl>
          {[
            ['Public access', draft.publicAccess],
            ['Direction', draft.direction],
            ['Barrier-free', draft.barrierFree],
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={value === 'unknown' ? 'unknown' : ''}>{value.replaceAll('_', ' ')}</dd>
            </div>
          ))}
          <div><dt>Evidence</dt><dd>{draft.observationMethod === 'field_observation' ? 'Field observation' : 'External source'}</dd></div>
          <div><dt>Date</dt><dd>{draft.observedAt || 'Not supplied'}</dd></div>
        </dl>
      </div>
    </div>
  );
}

function ContributionHeader({ maintainerMode }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="contrib-topbar">
      <a className="contrib-brand" href="/"><img src="/logo-mark.svg" alt="" /><span>Gapwise <b>Data</b></span></a>
      <div className="contrib-context"><span>{maintainerMode ? 'Entrance Studio' : 'Contribute'}</span><i /></div>
      <button className="contrib-menu" type="button" onClick={() => setOpen((value) => !value)} aria-label="Toggle navigation">
        {open ? <X size={19} /> : <span>Menu</span>}
      </button>
      <nav className={open ? 'open' : ''}>
        <a href="/">Data home</a>
        <a href="/contribute">Contribute</a>
        <a href="/studio/entrances">Studio</a>
        <a href={`${DATA_REPOSITORY}/tree/main/data/utm`} target="_blank" rel="noreferrer">GitHub <ExternalLink size={12} /></a>
      </nav>
    </header>
  );
}

function BuildingPicker({ query, setQuery, selectedCode, onSelect }) {
  const filtered = buildings.filter((building) =>
    `${building.code} ${building.name} ${building.category}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="contrib-building-picker">
      <label className="contrib-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search MN, Deerfield, Kaneff…" /></label>
      <div className="contrib-building-list">
        {filtered.map((building) => (
          <button type="button" className={selectedCode === building.code ? 'selected' : ''} onClick={() => onSelect(building.code)} key={building.code}>
            <span className="contrib-building-monogram">{building.code}</span>
            <span><strong>{building.name}</strong><small>{building.category} · {building.entranceCount} mapped entrance{building.entranceCount === 1 ? '' : 's'}</small></span>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>
    </div>
  );
}

function DuplicateNotice({ nearest, onSame, onDifferent }) {
  if (!nearest || nearest.distance > 5) return null;
  return (
    <div className="contrib-duplicate-notice">
      <Info size={18} />
      <div>
        <strong>Possible existing entrance {nearest.distance.toFixed(1)} m away</strong>
        <p>{nearest.entrance.properties.label || 'Mapped entrance'} · {nearest.entrance.id}</p>
        <div><button type="button" onClick={onSame}>Same entrance</button><button type="button" onClick={onDifferent}>Different entrance</button></div>
      </div>
    </div>
  );
}

export default function EntranceContribution({ maintainerMode = false }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialBuilding = (params.get('building') ?? '').toUpperCase();
  const [selectedCode, setSelectedCode] = useState(
    buildings.some((building) => building.code === initialBuilding) ? initialBuilding : '',
  );
  const [buildingQuery, setBuildingQuery] = useState('');
  const [draft, setDraft] = useState(createDraft);
  const [step, setStep] = useState(0);
  const [copied, setCopied] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [focusedEntranceId, setFocusedEntranceId] = useState('');
  const [locationState, setLocationState] = useState({ status: 'idle', accuracy: null, message: '' });

  const selectedBuilding = buildings.find((building) => building.code === selectedCode) ?? null;
  const buildingEntrances = entranceFeatures.filter(
    (entrance) => entrance.properties.buildingCode.toUpperCase() === selectedCode,
  );
  const nearest = useMemo(() => {
    if (!draft.coordinates || draft.contributionType === 'existing_entrance_update') return null;
    return (
      buildingEntrances
        .map((entrance) => ({
          entrance,
          distance: metersBetween(draft.coordinates, entrance.geometry.coordinates),
        }))
        .sort((a, b) => a.distance - b.distance)[0] ?? null
    );
  }, [draft.coordinates, draft.contributionType, selectedCode]);

  useEffect(() => {
    document.title = maintainerMode ? 'Entrance Studio · Gapwise Data' : 'Contribute an entrance · Gapwise Data';
  }, [maintainerMode]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedCode) url.searchParams.set('building', selectedCode);
    else url.searchParams.delete('building');
    window.history.replaceState({}, '', url);
  }, [selectedCode]);

  useEffect(() => {
    setDraft(createDraft());
    setStep(0);
    setFocusedEntranceId('');
    setSubmitted(false);
    setLocationState({ status: 'idle', accuracy: null, message: '' });
  }, [selectedCode]);

  function updateDraft(patch) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function selectExisting(entrance) {
    setFocusedEntranceId(String(entrance.id));
    setDraft((current) => ({
      ...current,
      contributionType: 'existing_entrance_update',
      existingEntranceId: String(entrance.id),
      coordinates: entrance.geometry.coordinates,
      label: current.label || entrance.properties.label || '',
      publicAccess:
        entrance.properties.access === 'public'
          ? 'verified'
          : entrance.properties.access === 'restricted' || entrance.properties.access === 'emergency_only'
            ? 'restricted'
            : 'unknown',
      direction: entrance.properties.direction ?? 'unknown',
      barrierFree:
        entrance.properties.accessibility === 'accessible'
          ? 'verified'
          : entrance.properties.accessibility === 'not_accessible'
            ? 'not_barrier_free'
            : 'unknown',
      duplicateDecision: 'same',
    }));
  }

  function selectNewLocation(coordinates) {
    setFocusedEntranceId('');
    setDraft((current) => ({
      ...current,
      contributionType: 'new_entrance',
      existingEntranceId: '',
      coordinates,
      duplicateDecision: '',
    }));
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationState({ status: 'error', accuracy: null, message: 'Location is not available in this browser.' });
      return;
    }
    setLocationState({ status: 'loading', accuracy: null, message: 'Finding your location…' });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coordinates = [position.coords.longitude, position.coords.latitude];
        selectNewLocation(coordinates);
        setLocationState({
          status: 'success',
          accuracy: Math.round(position.coords.accuracy),
          message: `Placed from your device location (±${Math.round(position.coords.accuracy)} m). Drag the pin to the exact doorway.`,
        });
      },
      (error) => {
        setLocationState({
          status: 'error',
          accuracy: null,
          message: error.code === 1 ? 'Location permission was not granted.' : 'Could not get a reliable location. You can still click the map.',
        });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 },
    );
  }

  function canContinue() {
    if (step === 0) return Boolean(selectedBuilding && draft.coordinates);
    if (step === 1) {
      return Boolean(
        draft.observedAt &&
          (draft.observationMethod !== 'source' || /^https?:\/\//i.test(draft.sourceUrl.trim())),
      );
    }
    return true;
  }

  async function copyText(text, key) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(''), 1400);
    } catch {
      setCopied('');
    }
  }

  function copyShareLink() {
    if (!selectedBuilding) return;
    const url = new URL('/contribute', window.location.origin);
    url.searchParams.set('building', selectedBuilding.code);
    copyText(url.toString(), 'link');
  }

  function submitToGitHub() {
    if (!selectedBuilding) return;
    const { title, body } = buildIssue(selectedBuilding, draft);
    const issueUrl = new URL(`${DATA_REPOSITORY}/issues/new`);
    issueUrl.searchParams.set('title', title);
    issueUrl.searchParams.set('body', body);
    setSubmitted(true);
    window.open(issueUrl.toString(), '_blank', 'noopener,noreferrer');
  }

  const issuePayload = selectedBuilding ? buildIssue(selectedBuilding, draft).payload : null;

  return (
    <div className="contrib-app">
      <ContributionHeader maintainerMode={maintainerMode} />
      <main className="contrib-main">
        <section className="contrib-intro">
          <div>
            <div className="contrib-kicker"><Sparkles size={13} /> Open campus mapping</div>
            <h1>{maintainerMode ? 'Entrance Studio.' : 'Map an entrance.'}</h1>
            <p>
              {maintainerMode
                ? 'Inspect canonical doors, place precise geometry, and prepare auditable contributions without editing GeoJSON by hand.'
                : 'Choose a building, click or locate the doorway, describe only what you actually know, and send a reviewable contribution to Gapwise Data.'}
            </p>
          </div>
          <div className="contrib-intro-badge"><ShieldCheck size={17} /><div><strong>Unknown is valid</strong><span>Never guess access or accessibility.</span></div></div>
        </section>

        <section className="contrib-workspace">
          <aside className="contrib-sidebar">
            <StepRail step={step} />
            {!selectedBuilding ? (
              <BuildingPicker query={buildingQuery} setQuery={setBuildingQuery} selectedCode={selectedCode} onSelect={setSelectedCode} />
            ) : (
              <div className="contrib-selected-building">
                <div className="contrib-building-tools">
                  <button type="button" className="contrib-back-building" onClick={() => setSelectedCode('')}><ArrowLeft size={14} /> Change building</button>
                  <button type="button" className="contrib-share-button" onClick={copyShareLink}><Link2 size={13} /> {copied === 'link' ? 'Copied' : 'Share'}</button>
                </div>
                <div className="contrib-building-heading"><span>{selectedBuilding.code}</span><div><strong>{selectedBuilding.name}</strong><small>{selectedBuilding.category} · {selectedBuilding.entranceCount} mapped entrance{selectedBuilding.entranceCount === 1 ? '' : 's'}</small></div></div>

                {step === 0 ? (
                  <div className="contrib-step-content">
                    <div className="contrib-panel-title"><MapPin size={17} /><div><strong>Place the entrance</strong><span>Click the exact exterior doorway, drag the red pin to refine it, or use your device location while standing at the door.</span></div></div>
                    <button type="button" className="contrib-location-button" onClick={useCurrentLocation} disabled={locationState.status === 'loading'}>
                      <LocateFixed size={15} /> {locationState.status === 'loading' ? 'Finding location…' : 'Use my current location'}
                    </button>
                    {locationState.message ? <p className={`contrib-location-status ${locationState.status}`}>{locationState.message}</p> : null}
                    {draft.coordinates ? (
                      <div className="contrib-coordinate-card">
                        <span>Selected coordinates</span>
                        <code>{draft.coordinates[1].toFixed(7)}, {draft.coordinates[0].toFixed(7)}</code>
                        <button type="button" onClick={() => updateDraft({ coordinates: null, contributionType: 'new_entrance', existingEntranceId: '' })}>Clear</button>
                      </div>
                    ) : <div className="contrib-empty-hint"><MousePointer2 size={16} /> Click the map to place a new doorway, or click an existing entrance to contribute details.</div>}
                    <DuplicateNotice nearest={nearest} onSame={() => selectExisting(nearest.entrance)} onDifferent={() => updateDraft({ duplicateDecision: 'different' })} />
                    {draft.contributionType === 'existing_entrance_update' ? <div className="contrib-existing-target"><Check size={15} /><span>Updating <code>{draft.existingEntranceId}</code></span><button type="button" onClick={() => selectNewLocation(draft.coordinates)}>Treat as new</button></div> : null}
                  </div>
                ) : null}

                {step === 1 ? (
                  <div className="contrib-step-content contrib-form">
                    <label className="contrib-input-label"><span>Entrance name <small>optional</small></span><input value={draft.label} onChange={(event) => updateDraft({ label: event.target.value })} placeholder="North entrance, Main entrance…" /></label>
                    <OptionGroup
                      label="How do you know about it?"
                      value={draft.observationMethod}
                      onChange={(value) => updateDraft({ observationMethod: value })}
                      options={[
                        { value: 'field_observation', label: 'I observed it', caption: 'You saw the entrance yourself.', icon: <LocateFixed size={17} /> },
                        { value: 'source', label: 'I found a source', caption: 'An official or public source identifies it.', icon: <FileJson size={17} /> },
                      ]}
                    />
                    <label className="contrib-input-label"><span>Observation date</span><input type="date" max={todayLocalDate()} value={draft.observedAt} onChange={(event) => updateDraft({ observedAt: event.target.value })} /></label>
                    {draft.observationMethod === 'source' ? <label className="contrib-input-label"><span>Source URL</span><input type="url" value={draft.sourceUrl} onChange={(event) => updateDraft({ sourceUrl: event.target.value })} placeholder="https://…" /></label> : null}

                    <OptionGroup
                      label="Can students normally enter here?"
                      help="Choose Not sure unless you personally verified ordinary access."
                      value={draft.publicAccess}
                      onChange={(value) => updateDraft({ publicAccess: value })}
                      options={[
                        { value: 'verified', label: 'Yes', caption: 'Ordinary student/public entry observed.', icon: <Check size={17} /> },
                        { value: 'restricted', label: 'Restricted', caption: 'Not ordinary public/student access.', icon: <ShieldCheck size={17} /> },
                        { value: 'unknown', label: 'Not sure', caption: 'Keep this fact unknown.', icon: <CircleHelp size={17} /> },
                      ]}
                    />
                    <OptionGroup
                      label="Which direction does the door work?"
                      value={draft.direction}
                      onChange={(value) => updateDraft({ direction: value })}
                      options={[
                        { value: 'bidirectional', label: 'Both ways', caption: 'Entry and exit.', icon: <span aria-hidden="true">↔</span> },
                        { value: 'entry_only', label: 'Entry only', caption: 'Cannot normally exit here.', icon: <span aria-hidden="true">→</span> },
                        { value: 'exit_only', label: 'Exit only', caption: 'Cannot normally enter here.', icon: <span aria-hidden="true">←</span> },
                        { value: 'unknown', label: 'Not sure', caption: 'No directional claim.', icon: <CircleHelp size={17} /> },
                      ]}
                    />
                    <OptionGroup
                      label="Is the entrance step-free?"
                      help="Only mark Yes if the actual doorway and immediate approach are step-free."
                      value={draft.barrierFree}
                      onChange={(value) => updateDraft({ barrierFree: value })}
                      options={[
                        { value: 'verified', label: 'Yes', caption: 'Step-free doorway/approach observed.', icon: <Accessibility size={17} /> },
                        { value: 'not_barrier_free', label: 'No', caption: 'A step or stairs block this entrance.', icon: <span aria-hidden="true">↗</span> },
                        { value: 'unknown', label: 'Not sure', caption: 'Leave accessibility unknown.', icon: <CircleHelp size={17} /> },
                      ]}
                    />
                    <label className="contrib-input-label"><span>Notes <small>optional</small></span><textarea value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} rows="4" maxLength="1200" placeholder="Double doors beside the bus pickup area. Do not include faces, access-control details, or private information." /></label>
                  </div>
                ) : null}

                {step === 2 ? (
                  <div className="contrib-step-content">
                    <div className="contrib-panel-title"><Check size={17} /><div><strong>Review the contribution</strong><span>This is evidence for review, not an automatic change to canonical routing data.</span></div></div>
                    <ReviewCard building={selectedBuilding} draft={draft} />
                    {maintainerMode && issuePayload ? (
                      <div className="contrib-maintainer-payload">
                        <div><strong>Machine-readable payload</strong><span>Use this exact object in review tooling or a follow-up PR.</span></div>
                        <pre><code>{JSON.stringify(issuePayload, null, 2)}</code></pre>
                        <button type="button" onClick={() => copyText(JSON.stringify(issuePayload, null, 2), 'payload')}>{copied === 'payload' ? <Check size={14} /> : <Clipboard size={14} />} {copied === 'payload' ? 'Copied' : 'Copy JSON'}</button>
                      </div>
                    ) : null}
                    {submitted ? <div className="contrib-submitted"><ExternalLink size={17} /><div><strong>GitHub review form opened.</strong><span>Your structured contribution is prefilled. Submit the issue there to enter the public review queue.</span></div></div> : null}
                  </div>
                ) : null}

                <div className="contrib-step-actions">
                  {step > 0 ? <button type="button" className="contrib-secondary-button" onClick={() => setStep((value) => value - 1)}><ArrowLeft size={14} /> Back</button> : <span />}
                  {step < 2 ? (
                    <button type="button" className="contrib-primary-button" disabled={!canContinue()} onClick={() => setStep((value) => value + 1)}>Continue <ArrowRight size={14} /></button>
                  ) : (
                    <button type="button" className="contrib-primary-button" onClick={submitToGitHub}>Submit for review <ExternalLink size={14} /></button>
                  )}
                </div>
              </div>
            )}
          </aside>

          <div className="contrib-map-column">
            <CampusEditorMap
              selectedBuilding={selectedBuilding}
              draft={draft}
              onPlace={selectNewLocation}
              onChooseExisting={selectExisting}
              onSelectBuilding={setSelectedCode}
              focusedEntranceId={focusedEntranceId}
            />
            <div className="contrib-map-footer"><div><DoorOpen size={15} /><span>Canonical footprints + mapped entrances</span></div><div><strong>{entranceFeatures.length}</strong><span>mapped points loaded</span></div></div>
          </div>
        </section>

        <section className="contrib-explainer">
          <article><span>01</span><div><strong>Click, locate, then refine</strong><p>Pick the building visually, place the point from the map or your device location, then drag the red marker to the exact doorway.</p></div></article>
          <article><span>02</span><div><strong>Evidence stays narrow</strong><p>Existence, public access, direction, and accessibility are separate claims. Unknown remains a first-class value.</p></div></article>
          <article><span>03</span><div><strong>Humans still review it</strong><p>Submissions become reviewable GitHub issues. Canonical entrance data changes only after validation and maintainer review.</p></div></article>
        </section>
      </main>
      <footer className="contrib-footer"><div><a className="contrib-brand" href="/"><img src="/logo-mark.svg" alt="" /><span>Gapwise Data</span></a><p>Independent student project · Not an official University of Toronto service.</p><a href={DATA_REPOSITORY} target="_blank" rel="noreferrer">Repository <ExternalLink size={12} /></a></div></footer>
    </div>
  );
}
