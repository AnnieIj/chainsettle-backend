import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'GABC...XYZ', description: 'Stellar public key' })
  @IsString()
  @IsNotEmpty()
  stellarAddress: string;

  @ApiProperty({ description: 'The nonce returned from GET /auth/nonce' })
  @IsString()
  @IsNotEmpty()
  signedNonce: string;

  @ApiProperty({ description: 'Base64-encoded Stellar signature of the nonce' })
  @IsString()
  @IsNotEmpty()
  signature: string;
}
