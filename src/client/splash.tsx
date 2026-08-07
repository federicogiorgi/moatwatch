import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ChartView } from './ChartView';

/** Inline feed view: the chart grid, tappable to expand. */
export const Splash = () => {
  return (
    <div
      className="relative h-full w-full cursor-pointer bg-[#0d1117]"
      onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
    >
      <ChartView />
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
