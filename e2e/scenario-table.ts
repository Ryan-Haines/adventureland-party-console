import type {LiveGame} from './live-fixtures';
import type {TableRow} from './fixtures';

// A row of a live play, typed as the console fixture's table rows are (e2e/fixtures.ts
// `TableRow`). A row that drives the dashboard takes the test's page as its third argument.
export type Row = TableRow<LiveGame>;
