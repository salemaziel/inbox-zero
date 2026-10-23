"use server";

import { cookies } from "next/headers";
import { env } from "@/env";
import { actionClient } from "@/utils/actions/safe-action";
import {
  completeIntegrationTokenRedirectBody,
  connectIntegrationWithTokenBody,
  startIntegrationTokenRedirectBody,
} from "@/utils/actions/integrations.validation";
import {
  completeTokenRedirect,
  connectWithToken,
  createTokenRedirect,
  getTokenRedirectCookieName,
} from "@/utils/integrations/connection.server";
import { oauthStateCookieOptions } from "@/utils/oauth/state";

export const connectIntegrationWithTokenAction = actionClient
  .metadata({ name: "connectIntegrationWithToken" })
  .inputSchema(connectIntegrationWithTokenBody)
  .action(
    async ({
      ctx: { emailAccountId, userId, logger },
      parsedInput: { integrationName, token },
    }) => {
      await connectWithToken({
        userId,
        emailAccountId,
        integrationName,
        token,
        logger,
      });
    },
  );

export const startIntegrationTokenRedirectAction = actionClient
  .metadata({ name: "startIntegrationTokenRedirect" })
  .inputSchema(startIntegrationTokenRedirectBody)
  .action(
    async ({
      ctx: { emailAccountId, userId, logger },
      parsedInput: { integrationName },
    }) => {
      const { url, state, cookieName } = await createTokenRedirect({
        userId,
        emailAccountId,
        integrationName,
        baseUrl: env.NEXT_PUBLIC_BASE_URL,
        logger,
      });

      const cookieStore = await cookies();
      cookieStore.set(cookieName, state, oauthStateCookieOptions);

      return { url };
    },
  );

export const completeIntegrationTokenRedirectAction = actionClient
  .metadata({ name: "completeIntegrationTokenRedirect" })
  .inputSchema(completeIntegrationTokenRedirectBody)
  .action(
    async ({
      ctx: { emailAccountId, userId, logger },
      parsedInput: { integrationName, state, token },
    }) => {
      const cookieStore = await cookies();
      const cookieName = getTokenRedirectCookieName(integrationName);
      const cookieState = cookieStore.get(cookieName)?.value;

      // One attempt per state, whether or not the token turns out to be valid
      cookieStore.delete(cookieName);

      await completeTokenRedirect({
        userId,
        emailAccountId,
        integrationName,
        state,
        cookieState,
        token,
        logger,
      });
    },
  );
