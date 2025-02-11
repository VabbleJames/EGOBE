-- DropIndex
DROP INDEX "ProcessedEvent_eventType_transactionHash_key";

-- CreateIndex
CREATE INDEX "ProcessedEvent_eventType_transactionHash_idx" ON "ProcessedEvent"("eventType", "transactionHash");
