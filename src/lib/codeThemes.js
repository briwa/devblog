// Candidate code color schemes for the dev toggle (CodeThemeToggle.astro).
// Pure data (no CodeMirror import) so both the astro toggle and codeHighlight.js can import it.
// Each id has a matching palette in global.css under :root[data-code-theme='<id>'].
export const DEFAULT_CODE_THEME = 'one';

export const CODE_THEMES = [
  { id: 'one', label: 'One (Atom)' },
  { id: 'github', label: 'GitHub' },
  { id: 'nord', label: 'Nord' },
  { id: 'dracula', label: 'Dracula' },
];
