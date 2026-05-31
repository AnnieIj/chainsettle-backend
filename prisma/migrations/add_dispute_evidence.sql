-- Add DISPUTE_EVIDENCE_SUBMITTED to NotificationType enum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DISPUTE_EVIDENCE_SUBMITTED';

-- Create DisputeRole enum
CREATE TYPE "DisputeRole" AS ENUM ('BUYER', 'SUPPLIER');

-- Create dispute_evidence table
CREATE TABLE "dispute_evidence" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "role" "DisputeRole" NOT NULL,
    "description" TEXT NOT NULL,
    "ipfsCid" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE INDEX "dispute_evidence_milestoneId_idx" ON "dispute_evidence"("milestoneId");
CREATE INDEX "dispute_evidence_submittedBy_idx" ON "dispute_evidence"("submittedBy");

-- Add foreign keys
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_milestoneId_fkey" 
    FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_submittedBy_fkey" 
    FOREIGN KEY ("submittedBy") REFERENCES "users"("stellarAddress") ON UPDATE CASCADE;
