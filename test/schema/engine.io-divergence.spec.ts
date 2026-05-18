import { z } from 'zod';

import { createRegistry, toOpenApi, ZodNestUnrepresentableError } from '../../src';
import { createZodDto } from '../../src/dto';

describe('toOpenApi — input/output divergence', () => {
  const registry = createRegistry();

  it('transform via pipe produces different input vs output shapes', () => {
    const schema = z
      .string()
      .transform((v) => Number(v))
      .pipe(z.number());
    const inputOut = toOpenApi(schema, { io: 'input', registry }).schema;
    const outputOut = toOpenApi(schema, { io: 'output', registry }).schema;

    expect(inputOut).toEqual({ type: 'string' });
    expect(outputOut).toEqual({ type: 'number' });
  });

  // z.codec() is a $ZodPipe under the hood (def.type === 'pipe'), so the
  // engine treats it like any other pipe: input side emits the input arg's
  // schema, output side emits the output arg's schema (with primitiveOverride
  // mapping z.date() → string + date-time format).
  it('codec (iso string ↔ date) emits input pattern vs output date-time', () => {
    const schema = z.codec(z.iso.datetime(), z.date(), {
      decode: (s) => new Date(s),
      encode: (d) => d.toISOString(),
    });
    const inputOut = toOpenApi(schema, { io: 'input', registry }).schema;
    const outputOut = toOpenApi(schema, { io: 'output', registry }).schema;

    expect(inputOut.type).toBe('string');
    expect(inputOut.format).toBe('date-time');
    expect(typeof inputOut.pattern).toBe('string');
    expect(outputOut).toEqual({ type: 'string', format: 'date-time' });
  });

  it('codec inside z.object() + DTO: input and output siblings diverge', () => {
    const codec = z.codec(z.iso.datetime(), z.date(), {
      decode: (s) => new Date(s),
      encode: (d) => d.toISOString(),
    });
    class EventDto extends createZodDto(z.object({ at: codec })) {}

    const inputOut = toOpenApi(EventDto.schema, { io: 'input', registry }).schema;
    const outputOut = toOpenApi(EventDto.Output.schema, { io: 'output', registry }).schema;

    expect(inputOut.type).toBe('object');
    const inputAt = (inputOut.properties as Record<string, { pattern?: string }> | undefined)?.at;
    expect(inputAt?.pattern).toEqual(expect.any(String));
    expect(outputOut).toMatchObject({
      type: 'object',
      properties: { at: { type: 'string', format: 'date-time' } },
      required: ['at'],
    });
  });

  it('codec under strict mode: representable inner passes, unrepresentable inner throws', () => {
    // z.date() output is rescued by primitiveOverride → strict does not fire.
    const dateCodec = z.codec(z.iso.datetime(), z.date(), {
      decode: (s) => new Date(s),
      encode: (d) => d.toISOString(),
    });
    const dateOut = toOpenApi(dateCodec, { io: 'output', registry, strict: true }).schema;
    expect(dateOut).toEqual({ type: 'string', format: 'date-time' });

    // z.symbol() has no override → strict surfaces the underlying type.
    const symbolCodec = z.codec(z.string(), z.symbol(), {
      decode: (s) => Symbol(s),
      encode: (sym) => sym.toString(),
    });
    let thrown: unknown = undefined;
    try {
      toOpenApi(symbolCodec, { io: 'output', registry, strict: true });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ZodNestUnrepresentableError);
    expect((thrown as ZodNestUnrepresentableError).zodType).toBe('symbol');
  });
});
