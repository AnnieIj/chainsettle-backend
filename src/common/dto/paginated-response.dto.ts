import { ApiProperty } from '@nestjs/swagger';

/**
 * Pagination metadata returned alongside every paginated list endpoint.
 */
export class PaginationMetaDto {
  @ApiProperty({
    description: 'Total number of records matching the query',
    example: 120,
  })
  total: number;

  @ApiProperty({
    description: 'Current page (1-indexed)',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Maximum records per page',
    example: 20,
  })
  limit: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 6,
  })
  totalPages: number;
}

/**
 * Generic paginated wrapper.
 *
 * NestJS Swagger cannot directly handle TypeScript generics, so each module
 * creates a concrete subclass via `PaginatedResponseDto.of(ItemClass)`.
 *
 * Usage:
 *   const PaginatedShipments = PaginatedResponseDto.of(ShipmentResponseDto);
 *   // then use PaginatedShipments as the `type` in @ApiResponse
 */
export function PaginatedResponseDto<TItem>(ItemClass: new (...args: any[]) => TItem) {
  class PaginatedResponse {
    @ApiProperty({
      description: 'Array of items for the current page',
      type: () => ItemClass,
      isArray: true,
    })
    data: TItem[];

    @ApiProperty({ type: () => PaginationMetaDto })
    meta: PaginationMetaDto;
  }

  // Give the class a unique, readable name so Swagger generates distinct schema keys
  Object.defineProperty(PaginatedResponse, 'name', {
    value: `Paginated${ItemClass.name}`,
  });

  return PaginatedResponse;
}