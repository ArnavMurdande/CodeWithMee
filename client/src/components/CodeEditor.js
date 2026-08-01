import Editor, { loader } from '@monaco-editor/react';

// Keep the compatibility editor version aligned with the exact installed package.
// Phase 5 replaces this CDN compatibility boundary with self-hosted workers/assets.
loader.config({
  paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.56.0/min/vs' },
});

export default Editor;
