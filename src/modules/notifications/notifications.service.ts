import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() private readonly gateway: NotificationsGateway,
  ) {
    this.transporter = nodemailer.createTransport({
      host: this.config.get('SMTP_HOST'),
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: false,
      auth: {
        user: this.config.get('SMTP_USER'),
        pass: this.config.get('SMTP_PASS'),
      },
    });
  }

  /**
   * Creates an in-app notification for a user (by their Stellar address)
   * and optionally sends an email if they have one registered.
   */
  async notifyUser(
    stellarAddress: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>,
  ) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { stellarAddress },
      });

      if (!user) {
        this.logger.warn(`No user found for address ${stellarAddress} — skipping notification`);
        return;
      }

      const notification = await this.prisma.notification.create({
        data: {
          userId: user.id,
          type,
          title,
          message,
          data: data ?? {},
        },
      });

      // Send email if user has one registered
      if (user.email) {
        await this.sendEmail(user.email, title, message);
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: { emailSent: true },
        });
      }

      // Push to any connected WebSocket clients for this user
      this.gateway?.pushToUser(user.id, notification);

      return notification;
    } catch (error) {
      this.logger.error(`Failed to notify ${stellarAddress}`, error.message);
    }
  }

  async findForUser(userId: string, unreadOnly = false, page = 1, limit = 20) {
    const where: any = { userId };
    if (unreadOnly) where.read = false;

    const [notifications, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data: notifications, meta: { total, page, limit } };
  }

  async markRead(notificationId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });
  }

  async markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  async sendEmail(to: string, subject: string, text: string) {
    try {
      await this.transporter.sendMail({
        from: this.config.get('EMAIL_FROM', 'noreply@chainsetttle.com'),
        to,
        subject: `ChainSettle — ${subject}`,
        text,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a2e;">ChainSettle</h2>
            <p>${text}</p>
            <hr />
            <small style="color: #888;">You're receiving this because you're a participant on ChainSettle.</small>
          </div>
        `,
      });
      this.logger.log(`Email sent to ${to}: ${subject}`);
    } catch (error) {
      this.logger.error(`Email failed to ${to}`, error.message);
    }
  }
}
