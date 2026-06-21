import { loadPosts, yearsOf, published, jsonResponse } from '../../lib/entries.js';

// Years with published entries, newest first; drafts excluded so an unlisted entry surfaces no year.
export const GET = async () => jsonResponse(yearsOf(published(await loadPosts())));
