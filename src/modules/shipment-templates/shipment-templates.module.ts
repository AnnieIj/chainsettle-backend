import { Module } from '@nestjs/common';
import { ShipmentTemplatesController } from './shipment-templates.controller';
import { ShipmentTemplatesService } from './shipment-templates.service';

@Module({
  controllers: [ShipmentTemplatesController],
  providers: [ShipmentTemplatesService],
  exports: [ShipmentTemplatesService],
})
export class ShipmentTemplatesModule {}
