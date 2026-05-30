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
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

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

  @ApiProperty({ example: 'GABC...buyer' })
  @IsString()
  @IsNotEmpty()
  buyerAddress: string;

  @ApiProperty({ example: 'GABC...supplier' })
  @IsString()
  @IsNotEmpty()
  supplierAddress: string;

  @ApiProperty({ example: 'GABC...logistics' })
  @IsString()
  @IsNotEmpty()
  logisticsAddress: string;

  @ApiProperty({ example: 'GABC...arbiter' })
  @IsString()
  @IsNotEmpty()
  arbiterAddress: string;

  @ApiProperty({ example: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA' })
  @IsString()
  @IsNotEmpty()
  tokenAddress: string;

  @ApiProperty({ example: '1000000000', description: 'Total USDC in stroops (7 decimal places)' })
  @IsString()
  @IsNotEmpty()
  totalAmount: string;

  @ApiProperty({ type: [MilestoneDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MilestoneDto)
  milestones: MilestoneDto[];

  @ApiProperty({ required: false, description: 'On-chain transaction hash of the create_shipment call' })
  @IsOptional()
  @IsString()
  txHash?: string;
}
