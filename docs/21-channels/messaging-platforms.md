# Messaging Platform Assistants

## Purpose

Specifies the Channel Adapter abstraction that lets NOVA be reached
through Telegram, Discord, WhatsApp, and any future messaging platform,
without NOVA Core containing platform-specific logic — the explicit
requirement being "not only Telegram, any other platform I need should be
accessible."

## Scope

The channel abstraction and the three initial adapters. Voice-call
channels are `phone-calls.md`; email is `email-assistant.md`.

## Channel Adapter interface

A messaging platform is registered as a Provider in the "Messaging
channel" domain (`docs/18-providers/provider-interface.md`), implementing:

```
interface ChannelAdapter extends Provider {
  sendMessage(chatId, content): DeliveryReceipt
  onMessage(handler: (msg: InboundMessage) => void): void
  supportsMedia(): MediaCapabilities
  resolveIdentity(chatId): UserIdentityRef
}
```

Inbound messages are normalized into the same `InboundMessage` shape
regardless of platform (sender, chat context, text, attachments), and
handed to the Planner exactly as a desktop chat message would be — a
message arriving over Discord is not a distinct code path from one typed
into the desktop UI, per
`docs/15-decisions/adr-0008-v5-architecture-evolution.md`.

## Initial adapters

- **Telegram** — Bot API, long-poll or webhook; supports rich media,
  inline buttons for confirmation prompts (mapping
  `docs/10-security/permissions.md` confirmation UI onto Telegram's
  native inline-keyboard mechanism).
- **Discord** — bot user in user-authorized servers/DMs; same
  confirmation-prompt mapping onto Discord message components.
- **WhatsApp** — WhatsApp Business API; more limited rich-media/session
  rules (24-hour customer-service-window constraints) are surfaced to the
  Planner as a capability limit via `describe()`, so message-composition
  logic adapts rather than silently failing against WhatsApp's stricter
  policies.

## Adding a new platform

Because every adapter implements the same `ChannelAdapter` interface, a
new platform (Slack, iMessage, Signal, a future platform) is added as a
new adapter registered in the Messaging channel domain — never a NOVA
Core change. This is also the primary target of
`docs/23-autonomy/autonomous-plugin-discovery.md`: "I need Telegram" →
NOVA finds and proposes installing the Telegram adapter through this
same mechanism.

## Shared provider lifecycle

Every messaging adapter is also a Provider in the `messaging-channel` capability domain. Its descriptor is the source of truth for the adapter's provider ID, schema version, media/message capabilities, privacy class, cost, and latency metadata. Registration rejects adapters whose provider ID does not match the channel ID or whose domain is not `messaging-channel`; no platform SDK is imported into NOVA Core.

A registered adapter is live until explicit removal. Removal calls its terminal `shutdown()` lifecycle method before the manager forgets the adapter, and callbacks from a removed adapter are ignored. The shared `healthCheck()`, `invoke()`, `cancel()`, and `shutdown()` methods keep messaging providers compatible with the Capability Registry and common routing lifecycle.

## Identity and authorization

Each channel's `resolveIdentity()` maps a platform-specific
sender/chat ID to the single NOVA user identity
(`multi-device-architecture.md`) — a command arriving over Telegram is
authorized against the same permission configuration as any other
surface, not a separate, looser policy. Unrecognized senders (e.g., a
Telegram message from someone other than the configured owner) are never
treated as authorized commands, only optionally logged.

## Runtime authorization and diagnostics

The Channel Manager resolves the inbound sender identity before dispatching any message to subscribers or the Planner path. An unrecognized or unauthorized sender is rejected with the same security denial used for outbound channel commands; it is never normalized and forwarded as an authorized command. Adapter callbacks and direct runtime receives use the same authorization boundary.

Outbound sends likewise resolve the destination identity before invoking the adapter. Successful, rejected, and failed channel boundaries emit local structured diagnostics containing only the channel identifier, stable reason/status, and bounded attachment counts. Message text, sender identifiers, chat identifiers, attachments, credentials, and delivery content are never written to diagnostics.

## Related documents

- `docs/25-failure-modes/FM-11-internet-and-external-apis.md` — failure modes for this subsystem
- `docs/18-providers/provider-interface.md` — the Provider contract
  channel adapters implement
- `docs/23-autonomy/autonomous-plugin-discovery.md` — self-service
  addition of new channels
- `docs/10-security/permissions.md` — confirmation-gate mapping onto
  each platform's native UI primitives
- `docs/21-channels/channel-adapter-expansion.md` — the Slack/email/
  Signal/iMessage/Matrix adapters built against this document's
  unchanged interface
- `docs/24-collaboration/specialist-delegation.md` — @mention routing to
  a specific spawned agent, layered on top of this interface
