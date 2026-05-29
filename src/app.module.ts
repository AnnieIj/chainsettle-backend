import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { APP_GUARD } from '@nestjs/core';

import { PrismaModule } from './common/prisma/prisma.module';
import { StellarModule } from './common/stellar/stellar.module';
import { RedisModule } from './common/redis/redis.module';
import { RedisThrottlerStorageService } from './common/throttler/redis-throttler-storage.service';

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

    // Rate limiting — protects all routes with Redis storage for multi-pod consistency
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('THROTTLE_TTL', 60) * 1000,
            limit: config.get<number>('THROTTLE_LIMIT', 100),
          },
        ],
        storage: new RedisThrottlerStorageService(config),
      }),
    }),

    // Cron jobs — for Stellar event polling
    ScheduleModule.forRoot(),

    // Terminus health checks
    TerminusModule,

    // Shared infrastructure
    PrismaModule,
    StellarModule,
    RedisModule,

    // Feature modules
    AuthModule,
    ShipmentsModule,
    MilestonesModule,
    EventsModule,
    NotificationsModule,
    HealthModule,
  ],
  providers: [
    // Apply global throttler guard (can be overridden per route)
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
