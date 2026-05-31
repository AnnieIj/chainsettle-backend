import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogService } from './audit-log.service';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

const mockAuditLogService = {
  findAll: jest.fn(),
  findByResource: jest.fn(),
  findByActor: jest.fn(),
};

describe('AuditLogsController', () => {
  let controller: AuditLogsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditLogsController],
      providers: [
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    controller = module.get<AuditLogsController>(AuditLogsController);
    jest.clearAllMocks();
  });

  describe('findAll()', () => {
    it('allows ADMIN users to access audit logs', async () => {
      const adminUser = { id: 'admin-1', stellarAddress: 'GADMIN', role: UserRole.ADMIN };
      mockAuditLogService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 50 },
      });

      const result = await controller.findAll(adminUser);

      expect(result).toBeDefined();
      expect(mockAuditLogService.findAll).toHaveBeenCalled();
    });

    it('forbids non-ADMIN users from accessing audit logs', async () => {
      const buyerUser = {
        id: 'buyer-1',
        stellarAddress: 'GBUYER',
        role: UserRole.BUYER,
      };

      await expect(controller.findAll(buyerUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('filters audit logs by actorAddress', async () => {
      const adminUser = { id: 'admin-1', stellarAddress: 'GADMIN', role: UserRole.ADMIN };
      mockAuditLogService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 50 },
      });

      await controller.findAll(adminUser, 'GBUYER123', undefined, undefined, undefined, undefined, undefined, 1, 50);

      expect(mockAuditLogService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAddress: 'GBUYER123',
        }),
      );
    });

    it('filters audit logs by action', async () => {
      const adminUser = { id: 'admin-1', stellarAddress: 'GADMIN', role: UserRole.ADMIN };
      mockAuditLogService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 50 },
      });

      await controller.findAll(adminUser, undefined, 'shipment', undefined, undefined, undefined, undefined, 1, 50);

      expect(mockAuditLogService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'shipment',
        }),
      );
    });

    it('filters audit logs by resourceType and resourceId', async () => {
      const adminUser = { id: 'admin-1', stellarAddress: 'GADMIN', role: UserRole.ADMIN };
      mockAuditLogService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 50 },
      });

      await controller.findAll(
        adminUser,
        undefined,
        undefined,
        'Shipment',
        'SHIP-001',
        undefined,
        undefined,
        1,
        50,
      );

      expect(mockAuditLogService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'Shipment',
          resourceId: 'SHIP-001',
        }),
      );
    });

    it('parses date filters correctly', async () => {
      const adminUser = { id: 'admin-1', stellarAddress: 'GADMIN', role: UserRole.ADMIN };
      mockAuditLogService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 50 },
      });

      const startDateStr = '2026-05-01T00:00:00Z';
      const endDateStr = '2026-05-31T23:59:59Z';

      await controller.findAll(
        adminUser,
        undefined,
        undefined,
        undefined,
        undefined,
        startDateStr,
        endDateStr,
        1,
        50,
      );

      expect(mockAuditLogService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: new Date(startDateStr),
          endDate: new Date(endDateStr),
        }),
      );
    });

    it('passes pagination parameters correctly', async () => {
      const adminUser = { id: 'admin-1', stellarAddress: 'GADMIN', role: UserRole.ADMIN };
      mockAuditLogService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 2, limit: 100 },
      });

      await controller.findAll(adminUser, undefined, undefined, undefined, undefined, undefined, undefined, 2, 100);

      expect(mockAuditLogService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          limit: 100,
        }),
      );
    });

    it('forbids SUPPLIER role', async () => {
      const supplierUser = {
        id: 'supplier-1',
        stellarAddress: 'GSUPPLIER',
        role: UserRole.SUPPLIER,
      };

      await expect(controller.findAll(supplierUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('forbids LOGISTICS role', async () => {
      const logisticsUser = {
        id: 'logistics-1',
        stellarAddress: 'GLOGISTICS',
        role: UserRole.LOGISTICS,
      };

      await expect(controller.findAll(logisticsUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('forbids ARBITER role', async () => {
      const arbiterUser = {
        id: 'arbiter-1',
        stellarAddress: 'GARBITER',
        role: UserRole.ARBITER,
      };

      await expect(controller.findAll(arbiterUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('combines multiple filters', async () => {
      const adminUser = { id: 'admin-1', stellarAddress: 'GADMIN', role: UserRole.ADMIN };
      mockAuditLogService.findAll.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, limit: 50 },
      });

      const startDateStr = '2026-05-01T00:00:00Z';

      await controller.findAll(
        adminUser,
        'GBUYER123',
        'shipment.update',
        'Shipment',
        'SHIP-001',
        startDateStr,
        undefined,
        1,
        50,
      );

      expect(mockAuditLogService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          actorAddress: 'GBUYER123',
          action: 'shipment.update',
          resourceType: 'Shipment',
          resourceId: 'SHIP-001',
          startDate: new Date(startDateStr),
          endDate: undefined,
          page: 1,
          limit: 50,
        }),
      );
    });
  });

  describe('authorization checks', () => {
    it('only ADMIN role can call findAll', async () => {
      const roles = [
        UserRole.BUYER,
        UserRole.SUPPLIER,
        UserRole.LOGISTICS,
        UserRole.ARBITER,
      ];

      for (const role of roles) {
        const user = { id: 'user-1', stellarAddress: 'GUSER', role };
        await expect(controller.findAll(user)).rejects.toThrow(
          ForbiddenException,
        );
      }
    });
  });
});
