import { PageWrapper } from "@/components/PageWrapper";
import { TokenRedirectCapture } from "./TokenRedirectCapture";

export default async function ConnectIntegrationPage({
  params,
}: {
  params: Promise<{ integration: string }>;
}) {
  const { integration } = await params;

  return (
    <PageWrapper>
      <TokenRedirectCapture integrationName={integration} />
    </PageWrapper>
  );
}
