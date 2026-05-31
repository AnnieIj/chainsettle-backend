import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ShipmentParticipantGuard } from './shipment-participant.guard';
import { UserRole } from '@prisma/client';

describe('ShipmentParticipantGuard', () => {
    const mockPrisma = {
        shipment: {
            findUnique: jest.fn(),
        },
    };

    const makeContext = (params: any, user: any): ExecutionContext => {
        const req = { params, user };

        return {
            switchToHttp: () => ({
                getRequest: () => req,
            }),
        } as any;
    };

    let guard: ShipmentParticipantGuard;

    beforeEach(() => {
        jest.clearAllMocks();
        guard = new ShipmentParticipantGuard(mockPrisma as any as PrismaService, new Reflector());
    });

    it('allows ADMIN bypass', async () => {
        const ctx = makeContext({ id: 'SHIP-1' }, { stellarAddress: 'GADMIN', role: UserRole.ADMIN });
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('allows when caller is a participant', async () => {
        mockPrisma.shipment.findUnique.mockResolvedValue({
            buyerAddress: 'GBUY',
            supplierAddress: 'GSUP',
            logisticsAddress: 'GLOG',
            arbiterAddress: 'GARB',
        });

        const ctx = makeContext(
            { id: 'SHIP-1' },
            { stellarAddress: 'GSUP', role: UserRole.SUPPLIER },
        );

        await expect(guard.canActivate(ctx)).resolves.toBe(true);
        expect(mockPrisma.shipment.findUnique).toHaveBeenCalled();
    });

    it('throws ForbiddenException when caller is not a participant', async () => {
        mockPrisma.shipment.findUnique.mockResolvedValue({
            buyerAddress: 'GBUY',
            supplierAddress: 'GSUP',
            logisticsAddress: 'GLOG',
            arbiterAddress: 'GARB',
        });

        const ctx = makeContext(
            { id: 'SHIP-1' },
            { stellarAddress: 'GNOBODY', role: UserRole.BUYER },
        );

        await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });
});

