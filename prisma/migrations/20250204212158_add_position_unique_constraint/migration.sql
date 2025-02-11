/*
  Warnings:

  - A unique constraint covering the columns `[dtfId,userAddress,isYesPosition]` on the table `Position` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Position_dtfId_userAddress_isYesPosition_key" ON "Position"("dtfId", "userAddress", "isYesPosition");
