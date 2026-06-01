import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class FindAllEventsDto {
  @ApiPropertyOptional({ 
    description: 'Filter events starting from this ledger index sequence', 
    example: 1000,
    type: Number
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  startLedger?: number;

  @ApiPropertyOptional({ 
    description: 'Filter events up to this ledger index sequence', 
    example: 2000,
    type: Number
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  endLedger?: number;

  @ApiPropertyOptional({ 
    description: 'Filter events matching a specific transaction or hook identifier name', 
    example: 'milestone_confirmed' 
  })
  @IsOptional()
  @IsString()
  eventName?: string;
}