-- CreateTable
CREATE TABLE "User" (
    "address" TEXT NOT NULL,
    "firstTradeDate" TIMESTAMP(3),
    "totalVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("address")
);

-- CreateTable
CREATE TABLE "DTF" (
    "id" INTEGER NOT NULL,
    "creatorAddress" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expiryTime" TIMESTAMP(3) NOT NULL,
    "targetValuation" DOUBLE PRECISION NOT NULL,
    "isTargetHigher" BOOLEAN NOT NULL,
    "isSettled" BOOLEAN NOT NULL DEFAULT false,
    "tokensWithdrawn" BOOLEAN NOT NULL DEFAULT false,
    "yesTokenAddress" TEXT NOT NULL,
    "noTokenAddress" TEXT NOT NULL,
    "yesPool" DOUBLE PRECISION NOT NULL,
    "noPool" DOUBLE PRECISION NOT NULL,
    "distributionPool" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DTF_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DTFToken" (
    "id" SERIAL NOT NULL,
    "dtfId" INTEGER NOT NULL,
    "tokenAddress" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "DTFToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" SERIAL NOT NULL,
    "userAddress" TEXT NOT NULL,
    "dtfId" INTEGER NOT NULL,
    "isYesPosition" BOOLEAN NOT NULL,
    "shareAmount" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "dtfId" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "blockNumber" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserStatistics" (
    "userAddress" TEXT NOT NULL,
    "totalTrades" INTEGER NOT NULL DEFAULT 0,
    "winningTrades" INTEGER NOT NULL DEFAULT 0,
    "totalVolume" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalProfitLoss" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserStatistics_pkey" PRIMARY KEY ("userAddress")
);

-- AddForeignKey
ALTER TABLE "DTF" ADD CONSTRAINT "DTF_creatorAddress_fkey" FOREIGN KEY ("creatorAddress") REFERENCES "User"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DTFToken" ADD CONSTRAINT "DTFToken_dtfId_fkey" FOREIGN KEY ("dtfId") REFERENCES "DTF"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_userAddress_fkey" FOREIGN KEY ("userAddress") REFERENCES "User"("address") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_dtfId_fkey" FOREIGN KEY ("dtfId") REFERENCES "DTF"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_dtfId_fkey" FOREIGN KEY ("dtfId") REFERENCES "DTF"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserStatistics" ADD CONSTRAINT "UserStatistics_userAddress_fkey" FOREIGN KEY ("userAddress") REFERENCES "User"("address") ON DELETE RESTRICT ON UPDATE CASCADE;
