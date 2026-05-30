-- Migration: add_event_cursor_and_ledger_index
-- Adds the EventCursor singleton table, a ledger index on chain_events,
-- and a unique constraint on (txHash, eventName) for idempotent upserts.

-- CreateTable: event_cursors
-- Singleton table (always one row with id = 'main') that persists the
-- last successfully processed Stellar ledger so the event poller can
-- resume after any restart without skipping or replaying ledgers.
CREATE TABLE "event_cursors" (
    "id"                  TEXT         NOT NULL,
    "lastProcessedLedger" INTEGER      NOT NULL,
    "updatedAt"           TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: chain_events ledger index
-- Supports efficient range queries used by the event poller
-- (SELECT … WHERE ledger > :lastProcessedLedger).
CREATE INDEX "chain_events_ledger_idx" ON "chain_events"("ledger");

-- CreateUniqueIndex: (txHash, eventName) on chain_events
-- Ensures each on-chain event is stored at most once, enabling
-- idempotent upserts in EventsService.saveRawEvent().
CREATE UNIQUE INDEX "chain_events_txHash_eventName_key"
    ON "chain_events"("txHash", "eventName");
