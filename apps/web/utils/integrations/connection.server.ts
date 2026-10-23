import "server-only";
import type { NativeConnection } from "@/utils/integrations/types";
import prisma from "@/utils/prisma";

export async function getActiveNativeConnection({
  emailAccountId,
  integrationName,
}: {
  emailAccountId: string;
  integrationName: string;
}): Promise<NativeConnection | null> {
  const connection = await prisma.mcpConnection.findFirst({
    where: {
      emailAccountId,
      isActive: true,
      integration: { name: integrationName },
    },
    select: { id: true, emailAccountId: true, accessToken: true },
  });

  if (!connection?.emailAccountId || !connection.accessToken) return null;

  return {
    id: connection.id,
    emailAccountId: connection.emailAccountId,
    accessToken: connection.accessToken,
  };
}

export async function deactivateIntegrationConnection({
  emailAccountId,
  integrationName,
}: {
  emailAccountId: string;
  integrationName: string;
}): Promise<void> {
  await prisma.mcpConnection.updateMany({
    where: { emailAccountId, integration: { name: integrationName } },
    data: { isActive: false },
  });
}
