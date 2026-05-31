// shipments.module.ts
import { Module } from '@nestjs/common';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';
import { ShipmentParticipantGuard } from './guards/shipment-participant.guard';

@Module({
  controllers: [ShipmentsController],
  providers: [ShipmentsService, ShipmentParticipantGuard],
  exports: [ShipmentsService],
})
export class ShipmentsModule { }


