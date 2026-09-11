import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@stara/ui/styles';
import { RuntimeApp } from './RuntimeApp';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RuntimeApp />
  </StrictMode>,
);
