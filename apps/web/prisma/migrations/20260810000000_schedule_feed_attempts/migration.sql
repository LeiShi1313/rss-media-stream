-- AlterTable
ALTER TABLE "RssFeed" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "RssFeed_nextAttemptAt_idx" ON "RssFeed"("nextAttemptAt");
