import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import axios from 'axios';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationType } from '@prisma/client';
import { CreateWebhookDto } from './dto/create-webhook.dto';

const MAX_ATTEMPTS = 3;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, dto: CreateWebhookDto) {
    const plaintext = crypto.randomBytes(32).toString('hex');
    const hashed = crypto.createHash('sha256').update(plaintext).digest('hex');

    const endpoint = await this.prisma.webhookEndpoint.create({
      data: { userId, url: dto.url, secret: hashed, events: dto.events },
    });

    // Plaintext secret returned once — never persisted
    return { ...endpoint, secret: plaintext };
  }

  findForUser(userId: string) {
    return this.prisma.webhookEndpoint.findMany({
      where: { userId },
      select: { id: true, url: true, events: true, active: true, createdAt: true },
    });
  }

  async remove(id: string, userId: string) {
    const ep = await this.prisma.webhookEndpoint.findFirst({ where: { id, userId } });
    if (!ep) throw new NotFoundException('Webhook endpoint not found');
    return this.prisma.webhookEndpoint.delete({ where: { id } });
  }

  async dispatch(eventType: NotificationType, payload: Record<string, any>) {
    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { active: true, events: { has: eventType } },
    });
    await Promise.allSettled(endpoints.map((ep) => this.attempt(ep, eventType, payload, 1)));
  }

  private async attempt(
    ep: { id: string; url: string; secret: string },
    eventType: string,
    payload: Record<string, any>,
    attemptNumber: number,
  ) {
    const body = JSON.stringify({ eventType, payload, timestamp: new Date().toISOString() });
    const signature = `sha256=${crypto.createHmac('sha256', ep.secret).update(body).digest('hex')}`;

    const delivery = await this.prisma.webhookDelivery.create({
      data: { endpointId: ep.id, eventType, payload, attemptCount: attemptNumber },
    });

    try {
      const res = await axios.post(ep.url, body, {
        headers: { 'Content-Type': 'application/json', 'X-ChainSettle-Signature': signature },
        timeout: 10_000,
      });

      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          statusCode: res.status,
          responseBody: String(res.data ?? '').slice(0, 1000),
          deliveredAt: new Date(),
        },
      });
    } catch (err) {
      const statusCode: number | null = err.response?.status ?? null;
      const responseBody = String(err.response?.data ?? err.message ?? '').slice(0, 1000);

      if (attemptNumber < MAX_ATTEMPTS) {
        const delayMs = 2 ** attemptNumber * 5_000; // 10 s, 20 s
        const nextRetryAt = new Date(Date.now() + delayMs);

        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { statusCode, responseBody, nextRetryAt },
        });

        setTimeout(() => this.attempt(ep, eventType, payload, attemptNumber + 1), delayMs);
      } else {
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { statusCode, responseBody },
        });
        this.logger.warn(`Webhook ${ep.id} failed after ${MAX_ATTEMPTS} attempts`);
      }
    }
  }
}
