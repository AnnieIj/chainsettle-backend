import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { ShipmentsService } from './shipments.service';
import { CreateShipmentDto, UpdateShipmentDto } from './dto/create-shipment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShipmentStatus } from '@prisma/client';

@ApiTags('shipments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipments')
export class ShipmentsController {
  constructor(private readonly shipmentsService: ShipmentsService) {}

  /**
   * POST /api/v1/shipments
   * Called by the frontend after the buyer has signed and broadcast
   * the create_shipment transaction via Freighter. The backend stores
   * the off-chain metadata and links it to the on-chain shipment.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a newly created on-chain shipment' })
  @ApiResponse({ status: 201, description: 'Shipment registered successfully' })
  create(@Body() dto: CreateShipmentDto, @CurrentUser() user: any) {
    return this.shipmentsService.create(dto);
  }

  /**
   * GET /api/v1/shipments
   * List shipments with optional filters. Users see only their own shipments.
   */
  @Get()
  @ApiOperation({ summary: 'List shipments with filters and pagination' })
  @ApiQuery({ name: 'buyerAddress', required: false })
  @ApiQuery({ name: 'supplierAddress', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ShipmentStatus })
  @ApiQuery({ name: 'referenceNumber', required: false })
  @ApiQuery({ name: 'tags', required: false, description: 'Comma-separated tags' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findAll(
    @Query('buyerAddress') buyerAddress?: string,
    @Query('supplierAddress') supplierAddress?: string,
    @Query('status') status?: ShipmentStatus,
    @Query('referenceNumber') referenceNumber?: string,
    @Query('tags') tagsQuery?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const tags = tagsQuery ? tagsQuery.split(',').map(t => t.trim()) : undefined;
    return this.shipmentsService.findAll({
      buyerAddress,
      supplierAddress,
      status,
      referenceNumber,
      tags,
      page,
      limit,
    });
  }

  /**
   * GET /api/v1/shipments/:id
   * Full shipment detail including milestones and recent on-chain events.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get full shipment details including milestones and events' })
  @ApiResponse({ status: 200, description: 'Shipment found' })
  @ApiResponse({ status: 404, description: 'Shipment not found' })
  findOne(@Param('id') id: string) {
    return this.shipmentsService.findOne(id);
  }

  /**
   * PATCH /api/v1/shipments/:id
   * Update shipment metadata (description, referenceNumber, metadata, tags).
   * Only the buyer can update. Financial fields are immutable.
   */
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update shipment metadata (description, reference, metadata, tags)' })
  @ApiResponse({ status: 200, description: 'Shipment updated successfully' })
  @ApiResponse({ status: 403, description: 'Only buyer can update' })
  @ApiResponse({ status: 409, description: 'Reference number already in use' })
  update(@Param('id') id: string, @Body() dto: UpdateShipmentDto, @CurrentUser() user: any) {
    return this.shipmentsService.update(id, user.stellarAddress, dto);
  }

  /**
   * POST /api/v1/shipments/:id/sync
   * Manually trigger a sync of the shipment state from the Stellar chain.
   */
  @Post(':id/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Force sync shipment status from Stellar chain' })
  sync(@Param('id') id: string) {
    return this.shipmentsService.syncStatusFromChain(id);
  }
}
