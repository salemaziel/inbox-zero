# Nouns Index (`map/objects/_index.md`)

| Noun | Cluster | Universe | Status | Description |
|---|---|---|---|---|
| [`EmailAccount`](./mail/EmailAccount.md) | `mail` | live | verified | Linked mailbox credentials, provider connection, and sync state |
| [`EmailMessage`](./mail/EmailMessage.md) | `mail` | live | verified | Normalized email message representation across providers |
| [`Label`](./mail/Label.md) | `mail` | live | stub | Mailbox tag/folder abstraction mapped to provider labels |
| [`ThreadTracker`](./mail/ThreadTracker.md) | `mail` | live | stub | Tracking metadata for thread conversation states and reminders |
| [`MailSplit`](./mail/MailSplit.md) | `mail` | live | stub | Custom inbox split view filters and grouping rules |
| [`EmailProvider`](./mail/EmailProvider.md) | `mail` | live | verified | Core interface abstraction unifying Google, Microsoft, and generic IMAP |
| [`Rule`](./rules/Rule.md) | `rules` | live | verified | Automated user rule definition matching incoming messages |
| [`Action`](./rules/Action.md) | `rules` | live | verified | Executable action triggered by a rule match |
| [`RuleHistory`](./rules/RuleHistory.md) | `rules` | live | stub | Audit log of executed rule runs and actions |
| [`AutomationJob`](./rules/AutomationJob.md) | `rules` | live | verified | Scheduled automation job and background task definition |
| [`ScheduledAction`](./rules/ScheduledAction.md) | `rules` | live | stub | Deferred action execution scheduled for a future timestamp |
| [`ScheduledEmail`](./rules/ScheduledEmail.md) | `rules` | live | stub | Outbound email scheduled to be sent at a specific time |
| [`Category`](./triage/Category.md) | `triage` | live | stub | Email categorization label (Newsletter, Receipt, Cold, etc.) |
| [`Newsletter`](./triage/Newsletter.md) | `triage` | live | stub | Detected subscription/newsletter sender with unsubscribe state |
| [`ColdEmail`](./triage/ColdEmail.md) | `triage` | live | stub | Detected cold outreach email with review status |
| [`Digest`](./triage/Digest.md) | `triage` | live | stub | Compiled summary digest of low-priority or bulk emails |
| [`ClassificationFeedback`](./triage/ClassificationFeedback.md) | `triage` | live | stub | User feedback loop for AI and rule-based classifications |
| [`CleanupJob`](./triage/CleanupJob.md) | `triage` | live | stub | Bulk inbox cleanup run configuration and progress tracker |
| [`Chat`](./ai/Chat.md) | `ai` | live | stub | AI assistant conversation thread |
| [`ChatMessage`](./ai/ChatMessage.md) | `ai` | live | stub | Individual turn/message in an AI assistant chat |
| [`ChatMemory`](./ai/ChatMemory.md) | `ai` | live | stub | Long-term memory and preferences extracted for AI interactions |
| [`Knowledge`](./ai/Knowledge.md) | `ai` | live | stub | Context knowledge base documents injected into assistant prompts |
| [`Snippet`](./ai/Snippet.md) | `ai` | live | stub | Reusable email reply template/snippet |
| [`ReplyMemory`](./ai/ReplyMemory.md) | `ai` | live | stub | Sender-specific tone and context memory for reply generation |
| [`CalendarConnection`](./calendar/CalendarConnection.md) | `calendar` | live | stub | External calendar OAuth sync connection |
| [`BookingLink`](./calendar/BookingLink.md) | `calendar` | live | stub | Shareable scheduling link for calendar meetings |
| [`Booking`](./calendar/Booking.md) | `calendar` | live | stub | Scheduled meeting instance created via booking link |
| [`Meeting`](./calendar/Meeting.md) | `calendar` | live | stub | Calendar event with participants, transcript, and briefing |
| [`User`](./auth/User.md) | `auth` | live | stub | Registered application user |
| [`Account`](./auth/Account.md) | `auth` | live | stub | OAuth identity provider credential account |
| [`Session`](./auth/Session.md) | `auth` | live | stub | Authenticated active user session |
| [`Organization`](./auth/Organization.md) | `auth` | live | stub | Multi-tenant team workspace organization |
| [`Member`](./auth/Member.md) | `auth` | live | stub | Membership association between a user and an organization |
| [`ApiKey`](./auth/ApiKey.md) | `auth` | live | stub | Programmatic API access key |

