import type { ChartsPayload } from './charts';

export type ChartsResponse = {
  type: 'charts';
  postId: string;
  /**
   * Everything the client needs to lay the grid out itself: numbers as
   * strings, and one stretchable SVG plot per panel. Computed once when the
   * post was created and frozen, so every viewer sees identical figures.
   */
  charts: ChartsPayload;
};

export type ErrorResponse = {
  status: 'error';
  message: string;
};
