import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StellarService } from '../../common/stellar/stellar.service';
import { MilestonesService } from '../milestones/milestones.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { NotificationType } from '@prisma/client';

const MAX_ATTEMPTS = 5;

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
 * Failed events are persisted to failed_events (DLQ) and retried with
 * exponential back-off up to MAX_ATTEMPTS times.
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

      for (const event of events) {
        try {
          await this.processEvent(event);
        } catch (error) {
          await this.saveToDlq(event, error as Error);
        }
        this.lastProcessedLedger = Math.max(this.lastProcessedLedger, event.ledger + 1);
      }
    } catch (error) {
      this.logger.error('Event polling failed', (error as Error).message);
    }
  }

  // ----------------------------------------------------------
  // RETRY CRON — runs every minute, exponential back-off
  // ----------------------------------------------------------

  @Cron(CronExpression.EVERY_MINUTE)
  async retryFailedEvents() {
    const now = new Date();

    const pending = await this.prisma.failedEvent.findMany({
      where: { resolvedAt: null, attemptCount: { lt: MAX_ATTEMPTS } },
    });

    // Only retry events whose back-off window has fully elapsed
    const toRetry = pending.filter((e) => {
      const backoffMs = Math.pow(2, e.attemptCount - 1) * 60 * 1000;
      return e.lastAttemptAt.getTime() + backoffMs <= now.getTime();
    });

    for (const failedEvent of toRetry) {
      try {
        await this.executeHandler(failedEvent.eventName, failedEvent.payload, {
          ledger: failedEvent.ledger,
          txHash: failedEvent.txHash,
        });

        await this.prisma.failedEvent.update({
          where: { id: failedEvent.id },
          data: { resolvedAt: new Date() },
        });

        this.logger.log(`Retry resolved failed event ${failedEvent.id} (${failedEvent.eventName})`);
      } catch (error) {
        const newCount = failedEvent.attemptCount + 1;

        await this.prisma.failedEvent.update({
          where: { id: failedEvent.id },
          data: {
            attemptCount: newCount,
            lastAttemptAt: new Date(),
            error: (error as Error).message,
          },
        });

        this.logger.warn(
          `Failed event ${failedEvent.id} retry ${newCount}/${MAX_ATTEMPTS}: ${(error as Error).message}`,
        );

        if (newCount >= MAX_ATTEMPTS) {
          await this.alertAdmins(failedEvent, error as Error);
        }
      }
    }
  }

  // ----------------------------------------------------------
  // EVENT DISPATCHER
  // ----------------------------------------------------------

  private async processEvent(event: any, tx?: any) {
    const eventName = this.extractEventName(event);
    const payload = this.extractPayload(event);

    this.logger.debug(`Event: ${eventName} | Ledger: ${event.ledger}`);

    await this.saveRawEvent(eventName, event, payload);
    await this.executeHandler(eventName, payload, event);
  }

  private async executeHandler(eventName: string, payload: any, meta: any) {
    switch (eventName) {
      case 'shipment_created':
        await this.handleShipmentCreated(payload, meta);
        break;
      case 'proof_submitted':
        await this.handleProofSubmitted(payload, meta);
        break;
      case 'milestone_confirmed':
        await this.handleMilestoneConfirmed(payload, meta);
        break;
      case 'dispute_raised':
        await this.handleDisputeRaised(payload, meta);
        break;
      case 'dispute_resolved':
        await this.handleDisputeResolved(payload, meta);
        break;
      case 'shipment_cancelled':
        await this.handleShipmentCancelled(payload, meta);
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
    // Record is created by the frontend POST /shipments; this is a safety-net.
  }

  private async handleProofSubmitted(payload: any, event: any) {
    const [shipmentId, milestoneIndex] = Array.isArray(payload) ? payload : [payload, 0];
    this.logger.log(`Proof submitted on-chain: ${shipmentId} milestone ${milestoneIndex}`);

    await this.milestones.markProofSubmitted(
      String(shipmentId),
      Number(milestoneIndex),
      '',
    );

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: String(shipmentId) },
    });

    if (shipment) {
      await this.notifications.notifyUser(
        shipment.buyerAddress,
        NotificationType.PROOF_SUBMITTED,
        'Proof submitted for review',
        `Milestone ${milestoneIndex} proof has been submitted for shipment ${shipmentId}. Please review and confirm.`,
        { shipmentId, milestoneIndex, proofHash },
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

    await this.shipments.syncStatusFromChain(String(shipmentId));

    const shipment = await this.prisma.shipment.findUnique({
      where: { id: String(shipmentId) },
    });

    if (shipment) {
      // Use the shipment's stored token decimals and symbol so non-USDC
      // tokens display their amounts correctly (fixes hard-coded 7 dp).
      const humanAmount = this.stellar.toHumanAmount(
        BigInt(paymentAmount ?? 0),
        shipment.tokenDecimals,
      );

      await this.notifications.notifyUser(
        shipment.supplierAddress,
        NotificationType.PAYMENT_RELEASED,
        'Payment released',
        `${humanAmount} ${shipment.tokenSymbol} has been released for milestone ${milestoneIndex} on shipment ${shipmentId}.`,
        { shipmentId, milestoneIndex, paymentAmount: humanAmount, tokenSymbol: shipment.tokenSymbol },
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
          `The dispute on milestone ${milestoneIndex} (shipment ${shipmentId}) was ${
            approved ? 'approved — payment released' : 'rejected — supplier must resubmit proof'
          }.`,
          { shipmentId, milestoneIndex, approved },
        );
      }
    }
  }

  private async handleShipmentCancelled(payload: any, event: any) {
    const [shipmentId] = Array.isArray(payload) ? payload : [payload];
    this.logger.log(`Shipment cancelled: ${shipmentId}`);

    await this.prisma.shipment.update({
      where: { id: String(shipmentId) },
      data: { status: 'CANCELLED' },
    });
  }

  // ----------------------------------------------------------
  // DLQ HELPERS
  // ----------------------------------------------------------

  private async saveToDlq(event: any, error: Error) {
    const eventName = this.extractEventName(event);
    const payload = this.extractPayload(event);
    const txHash = event.txHash ?? '';

    this.logger.error('Event processing failed — saving to DLQ', {
      eventName,
      ledger: event.ledger,
      txHash,
      error: error.message,
    });

    try {
      await this.prisma.failedEvent.upsert({
        where: { txHash_eventName: { txHash, eventName } },
        create: {
          eventName,
          ledger: event.ledger ?? 0,
          txHash,
          payload: payload ?? {},
          error: error.message,
          attemptCount: 1,
          lastAttemptAt: new Date(),
        },
        update: {
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          error: error.message,
        },
      });
    } catch (dlqError) {
      this.logger.error('Failed to save event to DLQ', (dlqError as Error).message);
    }
  }

  private async alertAdmins(failedEvent: any, error: Error) {
    const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN' } });

    for (const admin of admins) {
      await this.notifications.notifyUser(
        admin.stellarAddress,
        NotificationType.SYSTEM_ALERT,
        'Failed event exhausted retries',
        `Event "${failedEvent.eventName}" (id: ${failedEvent.id}) failed ${MAX_ATTEMPTS} times and will not be retried automatically. Last error: ${error.message}`,
        { failedEventId: failedEvent.id, eventName: failedEvent.eventName },
      );
    }
  }

  // ----------------------------------------------------------
  // ADMIN QUERY METHODS (called by EventsController)
  // ----------------------------------------------------------

  async getAdminFailedEvents(page = 1, limit = 20) {
    const where = { resolvedAt: null };

    const [events, total] = await this.prisma.$transaction([
      this.prisma.failedEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.failedEvent.count({ where }),
    ]);

    return { data: events, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async retryFailedEventById(id: string) {
    const failedEvent = await this.prisma.failedEvent.findUniqueOrThrow({ where: { id } });

    await this.executeHandler(failedEvent.eventName, failedEvent.payload, {
      ledger: failedEvent.ledger,
      txHash: failedEvent.txHash,
    });

    await this.prisma.failedEvent.update({
      where: { id },
      data: { resolvedAt: new Date() },
    });

    this.logger.log(`Admin manually retried and resolved failed event ${id}`);
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

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------

  private extractEventName(event: any): string {
    try {
      const topics = event.topic ?? [];
      if (topics.length > 0) return topics[0]?.toString() ?? 'unknown';
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
      this.logger.error('Failed to save raw event', (error as Error).message);
    }
  }

  private extractShipmentId(payload: any): string | null {
    if (typeof payload === 'string') return payload;
    if (Array.isArray(payload) && typeof payload[0] === 'string') return payload[0];
    return null;
  }
}
