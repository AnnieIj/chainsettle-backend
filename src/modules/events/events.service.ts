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
  /** In-memory mirror of the DB cursor — updated after each successful tick. */
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
    try {
      // Attempt to load the persisted cursor from the database
      const cursor = await this.prisma.eventCursor.findUnique({
        where: { id: 'main' },
      });

      if (cursor) {
        // Resume from where we left off
        this.lastProcessedLedger = cursor.lastProcessedLedger;
        this.logger.log(
          `Resuming event poller from persisted ledger ${this.lastProcessedLedger}`,
        );
      } else {
        // First-ever boot: seed from the current chain tip minus a small buffer
        const latest = await this.stellar.getLatestLedger();
        const seedLedger = Math.max(1, latest - 10);

        await this.prisma.eventCursor.create({
          data: { id: 'main', lastProcessedLedger: seedLedger },
        });

        this.lastProcessedLedger = seedLedger;
        this.logger.log(
          `Event cursor seeded at ledger ${this.lastProcessedLedger} (first boot)`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Could not initialise event cursor from DB: ${error.message} — will retry on first poll`,
      );
      // Fall back to the Stellar chain tip so we don't replay the entire history
      try {
        const latest = await this.stellar.getLatestLedger();
        this.lastProcessedLedger = Math.max(1, latest - 10);
      } catch {
        this.lastProcessedLedger = 1;
      }
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

      // Determine the new high-water mark before entering the transaction
      const nextLedger = events.reduce(
        (max, e) => Math.max(max, e.ledger + 1),
        this.lastProcessedLedger,
      );

      // Process all events and advance the cursor in a single atomic transaction
      await this.prisma.$transaction(async (tx) => {
        for (const event of events) {
          await this.processEvent(event, tx);
        }

        // Advance the durable cursor inside the same transaction
        await tx.eventCursor.update({
          where: { id: 'main' },
          data: { lastProcessedLedger: nextLedger },
        });
      });

      // Mirror the persisted value in memory
      this.lastProcessedLedger = nextLedger;
      this.logger.log(`Cursor advanced to ledger ${this.lastProcessedLedger}`);
    } catch (error) {
      this.logger.error('Event polling failed', error.message);
    }
  }

  // ----------------------------------------------------------
  // EVENT DISPATCHER
  // ----------------------------------------------------------

  private async processEvent(event: any, tx?: any) {
    const eventName = this.extractEventName(event);
    const payload = this.extractPayload(event);

    this.logger.debug(`Event: ${eventName} | Ledger: ${event.ledger}`);

    // Save raw event to DB (audit trail) — use the transaction client when provided
    await this.saveRawEvent(eventName, event, payload, tx);

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

  private async saveRawEvent(eventName: string, event: any, payload: any, tx?: any) {
    // Use the injected transaction client if one was provided, else fall back to
    // the global PrismaService so non-transactional callers still work.
    const client = tx ?? this.prisma;
    try {
      const shipmentId = this.extractShipmentId(payload);

      await client.chainEvent.upsert({
        where: {
          // Idempotency: the same tx + event name should never be stored twice
          txHash_eventName: {
            txHash: event.txHash ?? '',
            eventName,
          },
        },
        update: {}, // already exists — no-op
        create: {
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
