import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MilestoneStatus, NotificationType } from '@prisma/client';

/**
 * MilestoneDeadlineJob
 *
 * Runs hourly to check for overdue milestones and send notifications.
 * A milestone is considered overdue when:
 *   - status is PENDING or PROOF_SUBMITTED
 *   - dueAt is in the past
 *   - overdueNotifiedAt is NULL (hasn't been notified yet)
 *
 * For each overdue milestone, notifies both the buyer and supplier,
 * then sets overdueNotifiedAt to prevent duplicate notifications.
 */
@Injectable()
export class MilestoneDeadlineJob {
  private readonly logger = new Logger(MilestoneDeadlineJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Scheduled job: runs every hour
   * Detects overdue milestones and sends notifications
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkAndNotifyOverdue() {
    try {
      this.logger.log('Starting milestone deadline check...');

      const now = new Date();

      // Find all overdue milestones that haven't been notified yet
      const overdueMillestones = await this.prisma.milestone.findMany({
        where: {
          dueAt: {
            lt: now, // dueAt < now
          },
          status: {
            in: [MilestoneStatus.PENDING, MilestoneStatus.PROOF_SUBMITTED],
          },
          overdueNotifiedAt: null, // not yet notified
        },
        include: {
          shipment: {
            select: {
              id: true,
              buyerAddress: true,
              supplierAddress: true,
            },
          },
        },
      });

      if (overdueMillestones.length === 0) {
        this.logger.log('No overdue milestones found');
        return;
      }

      this.logger.log(`Found ${overdueMillestones.length} overdue milestone(s)`);

      // Process each overdue milestone
      for (const milestone of overdueMillestones) {
        await this.notifyOverdue(milestone);
      }
    } catch (error) {
      this.logger.error('Milestone deadline check failed', error.message);
    }
  }

  /**
   * Notify buyer and supplier about overdue milestone
   * Then set overdueNotifiedAt to prevent re-notification
   */
  private async notifyOverdue(milestone: any) {
    try {
      const { shipment, milestoneIndex, dueAt } = milestone;
      const shipmentId = shipment.id;

      const dueDateStr = new Date(dueAt).toISOString().split('T')[0];
      const title = `Milestone ${milestoneIndex} overdue`;
      const message = `Milestone ${milestoneIndex} for shipment ${shipmentId} is overdue (was due ${dueDateStr}). Please take action or raise a dispute.`;

      // Notify buyer
      await this.notifications.notifyUser(
        shipment.buyerAddress,
        NotificationType.MILESTONE_OVERDUE,
        title,
        message,
        {
          shipmentId,
          milestoneIndex,
          dueAt: dueAt.toISOString(),
        },
      );

      // Notify supplier
      await this.notifications.notifyUser(
        shipment.supplierAddress,
        NotificationType.MILESTONE_OVERDUE,
        title,
        message,
        {
          shipmentId,
          milestoneIndex,
          dueAt: dueAt.toISOString(),
        },
      );

      // Update milestone to record that notification was sent
      await this.prisma.milestone.update({
        where: { id: milestone.id },
        data: { overdueNotifiedAt: new Date() },
      });

      this.logger.log(
        `Notified overdue milestone: ${shipmentId}[${milestoneIndex}]`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to notify overdue milestone ${milestone.id}`,
        error.message,
      );
    }
  }
}
