// milestones.service.ts
import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MilestoneStatus } from '@prisma/client';

@Injectable()
export class MilestonesService {
  private readonly logger = new Logger(MilestonesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByShipment(shipmentId: string) {
    return this.prisma.milestone.findMany({
      where: { shipmentId },
      orderBy: { milestoneIndex: 'asc' },
    });
  }

  async findOne(shipmentId: string, milestoneIndex: number) {
    const milestone = await this.prisma.milestone.findUnique({
      where: { shipmentId_milestoneIndex: { shipmentId, milestoneIndex } },
    });
    if (!milestone) {
      throw new NotFoundException(`Milestone ${milestoneIndex} not found on shipment ${shipmentId}`);
    }
    return milestone;
  }

  /**
   * Called by EventsService when a proof_submitted event is detected on-chain.
   * Updates the local DB record to reflect the new proof hash and status.
   */
  async markProofSubmitted(
    shipmentId: string,
    milestoneIndex: number,
    proofHash: string,
  ) {
    return this.prisma.milestone.update({
      where: { shipmentId_milestoneIndex: { shipmentId, milestoneIndex } },
      data: {
        proofHash,
        status: MilestoneStatus.PROOF_SUBMITTED,
      },
    });
  }

  /**
   * Called by EventsService when a milestone_confirmed event is detected.
   */
  async markConfirmed(
    shipmentId: string,
    milestoneIndex: number,
    paymentReleased: bigint,
  ) {
    return this.prisma.milestone.update({
      where: { shipmentId_milestoneIndex: { shipmentId, milestoneIndex } },
      data: {
        status: MilestoneStatus.CONFIRMED,
        paymentReleased,
        confirmedAt: new Date(),
      },
    });
  }

  /**
   * Called by EventsService when a dispute_raised event is detected.
   */
  async markDisputed(shipmentId: string, milestoneIndex: number) {
    return this.prisma.milestone.update({
      where: { shipmentId_milestoneIndex: { shipmentId, milestoneIndex } },
      data: { status: MilestoneStatus.DISPUTED },
    });
  }

  /**
   * Called by EventsService when a dispute_resolved event is detected.
   */
  async markResolved(
    shipmentId: string,
    milestoneIndex: number,
    approved: boolean,
    paymentReleased?: bigint,
  ) {
    return this.prisma.milestone.update({
      where: { shipmentId_milestoneIndex: { shipmentId, milestoneIndex } },
      data: {
        status: approved ? MilestoneStatus.RESOLVED : MilestoneStatus.PENDING,
        ...(approved && paymentReleased ? { paymentReleased, confirmedAt: new Date() } : {}),
      },
    });
  }
}
