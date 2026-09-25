import { RolesGuard } from './roles.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { UserRole } from '@prisma/client';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  const makeContext = (user: any, roles?: UserRole[] | null): ExecutionContext => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(roles ?? null);
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  };

  it('passes through when no @Roles() is set', () => {
    expect(guard.canActivate(makeContext(null, null))).toBe(true);
  });

  it('passes through when @Roles() is an empty array', () => {
    expect(guard.canActivate(makeContext({ role: UserRole.BUYER }, []))).toBe(true);
  });

  it('allows access when user has the required role', () => {
    const ctx = makeContext({ role: UserRole.ADMIN }, [UserRole.ADMIN]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('denies access when user lacks the required role', () => {
    const ctx = makeContext({ role: UserRole.BUYER }, [UserRole.ADMIN]);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('denies access when user is not authenticated', () => {
    const ctx = makeContext(null, [UserRole.ADMIN]);
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('allows access when user role matches one of multiple required roles', () => {
    const ctx = makeContext({ role: UserRole.SUPPLIER }, [UserRole.ADMIN, UserRole.SUPPLIER]);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
