-- AlterTable: add archivedAt to shipments (issue #111)
ALTER TABLE "shipments" ADD COLUMN "archivedAt" TIMESTAMP(3);
