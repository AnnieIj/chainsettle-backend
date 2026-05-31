import { Module } from '@nestjs/common';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [ShipmentsController, CommentsController],
  providers: [ShipmentsService, CommentsService],
  exports: [ShipmentsService],
})
export class ShipmentsModule { }


