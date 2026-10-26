-- CreateTable
CREATE TABLE "AiSubscriptionLogin" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "credential" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AiSubscriptionLogin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSubscriptionLogin_userId_provider_key" ON "AiSubscriptionLogin"("userId", "provider");

-- AddForeignKey
ALTER TABLE "AiSubscriptionLogin" ADD CONSTRAINT "AiSubscriptionLogin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
