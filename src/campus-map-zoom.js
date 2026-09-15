const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.35;

function enhanceMap(wrap) {
  if (!(wrap instanceof HTMLElement)) return;
  if (wrap.dataset.zoomEnhanced === 'true') return;

  const map = wrap.querySelector('svg.campus-map');
  if (!(map instanceof SVGElement)) return;

  wrap.dataset.zoomEnhanced = 'true';
  let zoom = 1;

  const controls = document.createElement('div');
  controls.className = 'campus-map-zoom-controls';
  controls.setAttribute('aria-label', 'Map zoom controls');

  const zoomOut = document.createElement('button');
  zoomOut.type = 'button';
  zoomOut.textContent = '−';
  zoomOut.title = 'Zoom out';
  zoomOut.setAttribute('aria-label', 'Zoom out');

  const zoomIn = document.createElement('button');
  zoomIn.type = 'button';
  zoomIn.textContent = '+';
  zoomIn.title = 'Zoom in';
  zoomIn.setAttribute('aria-label', 'Zoom in');

  const level = document.createElement('button');
  level.type = 'button';
  level.className = 'campus-map-zoom-level';
  level.title = 'Reset map zoom';
  level.setAttribute('aria-label', 'Reset map zoom');

  function applyZoom() {
    const normalized = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    zoom = normalized;
    map.style.transform = `scale(${zoom})`;
    level.textContent = `${Math.round(zoom * 100)}% · RESET`;
    zoomOut.disabled = zoom <= MIN_ZOOM + 0.001;
    zoomIn.disabled = zoom >= MAX_ZOOM - 0.001;
  }

  zoomOut.addEventListener('click', (event) => {
    event.stopPropagation();
    zoom = Math.max(MIN_ZOOM, zoom / ZOOM_STEP);
    if (zoom < 1.03) zoom = 1;
    applyZoom();
  });

  zoomIn.addEventListener('click', (event) => {
    event.stopPropagation();
    zoom = Math.min(MAX_ZOOM, zoom * ZOOM_STEP);
    applyZoom();
  });

  level.addEventListener('click', (event) => {
    event.stopPropagation();
    zoom = 1;
    applyZoom();
  });

  controls.addEventListener('click', (event) => event.stopPropagation());
  controls.append(zoomOut, zoomIn, level);
  wrap.appendChild(controls);
  applyZoom();
}

function enhanceAllMaps() {
  document.querySelectorAll('.campus-map-wrap').forEach(enhanceMap);
}

enhanceAllMaps();

const observer = new MutationObserver(() => enhanceAllMaps());
if (document.body) {
  observer.observe(document.body, { childList: true, subtree: true });
}
