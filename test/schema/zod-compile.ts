import type { z } from 'zod';

// Non-literal so Vite doesn't resolve it at transform time on the zod 4.4 floor.
const ZOD_COMPILE_SPECIFIER = 'zod/compile';

/** Installs zod's global compiler when available; `zod/compile` ships from zod 4.5. */
export const loadZodCompile = async (): Promise<boolean> => {
  try {
    await import(/* @vite-ignore */ ZOD_COMPILE_SPECIFIER);
    return true;
  } catch {
    return false;
  }
};

export const isCompiled = (schema: z.ZodType): boolean => schema._zod.bag.validator !== undefined;
