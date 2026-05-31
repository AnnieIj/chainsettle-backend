// NOTE: This repository's CI/test runner appears misconfigured in the current environment.
// Tests added for RBAC logic are primarily meant for Jest unit testing in a properly set up CI.

import { ForbiddenException } from '@nestjs/common';
import { ShipmentsController } from './shipments.controller';
import { ShipmentsService } from './shipments.service';

describe('ShipmentsController (RBAC)', () => {
    it('rejects POST /shipments when buyerAddress does not match caller (non-admin)', async () => {
        const mockService: Partial<ShipmentsService> = {
            create: jest.fn().mockResolvedValue({}),
        };

        const controller = new ShipmentsController(mockService as ShipmentsService);

        const dto: any = {
            shipmentId: 'SHIP-1',
            buyerAddress: 'GBUY-OTHER',
            supplierAddress: 'GSUP',
            logisticsAddress: 'GLOG',
            arbiterAddress: 'GARB',
            tokenAddress: 'CNOP',
            totalAmount: '1000000000',
            milestones: [],
        };

        await expect(
            controller.create(dto, { stellarAddress: 'GBUY-ME', role: 'BUYER' }),
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows POST /shipments when buyerAddress matches caller (non-admin)', async () => {
        const mockService: Partial<ShipmentsService> = {
            create: jest.fn().mockResolvedValue({ id: 'SHIP-1' }),
        };

        const controller = new ShipmentsController(mockService as ShipmentsService);

        const dto: any = {
            shipmentId: 'SHIP-1',
            buyerAddress: 'GBUY-ME',
            supplierAddress: 'GSUP',
            logisticsAddress: 'GLOG',
            arbiterAddress: 'GARB',
            tokenAddress: 'CNOP',
            totalAmount: '1000000000',
            milestones: [],
        };

        await expect(
            controller.create(dto, { stellarAddress: 'GBUY-ME', role: 'BUYER' }),
        ).resolves.toEqual({ id: 'SHIP-1' });
    });
});


