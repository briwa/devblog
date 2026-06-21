// Creation day is the filename's YYYY-MM-DD prefix (the sole source of truth), anchored at UTC midnight so it displays as the same day everywhere.
export const createdOf = (entry) => new Date(`${entry.id.slice(0, 10)}T00:00:00.000Z`);
