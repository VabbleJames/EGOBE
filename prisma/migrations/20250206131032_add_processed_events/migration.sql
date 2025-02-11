-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "id" SERIAL NOT NULL,
    "eventType" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedEvent_eventType_transactionHash_key" ON "ProcessedEvent"("eventType", "transactionHash");
