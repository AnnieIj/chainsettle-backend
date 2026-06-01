import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Represents a single Milestone as returned by the API.
 *
 * Milestones are checkpoints inside a Shipment that gate the release of
 * portions of the escrow balance.  The `releaseAmount` field maps to an
 * on-chain uint256 and must therefore be serialised as a string.
 */
export class MilestoneResponseDto {
  @ApiProperty({
    description: 'Unique milestone identifier (UUID)',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @ApiProperty({
    description: 'UUID of the parent shipment',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  shipmentId: string;

  @ApiProperty({
    description: 'Descriptive title of the milestone',
    example: 'Customs clearance',
  })
  title: string;

  @ApiPropertyOptional({
    description: 'Longer description of what this milestone represents',
    example: 'Goods have passed customs inspection at the port of entry.',
  })
  description?: string;

  @ApiProperty({
    description: 'Current status of this milestone',
    example: 'PENDING',
    enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'],
  })
  status: string;

  /**
   * bigint → string
   * Amount of escrow to release when this milestone is confirmed on-chain.
   */
  @ApiProperty({
    type: String,
    description:
      'Escrow amount unlocked when this milestone is confirmed (wei). Serialised as string.',
    example: '250000000000000000',
  })
  releaseAmount: string;

  @ApiProperty({
    description: '1-indexed order of this milestone within the shipment',
    example: 2,
  })
  order: number;

  @ApiPropertyOptional({
    description: 'ISO-8601 timestamp when the milestone was completed',
    example: '2024-03-10T12:00:00.000Z',
    nullable: true,
  })
  completedAt?: string | null;

  @ApiPropertyOptional({
    description: 'ISO-8601 target completion date',
    example: '2024-03-15T00:00:00.000Z',
    nullable: true,
  })
  dueDate?: string | null;

  @ApiPropertyOptional({
    description: 'On-chain transaction hash that confirmed this milestone',
    example: '0xabc123...',
    nullable: true,
  })
  transactionHash?: string | null;

  @ApiProperty({
    description: 'ISO-8601 creation timestamp',
    example: '2024-01-20T09:00:00.000Z',
  })
  createdAt: string;

  @ApiProperty({
    description: 'ISO-8601 last-update timestamp',
    example: '2024-03-10T12:00:00.000Z',
  })
  updatedAt: string;
}