import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class FindAllShipmentsDto {
  // Retain your existing query properties here (e.g., buyerAddress, supplierAddress, status)
  @ApiPropertyOptional({ description: 'Filter by buyer wallet address' })
  @IsOptional()
  @IsString()
  buyerAddress?: string;

  @ApiPropertyOptional({ description: 'Filter by supplier wallet address' })
  @IsOptional()
  @IsString()
  supplierAddress?: string;

  @ApiPropertyOptional({ description: 'Filter by shipment status' })
  @IsOptional()
  @IsString()
  status?: string;

  // New Date Filters
  @ApiPropertyOptional({ 
    description: 'Filter shipments created on or after this ISO date', 
    example: '2026-01-01T00:00:00.000Z' 
  })
  @IsOptional()
  @IsISO8601()
  createdAfter?: string;

  @ApiPropertyOptional({ 
    description: 'Filter shipments created on or before this ISO date', 
    example: '2026-03-31T23:59:59.999Z' 
  })
  @IsOptional()
  @IsISO8601()
  createdBefore?: string;

  @ApiPropertyOptional({ 
    description: 'Filter shipments updated on or after this ISO date', 
    example: '2026-01-01T00:00:00.000Z' 
  })
  @IsOptional()
  @IsISO8601()
  updatedAfter?: string;

  @ApiPropertyOptional({ 
    description: 'Filter shipments updated on or before this ISO date', 
    example: '2026-03-31T23:59:59.999Z' 
  })
  @IsOptional()
  @IsISO8601()
  updatedBefore?: string;
}