import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './accent-theme.css';

const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
const rootElement = document.getElementById('root');

function renderEntranceStudio(maintainerMode = false) {
  import('./EntranceContribution.jsx').then(({ default: EntranceContribution }) => {
    createRoot(rootElement).render(
      <EntranceContribution maintainerMode={maintainerMode} />,
    );
  });
}

function renderBatchEntranceStudio() {
  import('./BatchEntranceContribution.jsx').then(({ default: BatchEntranceContribution }) => {
    createRoot(rootElement).render(<BatchEntranceContribution />);
  });
}

function renderEntrancePrReview() {
  import('./EntrancePrReview.jsx').then(({ default: EntrancePrReview }) => {
    createRoot(rootElement).render(<EntrancePrReview />);
  });
}

if (pathname === '/review/entrances') {
  renderEntrancePrReview();
} else if (pathname === '/contribute/single') {
  renderEntranceStudio(false);
} else if (pathname === '/contribute' || pathname === '/contribute/batch') {
  renderBatchEntranceStudio();
} else if (pathname.startsWith('/contribute/')) {
  renderEntranceStudio(false);
} else if (pathname === '/studio/entrances') {
  renderEntranceStudio(true);
} else {
  import('./main.jsx');
}
