import { loadPosts, yearsOf, jsonResponse } from '../../lib/entries.js';

// The set of years that have entries (newest first); the home fetches this at
// runtime rather than baking it into the page.
export const GET = async () => jsonResponse(yearsOf(await loadPosts()));
