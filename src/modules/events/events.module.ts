// events.module.ts
import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { MilestonesModule } from '../milestones/milestones.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ShipmentsModule } from '../shipments/shipments.module';

@Module({
  imports: [MilestonesModule, NotificationsModule, ShipmentsModule],
  providers: [EventsService],
  controllers: [EventsController],
})
export class EventsModule {}
