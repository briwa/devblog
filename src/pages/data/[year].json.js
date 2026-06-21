import { loadPosts, entriesByYear, published, jsonResponse } from '../../lib/entries.js';

// One static JSON per year so the home fetches only the year in view; drafts excluded.
export const getStaticPaths = async () => entriesByYear(published(await loadPosts()));
export const GET = ({ props }) => jsonResponse(props.entries);
