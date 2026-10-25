# app/(app)/[emailAccountId]/onboarding

**Parent context:** `../AGENTS.md`
**Generated:** 2026-10-23 · **Updated:** 2026-10-23

## Purpose

The first-run flow after sign-up. A short survey, then an intent question that splits users into two branches: AI assistant setup (sort emails, draft replies, bulk unsubscribe, labels, custom rules, invite team) or the mail-app path (one step). The flow is a list of step keys, and the current step is chosen by the `?step=` query parameter.

## Key Files

| File | Description |
| --- | --- |
| `page.tsx` | Server page. Reads `step` and `force` from search params, records UTM values (`registerUtmTracking`), loads `signupIntent` from the user, and redirects `briefmymeeting` signups to `../onboarding-brief` unless `force` or `step` is set. `maxDuration = 300`. |
| `onboardingFlow.ts` | Source of truth for step order. `STEP_KEYS`, `getVisibleOnboardingStepKeys`, `getOnboardingStepHref`, `getOnboardingStepIndex`, `isDraftRepliesDisabledByRuleState`. |
| `onboardingFlow.test.ts` | Tests the step order and filtering. |
| `Onboarding.tsx` | Thin client wrapper around `OnboardingContent`. |
| `OnboardingContent.tsx`, `OnboardingContent.test.tsx` | Renders the current step, navigation, and progress. Maps step keys to `Step*.tsx` components. |
| `useCompleteOnboarding.ts` | Calls `completedOnboardingAction`, sets the completion cookie, and redirects: mail app for mail-client users, otherwise setup or the premium page when not premium. |
| `config.ts` | `usersRolesInfo`: role icons and suggested labels for the labels step. |
| `OnboardingWrapper.tsx`, `OnboardingFeatureStep.tsx`, `OnboardingButton.tsx`, `ContinueButton.tsx`, `IconCircle.tsx` | Shared layout and buttons. |
| `Step*.tsx` | One component per step (Who, CompanySize, HowYouHeard, Intent, EmailsSorted, Chat, DraftReplies, BulkUnsubscribe, Labels, Draft, CustomRules, InviteTeam, InboxProcessed, MailApp). |

## Subdirectories

| Directory | Description |
| --- | --- |
| `illustrations/` | Static illustration components for steps (`ChatIllustration`, `SplitInboxIllustration`, `DraftRepliesIllustration`, and others) plus `IllustrationWindow.tsx`. |

## For AI Agents

### Working In This Directory

- Add or reorder steps only in `onboardingFlow.ts`: add a `STEP_KEYS` entry, put it in the right order list (`surveyStepOrder`, `aiAssistantStepOrder`, `mailAppStepOrder`), then render it in `OnboardingContent.tsx`. The commented-out `FEATURES` entry is intentionally disabled.
- `legacyNumericOnboardingStepOrder` is frozen so old numeric `?step=N` links keep working. Never edit it.
- Visibility depends on `canInviteTeam`, `autoDraftDisabled`, `isSelfHosted`, and `signupIntent`. "Self-hosted" is detected as `NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS` being set, and skips the survey; no intent yet defaults to the AI branch.
- Links to a step must use `getOnboardingStepHref`, which builds the account-prefixed URL.
- Survey answers, signup intent, and completion go through server actions in `@/utils/actions/onboarding` (`saveOnboardingAnswersAction`, `saveSignupIntentAction`, `completedOnboardingAction`); the page itself holds no mutation logic.
- Landing analytics (`ConversionAnalyticsScript`, `ConversionQueryParamEvents`) are mounted on this page; keep them when editing `page.tsx`.
- The chat onboarding experiment lives on a parked branch (comment in `Onboarding.tsx`); do not revive it here.

### Testing Requirements

- `pnpm test "apps/web/app/(app)/[emailAccountId]/onboarding"` from repo root (runs `onboardingFlow.test.ts` and `OnboardingContent.test.tsx`).
- Add a case to `onboardingFlow.test.ts` for any change to step order or visibility.
- Browser check: `pnpm -F inbox-zero-ai test:playwright:emulated onboarding` (specs in `__tests__/playwright/emulated/onboarding`, for example `signup-intent-onboarding.spec.ts`). Grep for step titles there before renaming them.

### Common Patterns

- Step components receive navigation callbacks from `OnboardingContent` and call `useAction` for their own save.
- Pure flow logic is separate from React so it can be unit tested.

## Dependencies

### Internal

- `@/utils/actions/onboarding`, `@/utils/cookies`, `@/utils/path`, `@/hooks/usePremium`, `@/providers/EmailAccountProvider`, `@/components/ConversionAnalytics`, `@/app/(landing)/welcome/utms`, `@/generated/prisma/enums`.

### External

- `next-safe-action`, `lucide-react`.

## Manual Notes

Notes under this heading are written by humans and preserved on regeneration.
