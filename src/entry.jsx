import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './accent-theme.css';

const pathname = window.location.pathname.replace(/\/+$/, '') || '/';

if (pathname === '/contribute' || pathname.startsWith('/contribute/')) {
  const { default: EntranceContribution } = await import('./EntranceContribution.jsx');
  createRoot(document.getElementById('root')).render(<EntranceContribution />);
} else if (pathname === '/studio/entrances') {
  const { default: EntranceContribution } = await import('./EntranceContribution.jsx');
  createRoot(document.getElementById('root')).render(<EntranceContribution maintainerMode />);
} else {
  await import('./main.jsx');
}
