import { Test, TestingModule } from '@nestjs/testing';
import { ShipmentsService } from './shipments.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { TokenRegistryService } from '../../common/token-registry/token-registry.service';
import { ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ShipmentStatus, ArbiterStatus, NotificationType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { nativeToScVal } from '@stellar/stellar-sdk';

const mockPrisma = {
  shipment: {
    findUnique: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockStellar = {
  simulateContractCall: jest.fn(),
  stroopsToUsdc: jest.fn().mockReturnValue('100.0000000'),
  toHumanAmount: jest.fn().mockReturnValue('100.0000000'),
};

const mockTokenRegistry = {
  getToken: jest.fn().mockReturnValue({ symbol: 'USDC', decimals: 7 }),
};

const mockNotifications = {
  notifyUser: jest.fn().mockResolvedValue(undefined),
};

describe('ShipmentsService', () => {
  let service: ShipmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StellarService, useValue: mockStellar },
        { provide: TokenRegistryService, useValue: mockTokenRegistry },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<ShipmentsService>(ShipmentsService);
    jest.clearAllMocks();
  });

  describe('create()', () => {
    const dto = {
      shipmentId: 'SHIP-001',
      buyerAddress: 'GABC',
      supplierAddress: 'GDEF',
      logisticsAddress: 'GHIJ',
      arbiterAddress: 'GKLM',
      tokenAddress: 'CNOP',
      totalAmount: '1000000000',
      milestones: [
        { name: 'Dispatch', paymentPercent: 25 },
        { name: 'Transit', paymentPercent: 50 },
        { name: 'Delivered', paymentPercent: 25 },
      ],
    };

    it('creates a shipment successfully', async () => {
      mockPrisma.shipment.findUnique.mockResolvedValue(null);
      mockPrisma.shipment.create.mockResolvedValue({
        ...dto,
        id: dto.shipmentId,
        totalAmount: BigInt(dto.totalAmount),
        releasedAmount: BigInt(0),
        status: 'ACTIVE',
        milestones: dto.milestones.map((m, i) => ({
          ...m,
          id: `m-${i}`,
          milestoneIndex: i,
          paymentReleased: null,
        })),
      });

      const result = await service.create(dto as any);
      expect(result.id).toBe('SHIP-001');
      expect(result.totalAmount).toBe('1000000000');
      expect(mockPrisma.shipment.create).toHaveBeenCalledTimes(1);
    });

    it('creates a shipment with optional fields (description, referenceNumber, metadata, tags)', async () => {
      const dtoWithOptional = {
        ...dto,
        description: 'Electronics shipment from China',
        referenceNumber: 'PO-2026-001',
        metadata: { incoterms: 'FOB', port: 'Lagos' },
        tags: ['urgent', 'fragile'],
      };

      mockPrisma.shipment.findUnique.mockResolvedValue(null);
      mockPrisma.shipment.create.mockResolvedValue({
        ...dtoWithOptional,
        id: dto.shipmentId,
        totalAmount: BigInt(dto.totalAmount),
        releasedAmount: BigInt(0),
        status: 'ACTIVE',
        milestones: dto.milestones.map((m, i) => ({
          ...m,
          id: `m-${i}`,
          milestoneIndex: i,
          paymentReleased: null,
        })),
      });

      const result = await service.create(dtoWithOptional as any);
      expect(result.id).toBe('SHIP-001');
      expect(mockPrisma.shipment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: 'Electronics shipment from China',
            referenceNumber: 'PO-2026-001',
            metadata: { incoterms: 'FOB', port: 'Lagos' },
            tags: ['urgent', 'fragile'],
          }),
        }),
      );
    });

    it('throws ConflictException if shipment already exists', async () => {
      mockPrisma.shipment.findUnique.mockResolvedValue({ id: 'SHIP-001' });
      await expect(service.create(dto as any)).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException if referenceNumber already exists', async () => {
      const dtoWithRef = { ...dto, referenceNumber: 'PO-2026-001' };
      mockPrisma.shipment.findUnique
        .mockResolvedValueOnce(null) // shipmentId check
        .mockResolvedValueOnce({ id: 'SHIP-002', referenceNumber: 'PO-2026-001' }); // referenceNumber check

      await expect(service.create(dtoWithRef as any)).rejects.toThrow(ConflictException);
      expect(mockPrisma.shipment.findUnique).toHaveBeenCalledWith({
        where: { referenceNumber: 'PO-2026-001' },
      });
    });
  });

  describe('findAll()', () => {
    beforeEach(() => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);
    });

    it('filters by referenceNumber', async () => {
      mockPrisma.$transaction.mockResolvedValue([
        [{ id: 'SHIP-001', referenceNumber: 'PO-2026-001' }],
        1,
      ]);

      await service.findAll({ referenceNumber: 'PO-2026-001' });

      expect(mockPrisma.shipment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ referenceNumber: 'PO-2026-001' }),
        }),
      );
    });

    it('filters by tags using hasSome', async () => {
      mockPrisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll({ tags: ['urgent', 'fragile'] });

      expect(mockPrisma.shipment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tags: { hasSome: ['urgent', 'fragile'] },
          }),
        }),
      );
    });

    it('combines multiple filters', async () => {
      await service.findAll({
        buyerAddress: 'GABC',
        referenceNumber: 'PO-2026-001',
        tags: ['urgent'],
      });

      expect(mockPrisma.shipment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            buyerAddress: 'GABC',
            referenceNumber: 'PO-2026-001',
            tags: { hasSome: ['urgent'] },
          }),
        }),
      );
    });
  });

  describe('findOne()', () => {
    it('returns shipment when found', async () => {
      const mockShipment = {
        id: 'SHIP-001',
        totalAmount: BigInt(1000000000),
        releasedAmount: BigInt(0),
        milestones: [],
        events: [],
      };
      mockPrisma.shipment.findUnique.mockResolvedValue(mockShipment);

      const result = await service.findOne('SHIP-001');
      expect(result.id).toBe('SHIP-001');
    });

    it('throws NotFoundException when shipment not found', async () => {
      mockPrisma.shipment.findUnique.mockResolvedValue(null);
      await expect(service.findOne('SHIP-MISSING')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update()', () => {
    const mockShipment = {
      id: 'SHIP-001',
      buyerAddress: 'GABC',
      supplierAddress: 'GDEF',
      logisticsAddress: 'GHIJ',
      arbiterAddress: 'GKLM',
      totalAmount: BigInt(1000000000),
      releasedAmount: BigInt(0),
      description: null,
      referenceNumber: null,
      metadata: null,
      tags: [],
    };

    it('updates shipment metadata successfully', async () => {
      const updateDto = {
        description: 'Updated description',
        tags: ['high-priority'],
      };

      mockPrisma.shipment.findUnique.mockResolvedValue(mockShipment);
      mockPrisma.shipment.update.mockResolvedValue({
        ...mockShipment,
        ...updateDto,
        milestones: [],
        events: [],
      });

      const result = await service.update('SHIP-001', 'GABC', updateDto);

      expect(mockPrisma.shipment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'SHIP-001' },
          data: expect.objectContaining(updateDto),
        }),
      );
    });

    it('allows updating referenceNumber', async () => {
      // First call: find shipment by id; second call: check for duplicate ref (none found)
      mockPrisma.shipment.findUnique
        .mockResolvedValueOnce(mockShipment)
        .mockResolvedValueOnce(null);
      mockPrisma.shipment.update.mockResolvedValue({
        ...mockShipment,
        referenceNumber: 'PO-2026-001',
        milestones: [],
        events: [],
      });

      await service.update('SHIP-001', 'GABC', {
        referenceNumber: 'PO-2026-001',
      });

      expect(mockPrisma.shipment.update).toHaveBeenCalled();
    });

    it('throws ForbiddenException if user is not the buyer', async () => {
      mockPrisma.shipment.findUnique.mockResolvedValue(mockShipment);

      await expect(
        service.update('SHIP-001', 'GNOTBUYER', { description: 'test' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if shipment does not exist', async () => {
      mockPrisma.shipment.findUnique.mockResolvedValue(null);

      await expect(
        service.update('SHIP-MISSING', 'GABC', { description: 'test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if referenceNumber already exists', async () => {
      mockPrisma.shipment.findUnique
        .mockResolvedValueOnce(mockShipment) // finding the shipment to update
        .mockResolvedValueOnce({ id: 'SHIP-002', referenceNumber: 'PO-2026-001' }); // checking for duplicate

      await expect(
        service.update('SHIP-001', 'GABC', { referenceNumber: 'PO-2026-001' }),
      ).rejects.toThrow(ConflictException);
    });

    it('ignores financial and address fields in update', async () => {
      mockPrisma.shipment.findUnique.mockResolvedValue(mockShipment);
      mockPrisma.shipment.update.mockResolvedValue({
        ...mockShipment,
        milestones: [],
        events: [],
      });

      const updateDto = {
        description: 'New description',
        totalAmount: '9999999999', // Should be ignored
        buyerAddress: 'GNOTBUYER', // Should be ignored
        supplierAddress: 'GNOTSUPPLIER', // Should be ignored
      };

      await service.update('SHIP-001', 'GABC', updateDto);

      // Verify that financial/address fields were NOT included in update
      expect(mockPrisma.shipment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'SHIP-001' },
          data: expect.not.objectContaining({
            totalAmount: expect.anything(),
            buyerAddress: expect.anything(),
            supplierAddress: expect.anything(),
          }),
        }),
      );
    });
  });

  describe('syncStatusFromChain()', () => {
    const shipmentId = 'SHIP-001';

    it('successfully syncs shipment status and released amount from chain', async () => {
      const onChainData = {
        status: 'Active',
        released_amount: '5000000',
      };

      mockStellar.simulateContractCall.mockResolvedValue(onChainData);
      mockPrisma.shipment.update.mockResolvedValue({
        id: shipmentId,
        status: ShipmentStatus.ACTIVE,
        releasedAmount: BigInt(5000000),
      });

      await service.syncStatusFromChain(shipmentId);

      // Verify simulateContractCall was called with correct arguments
      expect(mockStellar.simulateContractCall).toHaveBeenCalledWith(
        'get_shipment',
        [nativeToScVal(shipmentId, { type: 'string' })]
      );

      // Verify database update was called with correct data
      expect(mockPrisma.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: {
          status: ShipmentStatus.ACTIVE,
          releasedAmount: BigInt(5000000),
        },
      });
    });

    it('syncs Completed status correctly', async () => {
      const onChainData = {
        status: 'Completed',
        released_amount: '10000000',
      };

      mockStellar.simulateContractCall.mockResolvedValue(onChainData);
      mockPrisma.shipment.update.mockResolvedValue({});

      await service.syncStatusFromChain(shipmentId);

      expect(mockPrisma.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: {
          status: ShipmentStatus.COMPLETED,
          releasedAmount: BigInt(10000000),
        },
      });
    });

    it('syncs Cancelled status correctly', async () => {
      const onChainData = {
        status: 'Cancelled',
        released_amount: '2500000',
      };

      mockStellar.simulateContractCall.mockResolvedValue(onChainData);
      mockPrisma.shipment.update.mockResolvedValue({});

      await service.syncStatusFromChain(shipmentId);

      expect(mockPrisma.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: {
          status: ShipmentStatus.CANCELLED,
          releasedAmount: BigInt(2500000),
        },
      });
    });

    it('logs warning and returns when shipment not found on-chain (null response)', async () => {
      mockStellar.simulateContractCall.mockResolvedValue(null);

      await service.syncStatusFromChain(shipmentId);

      // Should not attempt to update database
      expect(mockPrisma.shipment.update).not.toHaveBeenCalled();
    });

    it('logs warning and returns when on-chain status is unknown', async () => {
      const onChainData = {
        status: 'UnknownStatus',
        released_amount: '1000000',
      };

      mockStellar.simulateContractCall.mockResolvedValue(onChainData);

      await service.syncStatusFromChain(shipmentId);

      // Should not attempt to update database
      expect(mockPrisma.shipment.update).not.toHaveBeenCalled();
    });

    it('handles zero released amount correctly', async () => {
      const onChainData = {
        status: 'Active',
        released_amount: '0',
      };

      mockStellar.simulateContractCall.mockResolvedValue(onChainData);
      mockPrisma.shipment.update.mockResolvedValue({});

      await service.syncStatusFromChain(shipmentId);

      expect(mockPrisma.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: {
          status: ShipmentStatus.ACTIVE,
          releasedAmount: BigInt(0),
        },
      });
    });

    it('handles missing released_amount field', async () => {
      const onChainData = {
        status: 'Active',
      };

      mockStellar.simulateContractCall.mockResolvedValue(onChainData);
      mockPrisma.shipment.update.mockResolvedValue({});

      await service.syncStatusFromChain(shipmentId);

      expect(mockPrisma.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: {
          status: ShipmentStatus.ACTIVE,
          releasedAmount: BigInt(0),
        },
      });
    });

    it('handles database not found error (P2025) gracefully', async () => {
      const onChainData = {
        status: 'Active',
        released_amount: '1000000',
      };

      mockStellar.simulateContractCall.mockResolvedValue(onChainData);
      mockPrisma.shipment.update.mockRejectedValue({
        code: 'P2025',
        message: 'Record not found',
      });

      // Should not throw
      await expect(service.syncStatusFromChain(shipmentId)).resolves.not.toThrow();
    });

    it('handles contract call errors gracefully without throwing', async () => {
      mockStellar.simulateContractCall.mockRejectedValue(
        new Error('Contract simulation failed')
      );

      // Should not throw - errors are logged but not propagated
      await expect(service.syncStatusFromChain(shipmentId)).resolves.not.toThrow();
      
      // Should not attempt to update database
      expect(mockPrisma.shipment.update).not.toHaveBeenCalled();
    });

    it('handles database update errors gracefully without throwing', async () => {
      const onChainData = {
        status: 'Active',
        released_amount: '1000000',
      };

      mockStellar.simulateContractCall.mockResolvedValue(onChainData);
      mockPrisma.shipment.update.mockRejectedValue(
        new Error('Database connection failed')
      );

      // Should not throw - errors are logged but not propagated
      await expect(service.syncStatusFromChain(shipmentId)).resolves.not.toThrow();
    });

    it('handles BigInt conversion for large amounts', async () => {
      const onChainData = {
        status: 'Completed',
        released_amount: '999999999999999',
      };

      mockStellar.simulateContractCall.mockResolvedValue(onChainData);
      mockPrisma.shipment.update.mockResolvedValue({});

      await service.syncStatusFromChain(shipmentId);

      expect(mockPrisma.shipment.update).toHaveBeenCalledWith({
        where: { id: shipmentId },
        data: {
          status: ShipmentStatus.COMPLETED,
          releasedAmount: BigInt('999999999999999'),
        },
      });
    });
  });
});
