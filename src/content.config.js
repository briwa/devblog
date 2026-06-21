import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    // No `date` field — creation day comes from the filename (src/lib/created.js).
    updated: z.coerce.date().optional(),
    // Stored as one comma-separated string, but a YAML list is tolerated too.
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    // `draft: true` unlists the entry; absent/false means published.
    draft: z.boolean().optional().default(false),
  }),
});

export const collections = { posts };
