-- AlterTable
ALTER TABLE "shipments" ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "refundTxHash" TEXT;
