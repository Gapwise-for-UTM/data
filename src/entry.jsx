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

if (pathname === '/contribute' || pathname.startsWith('/contribute/')) {
  renderEntranceStudio(false);
} else if (pathname === '/studio/entrances') {
  renderEntranceStudio(true);
} else {
  import('./main.jsx');
}
