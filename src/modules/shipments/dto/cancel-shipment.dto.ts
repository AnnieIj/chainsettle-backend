import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelShipmentDto {
  @ApiProperty({ example: 'abc123...txhash', description: 'On-chain transaction hash of the cancel/refund call' })
  @IsString()
  @IsNotEmpty()
  txHash: string;
}
