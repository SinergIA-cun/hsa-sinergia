import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/700.css';
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { MARCA } from './lib/marca.ts';

// El título se pone aquí y no en `index.html`: el HTML no puede leer una
// variable con valor por omisión, y el demo necesita cambiar el nombre sin
// tocar el archivo.
document.title = `${MARCA.nombre} · Cotizador`;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
