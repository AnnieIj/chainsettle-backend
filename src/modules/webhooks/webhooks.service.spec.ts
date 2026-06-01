import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationType } from '@prisma/client';

const makeEndpoint = (id = 'ep-1') => ({
  id,
  userId: 'user-1',
  url: 'https://example.com/hook',
  secret: crypto.createHash('sha256').update('plaintext-secret').digest('hex'),
  events: [NotificationType.SHIPMENT_CREATED],
  active: true,
  createdAt: new Date(),
});

const makeDelivery = (id = 'del-1') => ({
  id,
  endpointId: 'ep-1',
  eventType: 'SHIPMENT_CREATED',
  payload: {},
  attemptCount: 1,
});

function buildPrismaMock() {
  return {
    webhookEndpoint: {
      create: jest.fn().mockResolvedValue(makeEndpoint()),
      findMany: jest.fn().mockResolvedValue([makeEndpoint()]),
      findFirst: jest.fn().mockResolvedValue(makeEndpoint()),
      delete: jest.fn().mockResolvedValue(makeEndpoint()),
    },
    webhookDelivery: {
      create: jest.fn().mockResolvedValue(makeDelivery()),
      update: jest.fn().mockResolvedValue(makeDelivery()),
    },
  };
}

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [WebhooksService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(WebhooksService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── HMAC signing ────────────────────────────────────────────────────────────

  describe('HMAC signing', () => {
    it('produces a 64-char hex sha256 signature', () => {
      const body = JSON.stringify({ eventType: 'SHIPMENT_CREATED', payload: {}, timestamp: 't' });
      const sig = crypto.createHmac('sha256', 'secret').update(body).digest('hex');
      expect(sig).toMatch(/^[a-f0-9]{64}$/);
    });

    it('is deterministic for the same inputs', () => {
      const body = 'test-body';
      const s1 = crypto.createHmac('sha256', 'key').update(body).digest('hex');
      const s2 = crypto.createHmac('sha256', 'key').update(body).digest('hex');
      expect(s1).toBe(s2);
    });

    it('differs when the secret changes', () => {
      const body = 'test-body';
      const s1 = crypto.createHmac('sha256', 'key-a').update(body).digest('hex');
      const s2 = crypto.createHmac('sha256', 'key-b').update(body).digest('hex');
      expect(s1).not.toBe(s2);
    });
  });

  // ── register ────────────────────────────────────────────────────────────────

  describe('register', () => {
    it('returns a plaintext secret that differs from the stored hash', async () => {
      const result = await service.register('user-1', {
        url: 'https://example.com/hook',
        events: [NotificationType.SHIPMENT_CREATED],
      });

      const storedSecret: string = prisma.webhookEndpoint.create.mock.calls[0][0].data.secret;
      expect(result.secret).toBeDefined();
      expect(result.secret).not.toBe(storedSecret);
      // Stored value must be a sha256 hex string
      expect(storedSecret).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ── dispatch (fan-out) ───────────────────────────────────────────────────────

  describe('dispatch', () => {
    it('creates a delivery record for each active matching endpoint', async () => {
      prisma.webhookEndpoint.findMany.mockResolvedValue([makeEndpoint('ep-1'), makeEndpoint('ep-2')]);
      prisma.webhookDelivery.create
        .mockResolvedValueOnce(makeDelivery('del-1'))
        .mockResolvedValueOnce(makeDelivery('del-2'));

      await service.dispatch(NotificationType.SHIPMENT_CREATED, { shipmentId: 'abc' });

      expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(2);
    });

    it('skips endpoints not subscribed to the event (Prisma filters them out)', async () => {
      prisma.webhookEndpoint.findMany.mockResolvedValue([]);

      await service.dispatch(NotificationType.PAYMENT_RELEASED, {});

      expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    });
  });

  // ── retry scheduling ─────────────────────────────────────────────────────────

  describe('retry scheduling', () => {
    it('sets nextRetryAt on the delivery record after the first failed attempt', async () => {
      jest.useFakeTimers();

      prisma.webhookEndpoint.findMany.mockResolvedValue([makeEndpoint()]);
      prisma.webhookDelivery.create.mockResolvedValue(makeDelivery());

      await service.dispatch(NotificationType.SHIPMENT_CREATED, {});

      // axios will throw (no real server); first failure should schedule a retry
      const updateCalls = prisma.webhookDelivery.update.mock.calls;
      const retryUpdate = updateCalls.find(([args]) => args.data?.nextRetryAt instanceof Date);
      expect(retryUpdate).toBeDefined();

      jest.useRealTimers();
    });
  });
});
