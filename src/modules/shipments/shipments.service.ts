import {
  Injectable,
  NotFoundException,
  Logger,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { TokenRegistryService } from '../../common/token-registry/token-registry.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { ShipmentStatus, NotificationType, ArbiterStatus } from '@prisma/client';
import { nativeToScVal } from '@stellar/stellar-sdk';

@Injectable()
export class ShipmentsService {
  private readonly logger = new Logger(ShipmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly tokenRegistry: TokenRegistryService,
    private readonly notifications: NotificationsService,
  ) {}

  // ----------------------------------------------------------
  // CREATE — persist after tx is confirmed on-chain
  // ----------------------------------------------------------

  /**
   * Saves a shipment record in the database after the buyer has
   * submitted the create_shipment transaction via the frontend.
   * The frontend sends the confirmed txHash back here.
   * * If templateId is provided, pre-populate fields from the template.
   * Explicit fields in the request override template values.
   */
  async create(dto: CreateShipmentDto) {
    const existing = await this.prisma.shipment.findUnique({
      where: { id: dto.shipmentId },
    });
    if (existing) {
      throw new ConflictException(`Shipment ${dto.shipmentId} already exists`);
    }

    // Check for duplicate referenceNumber if provided
    if (dto.referenceNumber) {
      const withRef = await this.prisma.shipment.findUnique({
        where: { referenceNumber: dto.referenceNumber },
      });
      if (withRef) {
        throw new ConflictException(`Shipment with referenceNumber "${dto.referenceNumber}" already exists`);
      }
    }

    // Pre-populate from template if provided
    let templateData: any = {};
    if (dto.templateId) {
      const template = await this.prisma.shipmentTemplate.findUnique({
        where: { id: dto.templateId },
      });
      if (!template) {
        throw new NotFoundException(`Template ${dto.templateId} not found`);
      }
      templateData = {
        supplierAddress: template.supplierAddress,
        logisticsAddress: template.logisticsAddress,
        arbiterAddress: template.arbiterAddress,
        tokenAddress: template.tokenAddress,
        milestones: template.milestoneTemplates,
      };
    }

    // Merge template data with explicit request values (request overrides template)
    const supplierAddress = dto.supplierAddress ?? templateData.supplierAddress;
    const logisticsAddress = dto.logisticsAddress ?? templateData.logisticsAddress;
    const arbiterAddress = dto.arbiterAddress ?? templateData.arbiterAddress;
    const tokenAddress = dto.tokenAddress ?? templateData.tokenAddress;
    const milestones = dto.milestones ?? templateData.milestones;

    // Validate required fields
    if (!supplierAddress || !logisticsAddress || !arbiterAddress || !tokenAddress || !milestones) {
      throw new ConflictException(
        'Missing required fields: supplierAddress, logisticsAddress, arbiterAddress, tokenAddress, milestones',
      );
    }

    const token = this.tokenRegistry.getToken(tokenAddress);

    const shipment = await this.prisma.shipment.create({
      data: {
        id: dto.shipmentId,
        buyerAddress: dto.buyerAddress,
        supplierAddress,
        logisticsAddress,
        arbiterAddress,
        tokenAddress,
        tokenDecimals: token.decimals,
        tokenSymbol: token.symbol,
        totalAmount: BigInt(dto.totalAmount),
        txHash: dto.txHash,
        description: dto.description,
        referenceNumber: dto.referenceNumber,
        metadata: dto.metadata,
        tags: dto.tags ?? [],
        milestones: {
          create: milestones.map((m, index) => ({
            milestoneIndex: index,
            name: m.name,
            paymentPercent: m.paymentPercent,
            ...(m.dueAt ? { dueAt: new Date(m.dueAt) } : {}),
            ...(m.dueDays ? { dueAt: new Date(Date.now() + m.dueDays * 24 * 60 * 60 * 1000) } : {}),
          })),
        },
      },
      include: { milestones: true },
    });

    // Notify the designated arbiter about their assignment
    await this.notifications.notifyUser(
      dto.arbiterAddress,
      NotificationType.ARBITER_INVITED,
      'Arbiter assignment invitation',
      `You have been assigned as arbiter for shipment ${shipment.id}. Please accept or decline this assignment.`,
      { shipmentId: shipment.id, buyerAddress: dto.buyerAddress, supplierAddress: dto.supplierAddress },
    );

    this.logger.log(`Shipment created: ${shipment.id} — arbiter ${dto.arbiterAddress} notified`);
    return this.serialize(shipment);
  }

  // ----------------------------------------------------------
  // READ
  // ----------------------------------------------------------

  async findAll(filters: {
    buyerAddress?: string;
    supplierAddress?: string;
    status?: ShipmentStatus;
    referenceNumber?: string;
    tags?: string[];
    page?: number;
    limit?: number;
    createdAfter?: string;
    createdBefore?: string;
    updatedAfter?: string;
    updatedBefore?: string;
    callerStellarAddress?: string;
    isAdmin?: boolean;
  }) {
    const {
      buyerAddress,
      supplierAddress,
      status,
      referenceNumber,
      tags,
      page = 1,
      limit = 20,
      createdAfter,
      createdBefore,
      updatedAfter,
      updatedBefore,
      callerStellarAddress,
      isAdmin = false,
    } = filters;

    const where: any = {};

    if (buyerAddress) where.buyerAddress = buyerAddress;
    if (supplierAddress) where.supplierAddress = supplierAddress;
    if (status) where.status = status;
    if (referenceNumber) where.referenceNumber = referenceNumber;
    if (tags && tags.length > 0) {
      where.tags = { hasSome: tags };
    }

    // Dynamic chronological range bounds filters
    if (createdAfter || createdBefore) {
      where.createdAt = {
        ...(createdAfter && { gte: new Date(createdAfter) }),
        ...(createdBefore && { lte: new Date(createdBefore) }),
      };
    }

    if (updatedAfter || updatedBefore) {
      where.updatedAt = {
        ...(updatedAfter && { gte: new Date(updatedAfter) }),
        ...(updatedBefore && { lte: new Date(updatedBefore) }),
      };
    }

    // Scope to shipments where the caller is a participant (buyer/supplier/logistics/arbiter)
    if (!isAdmin && callerStellarAddress) {
      where.AND = where.AND ?? [];
      where.AND.push({
        OR: [
          { buyerAddress: callerStellarAddress },
          { supplierAddress: callerStellarAddress },
          { logisticsAddress: callerStellarAddress },
          { arbiterAddress: callerStellarAddress },
        ],
      });
    }

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
      data: shipments.map((s) => this.serialize(s)),
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

  /**
   * Update shipment metadata (description, referenceNumber, metadata, tags).
   * Only the buyer can update a shipment.
   * Financial fields and addresses are immutable and ignored if provided.
   */
  async update(id: string, buyerAddress: string, dto: any) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
    });

    if (!shipment) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }

    // Verify buyer is the one making the update
    if (shipment.buyerAddress !== buyerAddress) {
      throw new ForbiddenException('Only the shipment buyer can update it');
    }

    // Check for duplicate referenceNumber if being updated
    if (dto.referenceNumber && dto.referenceNumber !== shipment.referenceNumber) {
      const withRef = await this.prisma.shipment.findUnique({
        where: { referenceNumber: dto.referenceNumber },
      });
      if (withRef) {
        throw new ConflictException(`Shipment with referenceNumber "${dto.referenceNumber}" already exists`);
      }
    }

    // Only allow updating descriptive fields (financial/address fields ignored)
    const updateData: any = {};
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.referenceNumber !== undefined) updateData.referenceNumber = dto.referenceNumber;
    if (dto.metadata !== undefined) updateData.metadata = dto.metadata;
    if (dto.tags !== undefined) updateData.tags = dto.tags;

    const updated = await this.prisma.shipment.update({
      where: { id },
      data: updateData,
      include: {
        milestones: { orderBy: { milestoneIndex: 'asc' } },
        events: { orderBy: { ledger: 'desc' }, take: 20 },
      },
    });

    this.logger.log(`Shipment updated: ${id}`);
    return this.serialize(updated);
  }

  // ----------------------------------------------------------
  // ARBITER ACCEPT / DECLINE
  // ----------------------------------------------------------

  /**
   * Called when the designated arbiter accepts their assignment.
   * Sets arbiterStatus to ACCEPTED and notifies the buyer.
   */
  async arbiterAccept(id: string, callerAddress: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
    });

    if (!shipment) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }

    if (shipment.arbiterAddress !== callerAddress) {
      throw new ForbiddenException('Only the designated arbiter can accept this assignment');
    }

    if (shipment.arbiterStatus !== ArbiterStatus.PENDING_ACCEPTANCE) {
      throw new ConflictException(
        `Arbiter assignment is already ${shipment.arbiterStatus.toLowerCase()}`,
      );
    }

    const updated = await this.prisma.shipment.update({
      where: { id },
      data: { arbiterStatus: ArbiterStatus.ACCEPTED },
    });

    await this.notifications.notifyUser(
      shipment.buyerAddress,
      NotificationType.ARBITER_ACCEPTED,
      'Arbiter accepted assignment',
      `The arbiter for shipment ${id} has accepted their assignment.`,
      { shipmentId: id, arbiterAddress: callerAddress },
    );

    this.logger.log(`Arbiter ${callerAddress} accepted assignment for shipment ${id}`);
    return this.serialize(updated);
  }

  /**
   * Called when the designated arbiter declines their assignment.
   * Sets arbiterStatus to DECLINED and notifies the buyer.
   */
  async arbiterDecline(id: string, callerAddress: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
    });

    if (!shipment) {
      throw new NotFoundException(`Shipment ${id} not found`);
    }

    if (shipment.arbiterAddress !== callerAddress) {
      throw new ForbiddenException('Only the designated arbiter can decline this assignment');
    }

    if (shipment.arbiterStatus !== ArbiterStatus.PENDING_ACCEPTANCE) {
      throw new ConflictException(
        `Arbiter assignment is already ${shipment.arbiterStatus.toLowerCase()}`,
      );
    }

    const updated = await this.prisma.shipment.update({
      where: { id },
      data: { arbiterStatus: ArbiterStatus.DECLINED },
    });

    await this.notifications.notifyUser(
      shipment.buyerAddress,
      NotificationType.ARBITER_DECLINED,
      'Arbiter declined assignment',
      `The arbiter for shipment ${id} has declined their assignment. Please designate a replacement.`,
      { shipmentId: id, arbiterAddress: callerAddress },
    );

    this.logger.log(`Arbiter ${callerAddress} declined assignment for shipment ${id}`);
    return this.serialize(updated);
  }

  // ----------------------------------------------------------
  // SYNC FROM CHAIN — called by EventsService after polling
  // ----------------------------------------------------------

  async syncStatusFromChain(shipmentId: string) {
    try {
      // Convert shipmentId to ScVal String for contract call
      const shipmentIdScVal = nativeToScVal(shipmentId, { type: 'string' });
      
      const onChain = await this.stellar.simulateContractCall('get_shipment', [
        shipmentIdScVal,
      ]);

      // If contract returns null, shipment doesn't exist on-chain yet
      if (!onChain) {
        this.logger.warn(
          `Shipment ${shipmentId} not found on-chain. It may not be created yet or the ID is incorrect.`
        );
        return;
      }

      // Map on-chain status to Prisma enum
      const statusMap: Record<string, ShipmentStatus> = {
        Active: ShipmentStatus.ACTIVE,
        Completed: ShipmentStatus.COMPLETED,
        Cancelled: ShipmentStatus.CANCELLED,
      };

      const mappedStatus = statusMap[onChain.status];
      
      if (!mappedStatus) {
        this.logger.warn(
          `Unknown on-chain status "${onChain.status}" for shipment ${shipmentId}. Skipping update.`
        );
        return;
      }

      // Parse released amount - handle both string and number formats
      const releasedAmount = onChain.released_amount 
        ? BigInt(onChain.released_amount.toString())
        : BigInt(0);

      await this.prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          status: mappedStatus,
          releasedAmount,
        },
      });

      this.logger.log(
        `Synced shipment ${shipmentId} from chain: status=${mappedStatus}, releasedAmount=${releasedAmount}`
      );
    } catch (error) {
      // Check if it's a "shipment not found in DB" error
      if (error.code === 'P2025') {
        this.logger.warn(
          `Cannot sync shipment ${shipmentId}: not found in database`
        );
        return;
      }
      
      this.logger.error(
        `Failed to sync shipment ${shipmentId} from chain: ${error.message}`,
        error.stack
      );
      // Don't throw - allow the process to continue
    }
  }

  // ----------------------------------------------------------
  // INTERNAL HELPERS
  // ----------------------------------------------------------

  private serialize(shipment: any) {
    const now = new Date();
    const decimals: number = shipment.tokenDecimals ?? 7;
    const symbol: string = shipment.tokenSymbol ?? 'USDC';

    return {
      ...shipment,
      tokenSymbol: symbol,
      tokenDecimals: decimals,
      // Raw values kept for backward compatibility
      totalAmount: shipment.totalAmount?.toString(),
      releasedAmount: shipment.releasedAmount?.toString(),
      // Human-readable display values
      totalAmountFormatted: this.stellar.toHumanAmount(shipment.totalAmount ?? 0n, decimals),
      releasedAmountFormatted: this.stellar.toHumanAmount(shipment.releasedAmount ?? 0n, decimals),
      milestones: shipment.milestones?.map((m: any) => {
        const isOverdue =
          m.dueAt &&
          m.dueAt < now &&
          m.status !== 'CONFIRMED' &&
          m.status !== 'RESOLVED';

        return {
          ...m,
          paymentReleased: m.paymentReleased?.toString() ?? null,
          isOverdue: Boolean(isOverdue),
        };
      }),
    };
  }
}