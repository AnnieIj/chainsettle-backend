import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsISO8601,
  MaxLength,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
// Add the import for your custom validator
import { IsMilestoneSumValid } from '../../../common/validators/milestone-sum.validator';

export class MilestoneDto {
  @ApiProperty({ example: 'Goods Dispatched' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 25, description: 'Payment percentage (all must sum to 100)' })
  @IsInt()
  @Min(1)
  @Max(100)
  paymentPercent: number;

  @ApiProperty({ required: false, example: '2026-06-30T23:59:59Z', description: 'Optional milestone deadline (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  dueAt?: string;
}

export class CreateShipmentDto {
  @ApiProperty({ example: 'SHIP-2026-001' })
  @IsString()
  @IsNotEmpty()
  shipmentId: string;

  @ApiProperty({ required: false, example: 'template-uuid', description: 'Optional template ID to pre-populate from' })
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiProperty({ example: 'GABC...buyer' })
  @IsString()
  @IsNotEmpty()
  buyerAddress: string;

  @ApiProperty({ example: 'GABC...supplier', required: false })
  @IsOptional()
  @IsString()
  supplierAddress?: string;

  @ApiProperty({ example: 'GABC...logistics', required: false })
  @IsOptional()
  @IsString()
  logisticsAddress?: string;

  @ApiProperty({ example: 'GABC...arbiter', required: false })
  @IsOptional()
  @IsString()
  arbiterAddress?: string;

  @ApiProperty({ example: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA', required: false })
  @IsOptional()
  @IsString()
  tokenAddress?: string;

  @ApiProperty({ type: [MilestoneDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MilestoneDto)
  @IsMilestoneSumValid() // <-- The new cross-field validation is applied here
  milestones?: MilestoneDto[];

  @ApiProperty({ example: '1000000000', description: 'Total USDC in stroops (7 decimal places)' })
  @IsString()
  @IsNotEmpty()
  totalAmount: string;

  @ApiProperty({ required: false, description: 'On-chain transaction hash of the create_shipment call' })
  @IsOptional()
  @IsString()
  txHash?: string;

  @ApiProperty({ required: false, example: 'Electronics shipment from China', description: 'Human-readable description of shipment contents (max 1000 chars)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ required: false, example: 'PO-2026-001', description: 'Contract/PO reference number (must be unique)' })
  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @ApiProperty({ required: false, example: { incoterms: 'FOB', portOfLoading: 'Lagos' }, description: 'Arbitrary key-value metadata' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiProperty({ required: false, example: ['urgent', 'fragile'], description: 'Searchable tags' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateShipmentDto {
  @ApiProperty({ required: false, example: 'Electronics shipment from China', description: 'Human-readable description (max 1000 chars)' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ required: false, example: 'PO-2026-001', description: 'Contract/PO reference number (must be unique)' })
  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @ApiProperty({ required: false, example: { incoterms: 'FOB', portOfLoading: 'Lagos' }, description: 'Arbitrary key-value metadata' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiProperty({ required: false, example: ['urgent', 'fragile'], description: 'Searchable tags' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}