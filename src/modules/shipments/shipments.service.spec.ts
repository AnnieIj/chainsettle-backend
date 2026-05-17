import { Test, TestingModule } from '@nestjs/testing';
import { ShipmentsService } from './shipments.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { ConflictException, NotFoundException } from '@nestjs/common';

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
});
