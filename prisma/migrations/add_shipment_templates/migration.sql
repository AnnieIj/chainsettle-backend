-- CreateTable
CREATE TABLE "shipment_templates" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "supplierAddress" TEXT,
    "logisticsAddress" TEXT,
    "arbiterAddress" TEXT,
    "tokenAddress" TEXT,
    "milestoneTemplates" JSONB NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipment_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipment_templates_ownerId_idx" ON "shipment_templates"("ownerId");

-- CreateIndex
CREATE INDEX "shipment_templates_isPublic_idx" ON "shipment_templates"("isPublic");

-- AddForeignKey
ALTER TABLE "shipment_templates" ADD CONSTRAINT "shipment_templates_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
