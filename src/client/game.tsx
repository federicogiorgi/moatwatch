import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChartView } from './ChartView';

/** Expanded view: the same grid, with the room to actually read it. */
export const App = () => {
  return (
    <div className="h-full w-full bg-[#0d1117]">
      <ChartView />
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
