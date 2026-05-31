-- Migration: add_arbiter_status
-- Adds arbiter assignment workflow with acceptance confirmation.

-- CreateEnum: ArbiterStatus
CREATE TYPE "ArbiterStatus" AS ENUM ('PENDING_ACCEPTANCE', 'ACCEPTED', 'DECLINED');

-- AlterTable: shipments
-- Add arbiterStatus column with default PENDING_ACCEPTANCE
ALTER TABLE "shipments"
    ADD COLUMN "arbiterStatus" "ArbiterStatus" NOT NULL DEFAULT 'PENDING_ACCEPTANCE';

-- AlterEnum: NotificationType
-- Add ARBITER_INVITED, ARBITER_ACCEPTED, ARBITER_DECLINED values
ALTER TYPE "NotificationType" ADD VALUE 'ARBITER_INVITED';
ALTER TYPE "NotificationType" ADD VALUE 'ARBITER_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE 'ARBITER_DECLINED';
