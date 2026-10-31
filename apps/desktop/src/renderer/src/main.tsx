import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'dockview-react/dist/styles/dockview.css';
import './styles/theme.css';
import { App } from './app/App';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
