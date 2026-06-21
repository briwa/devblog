// Display name for the site. Override by setting PUBLIC_SITE_NAME (in a .env
// file locally, or as a build-time env var on Cloudflare); falls back to "Devblog".
export const SITE_NAME = import.meta.env.PUBLIC_SITE_NAME || 'Devblog';
