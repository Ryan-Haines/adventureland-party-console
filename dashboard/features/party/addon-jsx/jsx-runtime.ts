// The JSX runtime an add-on's dashboard.tsx compiles against: its `@jsxImportSource` pragma names this folder, so its JSX resolves
// to the dashboard's one React from a dashboard file.
export * from 'react/jsx-runtime';
export type { JSX } from 'react/jsx-runtime';
