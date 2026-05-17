import { z } from 'zod';

import { createRegistry, toOpenApi } from '../../src';

describe('toOpenApi — composite snapshot', () => {
  it('renders a multi-feature composite as expected', () => {
    const Address = z
      .object({ city: z.string(), zip: z.string() })
      .meta({ id: 'Snapshot_Address', title: 'Address' });

    const Role = z.enum(['admin', 'user']);

    const User = z.object({
      id: z.string(),
      age: z.number().int().min(0),
      isActive: z.boolean(),
      role: Role,
      address: Address,
      createdAt: z.date(),
      tags: z.array(z.string()).optional(),
    });

    const registry = createRegistry();
    const out = toOpenApi(User, { io: 'output', registry });

    expect(out.schema).toMatchSnapshot('user-schema');
    expect(Object.fromEntries(out.refs)).toMatchSnapshot('user-refs');
  });
});
