import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmMilestoneDto {
  @ApiProperty({ description: 'On-chain transaction hash of the confirm_milestone call' })
  @IsString()
  @IsNotEmpty()
  txHash: string;

  @ApiProperty({ example: '1000000000', description: 'Amount released to the supplier, in stroops' })
  @IsString()
  @IsNotEmpty()
  paymentReleased: string;
}
