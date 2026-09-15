import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpen, Braces, Check, ChevronRight, Clipboard, Database, ExternalLink, FileJson, Layers3, Map, MapPinned, Menu, Search, ShieldCheck, Sparkles, X } from 'lucide-react';
import './styles.css';
import './accent-theme.css';

const datasets = [
  { name: 'Building registry', file: 'building-registry.ts', type: 'Registry', status: 'Maintained', description: 'Canonical building codes, names, aliases, categories and room-to-floor interpretation rules.', fields: ['code', 'name', 'category', 'aliases', 'roomFloorRule'] },
  { name: 'Campus buildings', file: 'buildings.geojson', type: 'GeoJSON', status: 'Derived + reviewed', description: 'Navigation points and canonical building metadata for the UTM campus.', fields: ['geometry', 'code', 'name', 'geometryRole', 'source'] },
  { name: 'Building footprints', file: 'footprints/*.geojson', type: 'GeoJSON', status: 'Source-linked', description: 'Per-building polygon geometry with source IDs and provenance notes.', fields: ['buildingCode', 'name', 'category', 'sourceIds', 'geometry'] },
  { name: 'Entrances & access', file: 'generated/campus-access-audit.json', type: 'JSON', status: 'Audited', description: 'Coverage and verification information for exterior entrances and approach geometry.', fields: ['code', 'canonicalGeometry', 'verifiedExteriorEntrances', 'inferredApproaches'] },
];

const schemas = [
  ['code', 'string', 'required'],
  ['name', 'string', 'required'],
  ['category', 'BuildingCategory', 'required'],
  ['aliases', 'string[]', 'optional'],
  ['roomFloorRule', 'function', 'optional'],
  ['sourceIds', 'string[]', 'source'],
];

const DATASET_BASE = 'https://data.gapwise.ca/datasets/utm/latest';
const GITHUB_ORG = 'https://github.com/Gapwise-for-UTM';
const DATA_REPOSITORY = `${GITHUB_ORG}/data`;

const snippets = {
  js: `const response = await fetch(\n  '${DATASET_BASE}/buildings.geojson'\n);\nconst campus = await response.json();\n\nconst deerfield = campus.features.find(\n  feature => feature.properties.code === 'DH'\n);`,
  python: `import requests\n\nurl = "${DATASET_BASE}/buildings.geojson"\ncampus = requests.get(url).json()\n\ndeerfield = next(\n    f for f in campus["features"]\n    if f["properties"]["code"] == "DH"\n)`,
  curl: `curl -L \\\n  ${DATASET_BASE}/buildings.geojson`,
};

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [codeTab, setCodeTab] = useState('js');
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => datasets.filter((dataset) => {
    const haystack = `${dataset.name} ${dataset.file} ${dataset.type} ${dataset.description} ${dataset.fields.join(' ')}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  }), [query]);

  async function copySnippet() {
    await navigator.clipboard.writeText(snippets[codeTab]);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#top"><img src="/logo-mark.svg" alt=""/><span>Gapwise <b>Data</b></span></a>
        <button className="menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button>
        <nav className={`nav ${menuOpen ? 'open' : ''}`}>
          <a href="#datasets">Datasets</a><a href="/contribute">Contribute</a><a href="#collection">Collection</a><a href="#schemas">Schemas</a><a href="#reuse">Use the data</a>
          <a href="https://docs.gapwise.ca/data/">Docs</a>
          <a href="https://api.gapwise.ca/v1">API</a>
          <a href="https://gapwise.ca/developers">Developers</a>
          <a href={DATA_REPOSITORY} target="_blank" rel="noreferrer">GitHub <ExternalLink size={13}/></a>
        </nav>
      </header>

      <main id="top">
        <section className="hero shell">
          <div className="eyebrow"><Sparkles size={13}/> Open campus data, explained</div>
          <h1>The map behind <span>Gapwise.</span></h1>
          <p className="lead">The canonical UTM campus data layer behind Gapwise: first-party downloads, provenance, schemas, validation, attribution, transparent uncertainty, and a visual contribution workflow.</p>
          <div className="hero-actions">
            <a className="primary" href="/contribute"><MapPinned size={15}/> Map an entrance <ChevronRight size={16}/></a>
            <a className="secondary" href="#datasets"><Database size={15}/> Explore the data</a>
            <a className="secondary" href="https://docs.gapwise.ca/data/"><BookOpen size={15}/> Read the data docs</a>
            <a className="secondary" href={`${DATA_REPOSITORY}/tree/main/data/utm`}><Braces size={15}/> View source</a>
          </div>
          <div className="stats"><div><strong>GeoJSON</strong><span>Spatial data</span></div><div><strong>Auditable</strong><span>Provenance-first</span></div><div><strong>Contributable</strong><span>Visual entrance editor</span></div><div><strong>UTM</strong><span>Current coverage</span></div></div>
        </section>

        <section className="shell intro-grid">
          <article className="feature-card"><MapPinned size={22}/><h3>Geometry with context</h3><p>Not just coordinates. Building identity, geometry role, source IDs and campus semantics live alongside the map.</p></article>
          <article className="feature-card"><ShieldCheck size={22}/><h3>Provenance over guesswork</h3><p>Every useful map eventually faces uncertainty. Gapwise records where data came from and what is inferred.</p></article>
          <article className="feature-card"><Braces size={22}/><h3>Built to be reused</h3><p>Stable codes, conventional formats, first-party URLs, and checksums make the data practical to consume and verify.</p></article>
        </section>

        <section id="datasets" className="section shell">
          <div className="section-heading"><div><div className="kicker"><Database size={14}/> Dataset catalog</div><h2>Know what exists.</h2><p>Browse the major data surfaces behind Gapwise.</p></div><label className="search"><Search size={15}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search datasets"/></label></div>
          <div className="dataset-grid">{filtered.map((dataset) => <article className="dataset" key={dataset.file}><div className="dataset-top"><span className="file-icon"><FileJson size={18}/></span><span className="badge">{dataset.status}</span></div><h3>{dataset.name}</h3><code>{dataset.file}</code><p>{dataset.description}</p><div className="fields">{dataset.fields.map((field) => <span key={field}>{field}</span>)}</div></article>)}</div>
        </section>

        <div id="collection" className="process-wrap"><section className="section shell"><div className="kicker"><Layers3 size={14}/> Collection pipeline</div><h2>From source to campus model.</h2><p className="section-copy">The useful part of open data is not merely publishing a file. It is explaining what happened before the file reached you.</p><div className="process">{[['01','Collect','Start with official, source-linked, or directly observed campus information.'],['02','Normalize','Convert inconsistent names, identifiers, coordinates, and metadata into stable project conventions.'],['03','Verify','Cross-check geometry and semantics against independent signals where practical.'],['04','Derive','Generate routing-friendly or application-specific data without presenting inference as observation.'],['05','Publish','Expose validated artifacts through first-party URLs with a machine-readable checksum manifest.']].map(([n,title,copy]) => <article className="step" key={n}><span>{n}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div></section></div>

        <section id="schemas" className="section shell"><div className="schema-grid"><div><div className="kicker"><BookOpen size={14}/> Schema explorer</div><h2>Readable by people and machines.</h2><p className="section-copy">Stable fields make downstream projects less brittle. Schema documentation distinguishes required values, optional enrichments, and source metadata.</p><div className="legend"><span><i className="dot required"/>required</span><span><i className="dot optional"/>optional</span><span><i className="dot source"/>source</span></div><p className="section-copy"><a href="/schemas/dataset-manifest.schema.json">Machine-readable distribution manifest schema →</a></p><p className="section-copy"><a href="/schemas/entrance-contribution.schema.json">Entrance contribution schema →</a></p></div><div className="schema-card"><div className="schema-title"><Braces size={16}/><code>BuildingRecord</code></div>{schemas.map(([field,type,kind]) => <div className="schema-row" key={field}><b>{field}</b><code>{type}</code><em>{kind}</em></div>)}</div></div></section>

        <section id="reuse" className="section shell"><div className="kicker"><Map size={14}/> Use the data</div><h2>Use a first-party Gapwise URL.</h2><p className="section-copy">Raw source-level artifacts are distributed from <code>data.gapwise.ca</code>. Applications that need stable campus-intelligence behavior should prefer the Gapwise public API or SDKs. Production Gapwise itself uses a tested pinned snapshot and does not depend on this website being online.</p><div className="codebox"><div className="codebar"><div>{['js','python','curl'].map(tab => <button key={tab} className={codeTab===tab?'active':''} onClick={() => setCodeTab(tab)}>{tab === 'js' ? 'JavaScript' : tab === 'python' ? 'Python' : 'curl'}</button>)}</div><button className="copy" onClick={copySnippet}>{copied ? <Check size={14}/> : <Clipboard size={14}/>} {copied ? 'Copied' : 'Copy'}</button></div><pre><code>{snippets[codeTab]}</code></pre></div><div className="hero-actions"><a className="secondary" href="/datasets/utm/latest/manifest.json"><FileJson size={15}/> Dataset manifest</a><a className="secondary" href="https://api.gapwise.ca/v1"><Braces size={15}/> Stable API</a><a className="secondary" href="https://docs.gapwise.ca/data/"><BookOpen size={15}/> Reuse guide</a><a className="secondary" href="/contribute"><MapPinned size={15}/> Contribute an entrance</a></div></section>

        <section className="section shell principles"><div><ShieldCheck size={28}/><div className="kicker">Data principles</div><h2>Trust is part of the dataset.</h2></div><div className="principle-list">{[['01','Explain transformations','Document how source material becomes application data.'],['02','Separate fact from inference','Derived navigation geometry should never masquerade as direct observation.'],['03','Prefer stable identifiers','Names change. Durable codes and source IDs make integrations more resilient.'],['04','Preserve provenance','A useful record should carry enough context to understand where it came from.']].map(([n,title,copy]) => <article key={n}><span>{n}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}</div></section>
      </main>

      <footer><div className="shell footer-inner"><a className="brand" href="#top"><img src="/logo-mark.svg" alt=""/><span>Gapwise Data</span></a><p>Independent project · Not an official University of Toronto service.</p><a href="/contribute">Contribute</a><a href="https://gapwise.ca">App <ExternalLink size={12}/></a><a href="https://gapwise.ca/developers">Developers <ExternalLink size={12}/></a><a href="https://docs.gapwise.ca/data/">Docs <ExternalLink size={12}/></a><a href="https://api.gapwise.ca/v1">API <ExternalLink size={12}/></a><a href="https://status.gapwise.ca">Status <ExternalLink size={12}/></a><a href={DATA_REPOSITORY}>Repository <ExternalLink size={12}/></a></div></footer>
    </>
  );
}

createRoot(document.getElementById('root')).render(<App/>);
