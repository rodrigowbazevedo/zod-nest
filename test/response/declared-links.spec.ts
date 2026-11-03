import type { OpenAPIObject } from '@nestjs/swagger';

import { applyZodNest } from '../../src';
import { anyLinksDeclared, markLinksDeclared } from '../../src/response/declared-links.js';
import { ZOD_NEST_LINKS_EXTENSION } from '../../src/schema/constants.js';

const docWithMarkedResponse = (): OpenAPIObject =>
  ({
    openapi: '3.1.0',
    info: { title: 't', version: 'v' },
    paths: {
      '/things': {
        get: {
          responses: { 200: { description: 'd', [ZOD_NEST_LINKS_EXTENSION]: { gone: 'x' } } },
        },
      },
    },
  }) as unknown as OpenAPIObject;

const markerSurvives = (doc: OpenAPIObject): boolean =>
  JSON.stringify(doc).includes(ZOD_NEST_LINKS_EXTENSION);

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

// Order-dependent: the flag is process-wide and only ever flips on.
describe('declared-links gate', () => {
  it('skips the dropped-links walk until a link is declared', () => {
    expect(anyLinksDeclared()).toBe(false);

    expect(markerSurvives(applyZodNest(docWithMarkedResponse()))).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('runs the walk once a link is declared', () => {
    markLinksDeclared();

    expect(anyLinksDeclared()).toBe(true);
    expect(markerSurvives(applyZodNest(docWithMarkedResponse()))).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`gone`'));
  });
});
