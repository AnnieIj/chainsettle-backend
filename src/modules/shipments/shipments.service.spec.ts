import { Test, TestingModule } from '@nestjs/testing';
import { ShipmentsService } from './shipments.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ShipmentStatus } from '@prisma/client';
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
};

describe('ShipmentsService', () => {
  let service: ShipmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShipmentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StellarService, useValue: mockStellar },
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

    it('throws ConflictException if shipment already exists', async () => {
      mockPrisma.shipment.findUnique.mockResolvedValue({ id: 'SHIP-001' });
      await expect(service.create(dto as any)).rejects.toThrow(ConflictException);
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
