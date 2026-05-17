import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';

import { PrismaModule } from './common/prisma/prisma.module';
import { StellarModule } from './common/stellar/stellar.module';

import { AuthModule } from './modules/auth/auth.module';
import { ShipmentsModule } from './modules/shipments/shipments.module';
import { MilestonesModule } from './modules/milestones/milestones.module';
import { EventsModule } from './modules/events/events.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    // Config — loads .env and makes ConfigService available everywhere
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Rate limiting — protects all routes
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLE_TTL', 60) * 1000,
          limit: config.get<number>('THROTTLE_LIMIT', 100),
        },
      ],
    }),

    // Cron jobs — for Stellar event polling
    ScheduleModule.forRoot(),

    // Terminus health checks
    TerminusModule,

    // Shared infrastructure
    PrismaModule,
    StellarModule,

    // Feature modules
    AuthModule,
    ShipmentsModule,
    MilestonesModule,
    EventsModule,
    NotificationsModule,
    HealthModule,
  ],
})
export class AppModule {}
