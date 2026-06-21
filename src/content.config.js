import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Each blog entry is a markdown file in src/content/posts/.
// The /posts/new editor writes these files; Astro reads them at build time.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    // The creation day comes from the filename, not frontmatter — see
    // src/lib/created.js. `updated` is stamped by the editor on every edit;
    // absent on never-edited posts.
    updated: z.coerce.date().optional(),
    // Tags: stored as one comma-separated string (`tags: "Food, Seoul"`), but a
    // hand-written YAML list is tolerated too. Parsed via src/lib/tags.js
    // wherever it's rendered — never split inline.
    tags: z.union([z.string(), z.array(z.string())]).optional(),
  }),
});

export const collections = { posts };
