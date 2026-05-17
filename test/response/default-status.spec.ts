import 'reflect-metadata';

import { Delete, Get, Patch, Post, Put, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';

import { defaultStatusFor } from '../../src/response/default-status.js';

class Routes {
  @Get('a')
  getA(): void {}

  @Post('b')
  postB(): void {}

  @Put('c')
  putC(): void {}

  @Delete('d')
  deleteD(): void {}

  @Patch('e')
  patchE(): void {}
}

describe('defaultStatusFor', () => {
  it('returns 201 for POST handlers', () => {
    expect(defaultStatusFor(Routes.prototype.postB)).toBe(201);
  });

  it('returns 200 for GET / PUT / DELETE / PATCH handlers', () => {
    expect(defaultStatusFor(Routes.prototype.getA)).toBe(200);
    expect(defaultStatusFor(Routes.prototype.putC)).toBe(200);
    expect(defaultStatusFor(Routes.prototype.deleteD)).toBe(200);
    expect(defaultStatusFor(Routes.prototype.patchE)).toBe(200);
  });

  it('returns 200 when no METHOD_METADATA is present (defensive fallback)', () => {
    const bare = function bare(): void {};
    expect(defaultStatusFor(bare)).toBe(200);
  });

  it('reads the documented METHOD_METADATA key — pins behavior so a Nest rename fails loudly', () => {
    // If this assertion ever fails, NestJS' METHOD_METADATA constant changed
    // value/name and `defaultStatusFor` will silently return 200 for POST.
    expect(METHOD_METADATA).toBe('method');
    expect(RequestMethod.POST).toBe(1);
    expect(Reflect.getMetadata(METHOD_METADATA, Routes.prototype.postB)).toBe(RequestMethod.POST);
  });
});
