import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/ui/styles/tokens.css';
import '@/ui/styles/base.css';
import '@/ui/styles/controls.css';
import '@/ui/styles/home.css';
import '@/ui/styles/privacy.css';
import '@/ui/styles/room.css';
import '@/ui/styles/overlays.css';
import { App } from '@/App';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
