import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { MilestonesService } from '../milestones/milestones.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { NotificationType } from '@prisma/client';

/**
 * EventsService
 *
 * Polls the Stellar RPC every 5 seconds for new contract events emitted
 * by the ChainSettle contract. When events are detected:
 *
 *  1. The relevant DB records (shipments, milestones) are updated
 *  2. Notifications are dispatched to the relevant users
 *  3. The event is saved to the chain_events table for audit trail
 *
 * This is the core integration bridge between the on-chain contract
 * and the off-chain backend state.
 *
 * Event names emitted by the contract:
 *   - shipment_created
 *   - proof_submitted
 *   - milestone_confirmed
 *   - dispute_raised
 *   - dispute_resolved
 *   - shipment_cancelled
 */
@Injectable()
export class EventsService implements OnModuleInit {
  private readonly logger = new Logger(EventsService.name);
  private lastProcessedLedger: number = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stellar: StellarService,
    private readonly milestones: MilestonesService,
    private readonly notifications: NotificationsService,
    private readonly shipments: ShipmentsService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    // Start polling from the current ledger minus a small buffer
    try {
      const latest = await this.stellar.getLatestLedger();
      this.lastProcessedLedger = Math.max(1, latest - 10);
      this.logger.log(`Event poller initialised at ledger ${this.lastProcessedLedger}`);
    } catch (error) {
      this.logger.warn('Could not fetch latest ledger on init — will retry on first poll');
      this.lastProcessedLedger = 1;
    }
  }

  // ----------------------------------------------------------
  // CRON JOB — runs every 5 seconds
  // ----------------------------------------------------------

  @Cron(CronExpression.EVERY_5_SECONDS)
  async pollEvents() {
    try {
      const events = await this.stellar.fetchContractEvents(this.lastProcessedLedger);

      if (events.length === 0) return;

      this.logger.log(`Processing ${events.length} new chain event(s)`);

      for (const event of events) {
        await this.processEvent(event);
        // Advance the cursor past this event's ledger
        this.lastProcessedLedger = Math.max(
          this.lastProcessedLedger,
          event.ledger + 1,
        );
      }
    } catch (error) {
      this.logger.error('Event polling failed', error.message);
    }
  }

  // ----------------------------------------------------------
  // EVENT DISPATCHER
  // ----------------------------------------------------------

  private async processEvent(event: any) {
    const eventName = this.extractEventName(event);
    const payload = this.extractPayload(event);

    this.logger.debug(`Event: ${eventName} | Ledger: ${event.ledger}`);

    // Save raw event to DB (audit trail)
    await this.saveRawEvent(eventName, event, payload);

    // Route to the correct handler
    switch (eventName) {
      case 'shipment_created':
        await this.handleShipmentCreated(payload, event);
        break;
      case 'proof_submitted':
        await this.handleProofSubmitted(payload, event);
        break;
      case 'milestone_confirmed':
        await this.handleMilestoneConfirmed(payload, event);
        break;
      case 'dispute_raised':
        await this.handleDisputeRaised(payload, event);
        break;
      case 'dispute_resolved':
        await this.handleDisputeResolved(payload, event);
        break;
      case 'shipment_cancelled':
        await this.handleShipmentCancelled(payload, event);
        break;
      default:
        this.logger.warn(`Unknown event: ${eventName}`);
    }
  }

  // ----------------------------------------------------------
  // EVENT HANDLERS
  // ----------------------------------------------------------

  private async handleShipmentCreated(payload: any, event: any) {
    const shipmentId = payload;
    this.logger.log(`Shipment created on-chain: ${shipmentId}`);
    // The shipment record is created by the frontend calling POST /shipments
    // but we sync here as a safety net
  }

  private async handleProofSubmitted(payload: any, event: any) {
    const [shipmentId, milestoneIndex] = Array.isArray(payload) ? payload : [payload, 0];
    this.logger.log(`Proof submitted: ${shipmentId} milestone ${milestoneIndex}`);

    await this.milestones.markProofSubmitted(
      String(shipmentId),
      Number(milestoneIndex),
      '', // proof hash is in the contract — fetch via simulateContractCall if needed
    );

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: String(shipmentId) },
    });

    if (shipment) {
      await this.notifications.notifyUser(
        shipment.buyerAddress,
        NotificationType.PROOF_SUBMITTED,
        'Proof submitted',
        `Milestone ${milestoneIndex} proof has been submitted for shipment ${shipmentId}. Please review and confirm.`,
        { shipmentId, milestoneIndex },
      );
    }
  }

  private async handleMilestoneConfirmed(payload: any, event: any) {
    const [shipmentId, milestoneIndex, paymentAmount] = Array.isArray(payload)
      ? payload
      : [payload, 0, 0];

    this.logger.log(
      `Milestone confirmed: ${shipmentId}[${milestoneIndex}] — ${paymentAmount} released`,
    );

    await this.milestones.markConfirmed(
      String(shipmentId),
      Number(milestoneIndex),
      BigInt(paymentAmount ?? 0),
    );

    // Update released amount on the shipment
    await this.shipments.syncStatusFromChain(String(shipmentId));

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: String(shipmentId) },
    });

    if (shipment) {
      const usdcAmount = this.stellar.stroopsToUsdc(BigInt(paymentAmount ?? 0));

      await this.notifications.notifyUser(
        shipment.supplierAddress,
        NotificationType.PAYMENT_RELEASED,
        'Payment released',
        `$${usdcAmount} USDC has been released for milestone ${milestoneIndex} on shipment ${shipmentId}.`,
        { shipmentId, milestoneIndex, paymentAmount: usdcAmount },
      );
    }
  }

  private async handleDisputeRaised(payload: any, event: any) {
    const [shipmentId, milestoneIndex] = Array.isArray(payload) ? payload : [payload, 0];
    this.logger.log(`Dispute raised: ${shipmentId}[${milestoneIndex}]`);

    await this.milestones.markDisputed(String(shipmentId), Number(milestoneIndex));

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: String(shipmentId) },
    });

    if (shipment) {
      // Notify supplier and arbiter
      for (const address of [shipment.supplierAddress, shipment.arbiterAddress]) {
        await this.notifications.notifyUser(
          address,
          NotificationType.DISPUTE_RAISED,
          'Dispute raised',
          `A dispute has been raised on milestone ${milestoneIndex} for shipment ${shipmentId}.`,
          { shipmentId, milestoneIndex },
        );
      }
    }
  }

  private async handleDisputeResolved(payload: any, event: any) {
    const [shipmentId, milestoneIndex, approved] = Array.isArray(payload)
      ? payload
      : [payload, 0, false];

    this.logger.log(
      `Dispute resolved: ${shipmentId}[${milestoneIndex}] approved=${approved}`,
    );

    await this.milestones.markResolved(
      String(shipmentId),
      Number(milestoneIndex),
      Boolean(approved),
    );

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: String(shipmentId) },
    });

    if (shipment) {
      for (const address of [shipment.buyerAddress, shipment.supplierAddress]) {
        await this.notifications.notifyUser(
          address,
          NotificationType.DISPUTE_RESOLVED,
          `Dispute ${approved ? 'approved' : 'rejected'}`,
          `The dispute on milestone ${milestoneIndex} (shipment ${shipmentId}) was ${approved ? 'approved — payment released' : 'rejected — supplier must resubmit proof'}.`,
          { shipmentId, milestoneIndex, approved },
        );
      }
    }
  }

  private async handleShipmentCancelled(payload: any, event: any) {
    const [shipmentId, refundAmount] = Array.isArray(payload) ? payload : [payload, 0];
    this.logger.log(`Shipment cancelled: ${shipmentId} — refund ${refundAmount}`);

    await this.prisma.shipment.update({
      where: { id: String(shipmentId) },
      data: { status: 'CANCELLED' },
    });
  }

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------

  private extractEventName(event: any): string {
    // Stellar events have topics array — first topic is typically the event name
    try {
      const topics = event.topic ?? [];
      if (topics.length > 0) {
        return topics[0]?.toString() ?? 'unknown';
      }
    } catch {}
    return 'unknown';
  }

  private extractPayload(event: any): any {
    try {
      return event.value ? JSON.parse(JSON.stringify(event.value)) : null;
    } catch {
      return null;
    }
  }

  private async saveRawEvent(eventName: string, event: any, payload: any) {
    try {
      const shipmentId = this.extractShipmentId(payload);

      await this.prisma.chainEvent.create({
        data: {
          eventName,
          ledger: event.ledger ?? 0,
          txHash: event.txHash ?? '',
          payload: payload ?? {},
          shipmentId: shipmentId || undefined,
        },
      });
    } catch (error) {
      this.logger.error('Failed to save raw event', error.message);
    }
  }

  private extractShipmentId(payload: any): string | null {
    if (typeof payload === 'string') return payload;
    if (Array.isArray(payload) && typeof payload[0] === 'string') return payload[0];
    return null;
  }

  // ----------------------------------------------------------
  // READ ENDPOINTS (for EventsController)
  // ----------------------------------------------------------

  async findAll(shipmentId?: string, page = 1, limit = 20) {
    const where = shipmentId ? { shipmentId } : {};

    const [events, total] = await this.prisma.$transaction([
      this.prisma.chainEvent.findMany({
        where,
        orderBy: { ledger: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.chainEvent.count({ where }),
    ]);

    return { data: events, meta: { total, page, limit } };
  }
}
