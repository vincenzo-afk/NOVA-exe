# Voice Assistant

## Purpose

Specifies always-listening, wake-word-activated, low-latency, interrupt
capable voice interaction as a first-class NOVA interface, addressing the
requirement for a "true voice assistant" — always listening, natural
conversation, interrupt while speaking, low latency, streaming voice.

## Scope

The voice interaction pipeline and its latency/interrupt requirements.
The underlying speech models are `local-speech-models.md`; provider
selection is `docs/18-providers/provider-routing.md`.

## Pipeline

```
Mic → Wake-word detector (always-on, local) → VAD (voice activity
detection) → Streaming STT → Planner (streaming-aware) → Streaming TTS →
Speaker
```

Every stage after wake-word detection is only active during an actual
utterance — "always listening" means the wake-word detector runs
continuously (fully local, minimal-resource, per
`local-speech-models.md`), not that raw audio is continuously sent to
STT or any cloud provider.

## Wake word

Wake-word detection runs on-device, always, regardless of the routing
policy configured for other capabilities — this is a `privacy-first`
requirement that is not overridable to cloud, since it is the one
component that must run continuously. Users configure the wake word
during the Setup Wizard (`docs/19-setup/setup-wizard.md`) and can add
custom wake phrases from Settings.

## Low latency and streaming

STT and TTS providers used for voice must support the `Stream<DomainChunk>` return type defined in `docs/18-providers/provider-interface.md` —
non-streaming providers can be used for other capabilities but are
excluded from the voice routing policy's candidate set, since round-trip
buffering defeats the responsiveness requirement. The generic provider
router enforces this at invocation time by requiring the `streaming`
capability and rejecting any adapter response that is not a real
`AsyncIterable`; it then continues through the finite fallback chain rather
than fabricating a stream. The Planner processes partial transcripts
incrementally where possible (e.g., beginning intent classification before
the utterance finishes) rather than waiting for a final STT result on every
turn.

## Interrupt (barge-in)

While NOVA is speaking (TTS streaming out), the VAD stage continues
listening. Detected speech during playback immediately halts TTS output
mid-stream and re-enters the listening state — this barge-in path is
tested as a first-class requirement, not an edge case, since natural
conversation depends on it. Barge-in sensitivity is user-configurable
(aggressive vs. conservative) to account for noisy environments.

## Natural conversation state

Voice sessions maintain a running conversational context distinct from a
single request/response turn, including handling of short affirmations,
corrections, and topic continuation across turns, backed by the same
episodic memory model as text conversations
(`docs/04-memory/memory-architecture.md`) — voice is a modality on the
same underlying conversation state, not a separate memory track.

## Multi-device voice

Wake-word detection runs independently on every device with a microphone
that has voice enabled (desktop, Android companion per
`docs/20-devices/android-companion.md`) — whichever device detects the
wake word first handles that utterance, avoiding both devices responding
to one command.

**Coordination mechanism.** A local wake-word detection does not
immediately begin full STT processing — it first broadcasts a lightweight
`voice.wake_claimed` event (detecting device ID, local detection
timestamp, detector confidence score) over the mesh transport
(`docs/28-multi-device-protocol/05-networking-and-discovery.md`) to other
voice-enabled devices, and waits up to **150ms** for competing claims
before proceeding — short enough not to be perceptible as added latency
against this document's own responsiveness requirement, since the wake
word itself is a fixed, multi-hundred-millisecond utterance the detector
is already partway through confirming. Resolution: the earliest
timestamp wins; a tie within measurement precision (rare, and only
possible for devices in the same room) is broken by detector confidence
score, then by the Primary Runtime device's ID as a final deterministic
tiebreak (`docs/28-multi-device-protocol/10-identity-and-workspace.md`).
The losing device(s) suppress their own response entirely — no
overlapping audio prompts, no duplicate processing — and this is the
resolution `docs/36-failure-catalog/` and `FM-13-voice-tts-localization.md`
should both point to for the "two devices respond to one wake word"
failure mode, rather than leaving it as an asserted-but-unmechanized
outcome.

If a claimed device goes unreachable mid-claim-window (network drop
exactly at the wrong moment), the remaining device proceeds once its own
150ms window elapses without a competing claim — the system fails toward
"one device eventually responds," never toward "no device responds
because the coordination handshake itself failed."

## Configuration boundary

The Setup Wizard and Settings surface persist voice preferences through the shared versioned ConfigurationStore. The typed voice section contains `enabled`, a non-empty `wake_word`, `always_listening`, and `barge_in_sensitivity` (`aggressive` or `conservative`). Invalid values are rejected atomically with field-level configuration errors before they can change runtime behavior.

The wake-word detector is always local and is not represented as a cloud-selectable provider setting. Enabling always-listening does not authorize raw microphone audio to be continuously sent to STT or any cloud provider; only an actual post-wake utterance enters the downstream pipeline.

## Related documents

- `docs/25-failure-modes/FM-13-voice-tts-localization.md` — failure modes for this subsystem
- `local-speech-models.md` — STT/TTS model options and on-device
  requirements
- `docs/18-providers/provider-routing.md` — latency-optimized policy
  used by default for voice
- `docs/20-devices/android-companion.md` — mobile voice capture
- `docs/20-devices/ai-phone.md` — voice as the primary phone interface
  at full maturity
- `docs/06-tools/content-interaction-and-narration.md` — document/article narration reusing this document's TTS synthesis unchanged
- `docs/06-tools/os-system-control.md`, `docs/09-ui/quick-input-surfaces.md` — the system/media controls and quick capture reachable by voice through this pipeline
