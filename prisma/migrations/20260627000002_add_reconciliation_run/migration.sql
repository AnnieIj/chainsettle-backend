-- CreateTable: reconciliation_runs (issue #109)
CREATE TABLE "reconciliation_runs" (
    "id"            TEXT NOT NULL,
    "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"   TIMESTAMP(3),
    "checkedCount"  INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "errors"        JSONB,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);
