import {
  Injectable,
  NotFoundException,
  Logger,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ShipmentStatus } from '@prisma/client';

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
  ) {}

  // ----------------------------------------------------------
  // CREATE — persist after tx is confirmed on-chain
  // ----------------------------------------------------------

  /**
   * Saves a shipment record in the database after the buyer has
   * submitted the create_shipment transaction via the frontend.
   * The frontend sends the confirmed txHash back here.
   */
  async create(dto: CreateShipmentDto) {
    const existing = await this.prisma.shipment.findUnique({
      where: { id: dto.shipmentId },
    });
    if (existing) {
      throw new ConflictException(`Shipment ${dto.shipmentId} already exists`);
    }

    const shipment = await this.prisma.shipment.create({
      data: {
        id: dto.shipmentId,
        buyerAddress: dto.buyerAddress,
        supplierAddress: dto.supplierAddress,
        logisticsAddress: dto.logisticsAddress,
        arbiterAddress: dto.arbiterAddress,
        tokenAddress: dto.tokenAddress,
        totalAmount: BigInt(dto.totalAmount),
        txHash: dto.txHash,
        milestones: {
          create: dto.milestones.map((m, index) => ({
            milestoneIndex: index,
            name: m.name,
            paymentPercent: m.paymentPercent,
          })),
        },
      },
      include: { milestones: true },
    });

    this.logger.log(`Shipment created: ${shipment.id}`);
    return this.serialize(shipment);
  }

  // ----------------------------------------------------------
  // READ
  // ----------------------------------------------------------

  async findAll(filters: {
    buyerAddress?: string;
    supplierAddress?: string;
    status?: ShipmentStatus;
    page?: number;
    limit?: number;
  }) {
    const { buyerAddress, supplierAddress, status, page = 1, limit = 20 } = filters;

    const where: any = {};
    if (buyerAddress) where.buyerAddress = buyerAddress;
    if (supplierAddress) where.supplierAddress = supplierAddress;
    if (status) where.status = status;

    const [shipments, total] = await this.prisma.$transaction([
      this.prisma.shipment.findMany({
        where,
        include: { milestones: { orderBy: { milestoneIndex: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.shipment.count({ where }),
    ]);

    return {
      data: shipments.map(this.serialize),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        milestones: { orderBy: { milestoneIndex: 'asc' } },
        events: { orderBy: { ledger: 'desc' }, take: 20 },
      },
    });
    if (!shipment) throw new NotFoundException(`Shipment ${id} not found`);
    return this.serialize(shipment);
  }

  // ----------------------------------------------------------
  // SYNC FROM CHAIN — called by EventsService after polling
  // ----------------------------------------------------------

  async syncStatusFromChain(shipmentId: string) {
    try {
      const onChain = await this.stellar.simulateContractCall('get_shipment', [
        // TODO: convert shipmentId to ScVal String
        // nativeToScVal(shipmentId, { type: 'string' })
      ]);

      if (!onChain) return;

      // Map on-chain status to Prisma enum
      const statusMap: Record<string, ShipmentStatus> = {
        Active: ShipmentStatus.ACTIVE,
        Completed: ShipmentStatus.COMPLETED,
        Cancelled: ShipmentStatus.CANCELLED,
      };

      await this.prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          status: statusMap[onChain.status] ?? ShipmentStatus.ACTIVE,
          releasedAmount: BigInt(onChain.released_amount ?? 0),
        },
      });

      this.logger.log(`Synced shipment ${shipmentId} from chain`);
    } catch (error) {
      this.logger.error(`Failed to sync shipment ${shipmentId}`, error.message);
    }
  }

  // ----------------------------------------------------------
  // INTERNAL HELPERS
  // ----------------------------------------------------------

  private serialize(shipment: any) {
    return {
      ...shipment,
      totalAmount: shipment.totalAmount?.toString(),
      releasedAmount: shipment.releasedAmount?.toString(),
      milestones: shipment.milestones?.map((m: any) => ({
        ...m,
        paymentReleased: m.paymentReleased?.toString() ?? null,
      })),
    };
  }
}
