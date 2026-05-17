import { isZodDtoMarker, makeZodDtoMarker } from '../../src';

describe('makeZodDtoMarker / isZodDtoMarker', () => {
  it('makeZodDtoMarker produces the documented payload', () => {
    const marker = makeZodDtoMarker('Marker_User', 'input');
    expect(marker.__zodNestDto).toBe(true);
    expect(marker.dtoId).toBe('Marker_User');
    expect(marker.io).toBe('input');
    expect(marker.required).toBe(false);
    expect(typeof marker.type).toBe('function');
    expect(marker.type()).toBe(Object);
  });

  it('isZodDtoMarker recognizes a freshly built marker', () => {
    expect(isZodDtoMarker(makeZodDtoMarker('M', 'input'))).toBe(true);
    expect(isZodDtoMarker(makeZodDtoMarker('M', 'output'))).toBe(true);
  });

  it('isZodDtoMarker rejects non-marker values', () => {
    expect(isZodDtoMarker(null)).toBe(false);
    expect(isZodDtoMarker(undefined)).toBe(false);
    expect(isZodDtoMarker(42)).toBe(false);
    expect(isZodDtoMarker('not a marker')).toBe(false);
    expect(isZodDtoMarker({})).toBe(false);
    expect(isZodDtoMarker({ __zodNestDto: false })).toBe(false);
    expect(isZodDtoMarker({ __zodNestDto: 'true' })).toBe(false);
  });
});
