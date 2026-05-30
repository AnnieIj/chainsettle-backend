/**
 * notifications.gateway.spec.ts
 *
 * Integration-style unit test for NotificationsGateway.
 * Verifies:
 *  - Authenticated clients join the correct user room
 *  - Unauthenticated connections are rejected and disconnected
 *  - pushToUser() emits the notification payload to the right room
 *  - Type filters are respected (subscribe / unsubscribe)
 *  - Disconnects clean up internal maps
 */

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationType } from '@prisma/client';
import { Socket } from 'socket.io';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockJwt = (overrides: Partial<{ sub: string; stellarAddress: string }> = {}) => ({
  sub: 'user-123',
  stellarAddress: 'GTEST...',
  ...overrides,
});

/**
 * Builds a minimal mock Socket whose rooms mimic a real Socket.io socket.
 */
function buildMockSocket(id = 'socket-abc'): Socket & {
  _rooms: Set<string>;
  emitted: Array<[string, any]>;
  disconnected: boolean;
} {
  const emitted: Array<[string, any]> = [];
  const _rooms = new Set<string>();

  return {
    id,
    _rooms,
    emitted,
    disconnected: false,
    handshake: { auth: {}, headers: {} },
    join: jest.fn((room: string) => {
      _rooms.add(room);
      return Promise.resolve();
    }),
    emit: jest.fn((event: string, data: any) => {
      emitted.push([event, data]);
    }),
    disconnect: jest.fn(function (this: any) {
      this.disconnected = true;
    }),
  } as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        {
          provide: JwtService,
          useValue: {
            verify: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'JWT_SECRET') return 'test-secret';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    gateway = module.get(NotificationsGateway);
    jwtService = module.get(JwtService) as jest.Mocked<JwtService>;
    configService = module.get(ConfigService) as jest.Mocked<ConfigService>;

    // Mock a minimal server with adapter rooms
    const rooms = new Map<string, Set<string>>();
    gateway.server = {
      sockets: {
        adapter: { rooms },
      },
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;
  });

  // ── handleConnection ────────────────────────────────────────────────────────

  describe('handleConnection', () => {
    it('joins the correct user room when token is valid', async () => {
      const payload = mockJwt({ sub: 'user-123' });
      jwtService.verify.mockReturnValue(payload as any);

      const client = buildMockSocket();
      client.handshake.auth = { token: 'valid.jwt.token' };

      await gateway.handleConnection(client as any);

      expect(client.join).toHaveBeenCalledWith('user:user-123');
      expect(client.emitted).toContainEqual(
        expect.arrayContaining(['connected', expect.objectContaining({ userId: 'user-123' })]),
      );
    });

    it('rejects and disconnects when no token is provided', async () => {
      const client = buildMockSocket();
      // no auth token

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.emitted).toContainEqual(
        expect.arrayContaining(['error', expect.objectContaining({ message: expect.stringContaining('Missing') })]),
      );
    });

    it('rejects and disconnects when the token is invalid', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });

      const client = buildMockSocket();
      client.handshake.auth = { token: 'bad.jwt' };

      await gateway.handleConnection(client as any);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  // ── handleDisconnect ────────────────────────────────────────────────────────

  describe('handleDisconnect', () => {
    it('removes internal socket maps on disconnect', async () => {
      jwtService.verify.mockReturnValue(mockJwt({ sub: 'user-999' }) as any);
      const client = buildMockSocket('socket-disc');
      client.handshake.auth = { token: 'valid.jwt' };

      await gateway.handleConnection(client as any);

      // Verify socket was registered
      expect((gateway as any).socketUserMap.get('socket-disc')).toBe('user-999');

      gateway.handleDisconnect(client as any);

      expect((gateway as any).socketUserMap.has('socket-disc')).toBe(false);
      expect((gateway as any).typeFilters.has('socket-disc')).toBe(false);
    });
  });

  // ── pushToUser ──────────────────────────────────────────────────────────────

  describe('pushToUser', () => {
    const userId = 'user-push';
    const room = `user:${userId}`;
    const notification = {
      id: 'notif-1',
      type: NotificationType.PAYMENT_RELEASED,
      title: 'Payment Released',
      message: 'Your payment has been released.',
    };

    beforeEach(() => {
      // Pre-populate the server rooms map to simulate connected sockets
      (gateway.server.sockets.adapter.rooms as Map<string, Set<string>>).set(room, new Set(['socket-a', 'socket-b']));

      // Register both sockets as belonging to userId
      (gateway as any).socketUserMap.set('socket-a', userId);
      (gateway as any).socketUserMap.set('socket-b', userId);

      // Mock server.to().emit()
      const emitMock = jest.fn();
      (gateway.server.to as jest.Mock).mockReturnValue({ emit: emitMock });
    });

    it('emits the notification to all sockets in the user room', () => {
      gateway.pushToUser(userId, notification);

      // Both sockets should have received the event
      expect(gateway.server.to).toHaveBeenCalledWith('socket-a');
      expect(gateway.server.to).toHaveBeenCalledWith('socket-b');
    });

    it('respects type filters — only emits to matching sockets', () => {
      // socket-a only wants DISPUTE_RAISED, socket-b has no filter
      (gateway as any).typeFilters.set('socket-a', new Set([NotificationType.DISPUTE_RAISED]));

      gateway.pushToUser(userId, notification); // type is PAYMENT_RELEASED

      // socket-a should NOT receive it (filter mismatch)
      expect(gateway.server.to).not.toHaveBeenCalledWith('socket-a');
      // socket-b (no filter) SHOULD receive it
      expect(gateway.server.to).toHaveBeenCalledWith('socket-b');
    });

    it('does nothing when no sockets are in the room', () => {
      (gateway.server.sockets.adapter.rooms as Map<string, Set<string>>).clear();

      gateway.pushToUser('nonexistent-user', notification);

      expect(gateway.server.to).not.toHaveBeenCalled();
    });
  });

  // ── subscribe / unsubscribe ─────────────────────────────────────────────────

  describe('subscribe event', () => {
    it('sets a type filter for an authenticated socket', async () => {
      jwtService.verify.mockReturnValue(mockJwt({ sub: 'user-sub' }) as any);
      const client = buildMockSocket('socket-sub');
      client.handshake.auth = { token: 'valid.jwt' };
      await gateway.handleConnection(client as any);

      gateway.handleSubscribe(client as any, { types: [NotificationType.DISPUTE_RAISED] });

      const filter = (gateway as any).typeFilters.get('socket-sub') as Set<NotificationType>;
      expect(filter).toBeDefined();
      expect(filter.has(NotificationType.DISPUTE_RAISED)).toBe(true);
    });

    it('clears the filter when types is empty', async () => {
      jwtService.verify.mockReturnValue(mockJwt({ sub: 'user-sub2' }) as any);
      const client = buildMockSocket('socket-sub2');
      client.handshake.auth = { token: 'valid.jwt' };
      await gateway.handleConnection(client as any);

      // First set a filter
      (gateway as any).typeFilters.set('socket-sub2', new Set([NotificationType.MILESTONE_CONFIRMED]));

      // Subscribe with empty list → clears filter
      gateway.handleSubscribe(client as any, { types: [] });

      expect((gateway as any).typeFilters.has('socket-sub2')).toBe(false);
    });
  });

  describe('unsubscribe event', () => {
    it('removes the type filter for the socket', async () => {
      jwtService.verify.mockReturnValue(mockJwt({ sub: 'user-unsub' }) as any);
      const client = buildMockSocket('socket-unsub');
      client.handshake.auth = { token: 'valid.jwt' };
      await gateway.handleConnection(client as any);

      (gateway as any).typeFilters.set('socket-unsub', new Set([NotificationType.PAYMENT_RELEASED]));

      gateway.handleUnsubscribe(client as any);

      expect((gateway as any).typeFilters.has('socket-unsub')).toBe(false);
    });
  });
});
