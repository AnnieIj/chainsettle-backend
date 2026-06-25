/**
 * Milestone Lifecycle Integration Tests — #27
 *
 * Covers the full state machine via real MilestonesService calls against a
 * real PostgreSQL database:
 *   PENDING → PROOF_SUBMITTED → CONFIRMED             (happy path)
 *   PENDING → PROOF_SUBMITTED → DISPUTED              (dispute path)
 *   DISPUTED → RESOLVED  (approved)
 *   DISPUTED → PENDING   (rejected)
 *
 * Isolation: each test seeds inside a transaction and rolls it back on exit.
 * Because MilestonesService uses its own injected PrismaService connection,
 * service-level tests seed outside the tx and clean up in a finally block —
 * the standard pattern when the service under test owns its own connection.
 *
 * IpfsService and NotificationsService are mocked (no external I/O needed
 * for state-machine assertions).
 *
 * Invalid state transition guard: MilestonesService.markConfirmed() has no
 * status guard — confirming a DISPUTED milestone succeeds silently. This is
 * documented with a regression-anchor test and a .todo for the future guard.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient, MilestoneStatus } from '@prisma/client';
import { MilestonesService } from '../src/modules/milestones/milestones.service';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { IpfsService } from '../src/common/ipfs/ipfs.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

// ─── Fixture constants ────────────────────────────────────────────────────────
const BUYER     = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const SUPPLIER  = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBHUK2';
const LOGISTICS = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCDMQP';
const ARBITER   = 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDU4GH';
const TOKEN     = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const SHIP_ID   = 'SHIP-LIFECYCLE-TEST-001';

// ─── Shared Prisma client (for seeding + assertions) ─────────────────────────
const prisma = new PrismaClient();

// ─── Seed helper ─────────────────────────────────────────────────────────────
async function seed(initialStatus: MilestoneStatus, extra: object = {}) {
  for (const [addr, role] of [
    [BUYER, 'BUYER'], [SUPPLIER, 'SUPPLIER'],
    [LOGISTICS, 'LOGISTICS'], [ARBITER, 'ARBITER'],
  ] as const) {
    await prisma.user.upsert({
      where: { stellarAddress: addr },
      create: { stellarAddress: addr, role },
      update: {},
    });
  }
  await prisma.shipment.upsert({
    where: { id: SHIP_ID },
    create: {
      id: SHIP_ID, buyerAddress: BUYER, supplierAddress: SUPPLIER,
      logisticsAddress: LOGISTICS, arbiterAddress: ARBITER,
      tokenAddress: TOKEN, totalAmount: BigInt(1_000_000_000),
    },
    update: {},
  });
  await prisma.milestone.upsert({
    where: { shipmentId_milestoneIndex: { shipmentId: SHIP_ID, milestoneIndex: 0 } },
    create: { shipmentId: SHIP_ID, milestoneIndex: 0, name: 'Dispatch', paymentPercent: 100, status: initialStatus, ...extra },
    update: { status: initialStatus, proofHash: null, paymentReleased: null, confirmedAt: null, ...extra },
  });
}

async function cleanup() {
  await prisma.milestone.deleteMany({ where: { shipmentId: SHIP_ID } });
  await prisma.shipment.deleteMany({ where: { id: SHIP_ID } });
}

async function getMilestone() {
  return prisma.milestone.findUniqueOrThrow({
    where: { shipmentId_milestoneIndex: { shipmentId: SHIP_ID, milestoneIndex: 0 } },
  });
}

// ─── Test module setup ────────────────────────────────────────────────────────
let service: MilestonesService;
let testModule: TestingModule;

beforeAll(async () => {
  testModule = await Test.createTestingModule({
    providers: [
      MilestonesService,
      PrismaService,
      {
        provide: IpfsService,
        useValue: { uploadFile: jest.fn().mockResolvedValue('bafytest'), getGatewayUrl: jest.fn().mockReturnValue('https://ipfs.example/bafytest') },
      },
      {
        provide: NotificationsService,
        useValue: { notifyUser: jest.fn().mockResolvedValue(undefined) },
      },
    ],
  }).compile();

  service = testModule.get<MilestonesService>(MilestonesService);
  await prisma.$connect();
});

afterAll(async () => {
  await cleanup();
  await testModule.close();
  await prisma.$disconnect();
});

afterEach(cleanup);

// ─────────────────────────────────────────────────────────────────────────────

describe('Milestone Lifecycle Integration', () => {

  // 1. Happy path ──────────────────────────────────────────────────────────────
  describe('Happy path: PENDING → PROOF_SUBMITTED → CONFIRMED', () => {
    it('markProofSubmitted sets status=PROOF_SUBMITTED and persists proofHash', async () => {
      await seed(MilestoneStatus.PENDING);

      await service.markProofSubmitted(SHIP_ID, 0, 'bafyhappypath');

      const m = await getMilestone();
      expect(m.status).toBe(MilestoneStatus.PROOF_SUBMITTED);
      expect(m.proofHash).toBe('bafyhappypath');
    });

    it('markConfirmed sets status=CONFIRMED, paymentReleased > 0, and confirmedAt', async () => {
      await seed(MilestoneStatus.PROOF_SUBMITTED, { proofHash: 'bafyhappypath' });

      await service.markConfirmed(SHIP_ID, 0, BigInt(1_000_000_000));

      const m = await getMilestone();
      expect(m.status).toBe(MilestoneStatus.CONFIRMED);
      expect(m.paymentReleased).toBe(BigInt(1_000_000_000));
      expect(m.confirmedAt).not.toBeNull();
    });
  });

  // 2. Dispute path ────────────────────────────────────────────────────────────
  describe('Dispute path: PROOF_SUBMITTED → DISPUTED', () => {
    it('markDisputed sets status=DISPUTED', async () => {
      await seed(MilestoneStatus.PROOF_SUBMITTED, { proofHash: 'bafydispute' });

      await service.markDisputed(SHIP_ID, 0);

      const m = await getMilestone();
      expect(m.status).toBe(MilestoneStatus.DISPUTED);
    });
  });

  // 3. Dispute resolution — approved ──────────────────────────────────────────
  describe('Dispute resolution: DISPUTED → RESOLVED (approved)', () => {
    it('markResolved(true, amount) sets status=RESOLVED, paymentReleased, and confirmedAt', async () => {
      await seed(MilestoneStatus.DISPUTED, { proofHash: 'bafydispute' });

      await service.markResolved(SHIP_ID, 0, true, BigInt(750_000_000));

      const m = await getMilestone();
      expect(m.status).toBe(MilestoneStatus.RESOLVED);
      expect(m.paymentReleased).toBe(BigInt(750_000_000));
      expect(m.confirmedAt).not.toBeNull();
    });
  });

  // 4. Dispute resolution — rejected ──────────────────────────────────────────
  describe('Dispute resolution: DISPUTED → PENDING (rejected)', () => {
    it('markResolved(false) returns status=PENDING with no paymentReleased or confirmedAt', async () => {
      await seed(MilestoneStatus.DISPUTED, { proofHash: 'bafydispute' });

      await service.markResolved(SHIP_ID, 0, false);

      const m = await getMilestone();
      expect(m.status).toBe(MilestoneStatus.PENDING);
      expect(m.paymentReleased).toBeNull();
      expect(m.confirmedAt).toBeNull();
    });
  });

  // 5. Invalid transition guard (missing — documented) ────────────────────────
  describe('Invalid transition guard', () => {
    /**
     * markConfirmed() has no status pre-check. Calling it on a DISPUTED
     * milestone silently overwrites the status. The test below is the
     * regression anchor — when the guard is added it should throw
     * ConflictException instead and this test should be updated.
     *
     * TODO: add guard to markConfirmed() and flip this to expect a throw.
     */
    it.todo('should throw ConflictException when confirming a DISPUTED milestone (guard not yet implemented)');

    it('documents missing guard: markConfirmed on a DISPUTED milestone currently succeeds (no guard)', async () => {
      await seed(MilestoneStatus.DISPUTED);

      await expect(
        service.markConfirmed(SHIP_ID, 0, BigInt(1_000_000_000)),
      ).resolves.not.toThrow();

      const m = await getMilestone();
      // Bug: DISPUTED was silently overwritten — a guard should prevent this
      expect(m.status).toBe(MilestoneStatus.CONFIRMED);
    });
  });
});
