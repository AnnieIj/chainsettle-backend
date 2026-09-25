import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshDto {
    @ApiProperty({ description: 'Plaintext refresh token' })
    @IsString()
    @IsNotEmpty()
    refreshToken: string;
}

