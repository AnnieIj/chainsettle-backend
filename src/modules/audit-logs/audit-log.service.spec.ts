import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from './audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const mockPrisma = {
  auditLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AuditLogService>(AuditLogService);
    jest.clearAllMocks();
  });

  describe('record()', () => {
    it('creates an audit log entry with all fields', async () => {
      const dto = {
        actorId: 'user-123',
        actorAddress: 'GBUYER123',
        action: 'shipment.create',
        resourceType: 'Shipment',
        resourceId: 'SHIP-001',
        metadata: { amount: '1000000000' },
        ipAddress: '192.168.1.1',
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: 'audit-1',
        ...dto,
        createdAt: new Date(),
      });

      await service.record(dto);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining(dto),
      });
    });

    it('records system actions with actorId = null', async () => {
      const dto = {
        actorId: null,
        actorAddress: 'SYSTEM',
        action: 'milestone.overdue_check',
        resourceType: 'Milestone',
        resourceId: 'milestone-1',
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: 'audit-2',
        ...dto,
        metadata: {},
        createdAt: new Date(),
      });

      await service.record(dto);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorId: null,
          actorAddress: 'SYSTEM',
        }),
      });
    });

    it('handles missing optional fields gracefully', async () => {
      const dto = {
        actorId: 'user-123',
        actorAddress: 'GBUYER123',
        action: 'shipment.update',
        resourceType: 'Shipment',
        resourceId: 'SHIP-001',
      };

      mockPrisma.auditLog.create.mockResolvedValue({
        id: 'audit-3',
        ...dto,
        metadata: {},
        ipAddress: null,
        createdAt: new Date(),
      });

      await service.record(dto);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          metadata: {},
          ipAddress: undefined,
        }),
      });
    });

    it('does not throw if create fails (audit logging failures are non-fatal)', async () => {
      const dto = {
        actorId: 'user-123',
        actorAddress: 'GBUYER123',
        action: 'shipment.delete',
        resourceType: 'Shipment',
        resourceId: 'SHIP-001',
      };

      mockPrisma.auditLog.create.mockRejectedValue(
        new Error('Database error'),
      );

      // Should not throw
      await expect(service.record(dto)).resolves.not.toThrow();
    });
  });

  describe('findAll()', () => {
    beforeEach(() => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);
    });

    it('retrieves audit logs with pagination', async () => {
      mockPrisma.$transaction.mockResolvedValue([
        [{ id: 'audit-1', action: 'shipment.create', actor: null }],
        1,
      ]);

      const result = await service.findAll({ page: 1, limit: 50 });

      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(50);
    });

    it('filters by actorAddress', async () => {
      await service.findAll({ actorAddress: 'GBUYER123' });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            actorAddress: 'GBUYER123',
          }),
        }),
      );
    });

    it('filters by action with case-insensitive substring match', async () => {
      await service.findAll({ action: 'shipment' });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            action: expect.objectContaining({
              contains: 'shipment',
              mode: 'insensitive',
            }),
          }),
        }),
      );
    });

    it('filters by resourceType and resourceId', async () => {
      await service.findAll({
        resourceType: 'Shipment',
        resourceId: 'SHIP-001',
      });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resourceType: 'Shipment',
            resourceId: 'SHIP-001',
          }),
        }),
      );
    });

    it('filters by date range', async () => {
      const startDate = new Date('2026-05-01');
      const endDate = new Date('2026-05-31');

      await service.findAll({ startDate, endDate });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: {
              gte: startDate,
              lte: endDate,
            },
          }),
        }),
      );
    });

    it('combines multiple filters', async () => {
      const startDate = new Date('2026-05-01');

      await service.findAll({
        actorAddress: 'GBUYER123',
        action: 'shipment',
        resourceType: 'Shipment',
        startDate,
        page: 2,
        limit: 100,
      });

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            actorAddress: 'GBUYER123',
            action: expect.any(Object),
            resourceType: 'Shipment',
            createdAt: expect.objectContaining({
              gte: startDate,
            }),
          }),
          skip: 100,
          take: 100,
        }),
      );
    });

    it('orders results by createdAt descending', async () => {
      await service.findAll({});

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('calculates totalPages correctly', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 150]);

      const result = await service.findAll({ limit: 50 });

      expect(result.meta.totalPages).toBe(3);
    });
  });

  describe('findByResource()', () => {
    it('retrieves audit logs for a specific resource', async () => {
      const logs = [
        { id: 'audit-1', action: 'shipment.create' },
        { id: 'audit-2', action: 'shipment.update' },
      ];
      mockPrisma.auditLog.findMany.mockResolvedValue(logs);

      const result = await service.findByResource('Shipment', 'SHIP-001');

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            resourceType: 'Shipment',
            resourceId: 'SHIP-001',
          },
        }),
      );

      expect(result).toHaveLength(2);
    });

    it('orders resource logs by createdAt descending', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      await service.findByResource('Milestone', 'milestone-1');

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  describe('findByActor()', () => {
    it('retrieves audit logs for a specific actor', async () => {
      const logs = [
        { id: 'audit-1', action: 'shipment.create' },
        { id: 'audit-2', action: 'shipment.update' },
      ];
      mockPrisma.auditLog.findMany.mockResolvedValue(logs);

      const result = await service.findByActor('GBUYER123');

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { actorAddress: 'GBUYER123' },
        }),
      );

      expect(result).toHaveLength(2);
    });

    it('limits results to 100 by default', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      await service.findByActor('GBUYER123');

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        }),
      );
    });

    it('allows custom limit', async () => {
      mockPrisma.auditLog.findMany.mockResolvedValue([]);

      await service.findByActor('GBUYER123', 200);

      expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 200,
        }),
      );
    });
  });
});
