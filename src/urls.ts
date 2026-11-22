const base = import.meta.env.BASE_URL;

export const thumbUrl = (id: string): string => `${base}photos/thumb/${id}.webp`;
export const fullUrl = (id: string): string => `${base}photos/full/${id}.webp`;
