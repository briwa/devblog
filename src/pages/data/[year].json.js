import { loadPosts, entriesByYear, jsonResponse } from '../../lib/entries.js';

// One static JSON per year (e.g. /data/2024.json) of that year's entries; the
// home fetches only the year in view so the payload doesn't grow with the
// archive. The per-entry shape lives in src/lib/entryData.js.
export const getStaticPaths = async () => entriesByYear(await loadPosts());
export const GET = ({ props }) => jsonResponse(props.entries);
