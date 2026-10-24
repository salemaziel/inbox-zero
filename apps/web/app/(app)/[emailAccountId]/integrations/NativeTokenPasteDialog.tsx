"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "next-safe-action/hooks";
import { Input } from "@/components/Input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toastError, toastSuccess } from "@/components/Toast";
import { useIntegrations } from "@/hooks/useIntegrations";
import { useAccount } from "@/providers/EmailAccountProvider";
import { connectIntegrationWithTokenAction } from "@/utils/actions/integrations";
import { connectIntegrationWithTokenBody } from "@/utils/actions/integrations.validation";
import { getActionErrorMessage } from "@/utils/error";
import type { z } from "zod";

const tokenFormSchema = connectIntegrationWithTokenBody.pick({ token: true });
type TokenFormValues = z.infer<typeof tokenFormSchema>;

export function NativeTokenPasteDialog({
  integrationName,
  displayName,
  open,
  onOpenChange,
}: {
  integrationName: string;
  displayName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { emailAccountId } = useAccount();
  const { mutate } = useIntegrations();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TokenFormValues>({
    resolver: zodResolver(tokenFormSchema),
    defaultValues: { token: "" },
  });

  const { execute, isExecuting } = useAction(
    connectIntegrationWithTokenAction.bind(null, emailAccountId),
    {
      onSuccess: () => {
        mutate();
        reset();
        onOpenChange(false);
        toastSuccess({ description: `Connected to ${displayName}` });
      },
      onError: (error) => {
        toastError({
          title: `Could not connect to ${displayName}`,
          description: getActionErrorMessage(error.error),
        });
      },
    },
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {displayName}</DialogTitle>
          <DialogDescription>
            Paste your {displayName} API token. It is saved to your account and
            is never shown again.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={handleSubmit(({ token }) =>
            execute({ integrationName, token }),
          )}
        >
          <Input
            type="password"
            name="token"
            label="API token"
            registerProps={register("token")}
            error={errors.token}
          />

          <DialogFooter>
            <Button type="submit" loading={isExecuting}>
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
