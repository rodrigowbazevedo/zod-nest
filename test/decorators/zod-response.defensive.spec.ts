import 'reflect-metadata';

import { z } from 'zod';

import { createZodDto } from '../../src';
import { ZodResponse } from '../../src/decorators/zod-response.decorator.js';

class Dto extends createZodDto(z.object({ a: z.string() }), { id: 'Defensive_Dto' }) {}

// These tests exercise defensive fall-throughs that the type system /
// upstream guards already make unreachable from normal user code. They
// document the intent ("loud failure if upstream invariant breaks") and
// keep coverage honest after a future refactor that drops the upstream
// guard.

describe('@ZodResponse — defensive fall-throughs', () => {
  it('throws when applied to a non-function descriptor.value', () => {
    const decorator = ZodResponse({ type: Dto });
    const fakeDescriptor = { value: 'not-a-function' } as unknown as TypedPropertyDescriptor<never>;

    expect(() => decorator({}, 'fake', fakeDescriptor)).toThrow(/can only be applied to methods/);
  });
});
