import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Represents a single on-chain event as returned by the API.
 *
 * ChainEvents are immutable records of Ethereum / EVM transactions that
 * affected a shipment's smart contract (e.g. escrow funded, milestone
 * confirmed, dispute raised).
 */
export class ChainEventResponseDto {
  @ApiProperty({
    description: 'Unique chain-event identifier (UUID)',
    example: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
  })
  id: string;

  @ApiProperty({
    description: 'UUID of the shipment this event belongs to',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  shipmentId: string;

  @ApiProperty({
    description: 'Ethereum transaction hash',
    example: '0x4e3a3754410177e6937ef1f84bba68ea139e8d1a0f4720d6f90b12e6a89b264d',
  })
  transactionHash: string;

  @ApiProperty({
    description: 'The Ethereum event name as emitted by the smart contract',
    example: 'MilestoneConfirmed',
    enum: [
      'EscrowFunded',
      'MilestoneConfirmed',
      'PaymentReleased',
      'DisputeRaised',
      'DisputeResolved',
      'ContractDeployed',
    ],
  })
  eventName: string;

  @ApiProperty({
    description: 'Block number in which this transaction was mined',
    example: 19823450,
  })
  blockNumber: number;

  @ApiProperty({
    description: 'Unix timestamp (seconds) of the block',
    example: 1711105200,
  })
  blockTimestamp: number;

  @ApiProperty({
    description: 'Ethereum address of the account that sent the transaction',
    example: '0x742d35Cc6634C0532925a3b8D4C9F5b6e0e3f2a1',
  })
  fromAddress: string;

  @ApiProperty({
    description: 'Ethereum address of the smart contract that emitted the event',
    example: '0x1234567890abcdef1234567890abcdef12345678',
  })
  contractAddress: string;

  @ApiPropertyOptional({
    description:
      'Key/value map of the decoded event arguments (ABI-decoded from the transaction log).',
    example: { milestoneIndex: '2', amount: '250000000000000000' },
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  eventData?: Record<string, unknown> | null;

  @ApiProperty({
    description: 'Whether this event has been fully processed by the backend',
    example: true,
  })
  processed: boolean;

  @ApiProperty({
    description: 'ISO-8601 timestamp when this event record was created',
    example: '2024-03-22T14:00:00.000Z',
  })
  createdAt: string;
}