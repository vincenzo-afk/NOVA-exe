# Physical Environment Integration: Smart Home, Wearables, and External Data Feeds

## Purpose

Extends NOVA's context beyond the user's own devices into the physical
spaces and body signals around them — smart-home sensors/actuators and
wearable vitals — plus a narrow, purpose-scoped set of external live
data feeds that genuinely serve a personal assistant's job (weather,
traffic, flight status), closing a real gap: nothing in this project
currently specifies IoT, wearable, or external-feed integration.
Grouped together because all three are the same shape architecturally —
a provider-pattern integration that turns an external signal into
either Knowledge Graph facts or Planner-actionable device control — not
because smart plugs and flight tracking are conceptually related on
their own.

## Scope

Three provider-pattern integrations and the boundary on what's in and
out of scope for the third. Does not cover the companion phone's own
sensors (camera, screen) — those are `spatial-perception.md`'s domain.

## What this document deliberately excludes

Not every external feed a headline AI product might integrate belongs
in a personal assistant. **Ship position tracking and general social-
media monitoring are explicitly out of scope** — they serve a
surveillance or analyst use case, not a personal assistant's, and
including them would contradict this project's own restraint elsewhere
(`docs/00-overview/non-goals.md`, `docs/references/feature-gap-analysis.md`'s
"what NOVA should not copy" section). Weather, traffic, and flight
tracking remain in scope because each directly serves an ordinary
personal-assistant task (planning a commute, preparing for a trip) —
the test applied throughout this document is "does this feed answer a
question the user would actually ask their assistant," not "is this
technically available to integrate."

## Smart-home and IoT

Device control (smart plugs, lights, thermostats) and sensor ingestion
(temperature, motion, door/window state) both integrate through the
existing provider pattern (`docs/18-providers/provider-interface.md`),
targeting Home Assistant as the primary integration point — Home
Assistant already normalizes the long tail of individual device brands
and protocols (Zigbee, Z-Wave, Matter, vendor clouds), so NOVA
integrates once against Home Assistant's own API rather than against
each device brand directly, the same "integrate against the normalizing
layer, not every leaf" choice already made elsewhere in this project
(e.g., a mesh-network provider for remote control,
`docs/20-devices/remote-control.md`). Direct ESP32/microcontroller
integration is supported as a narrower path for a user running their
own firmware, using a simple, documented MQTT or HTTP contract rather
than requiring Home Assistant as a hard dependency.

Voice and text control ("turn on the fan," "set AC to 24°C") route
through the Command Palette / voice pipeline's normal intent handling
into a device-control action, classified at the **low risk tier**
(`docs/10-security/permissions.md`) for reversible state changes
(on/off, temperature set-point) and reused unchanged for anything a
smart-home device can already do — this document adds a device-control
action type, not a new permission model.

Sensor data (temperature, motion, door/window status) ingests into the
Knowledge Graph as time-stamped facts tied to a `Device` node
(`docs/04-memory/knowledge-graph.md`), available to the Planner as
context ("it's currently 28°C in the office") the same way any other
structured memory fact is, subject to the same confidence/staleness
model (`docs/04-memory/memory-confidence.md`) — a sensor reading from
an hour ago is treated as stale context, not a current fact, exactly
like any other aging observation.

## Wearables and vitals

Fitbit, Apple Watch, and Oura integrate through the same provider
pattern, each as a `VitalsProvider` implementation supplying sleep,
activity, heart-rate, and readiness data on whatever cadence that
platform's own API supports (typically a daily/periodic sync, not
live streaming). **Vitals data is health data** and is governed by
this project's existing sensitive-data handling
(`docs/00-overview/non-goals.md`'s privacy posture and the memory
system's sensitive-category rules) — it is stored as structured,
user-owned, user-deletable records exactly like any other memory
category, never used to train or fine-tune anything, and surfaced only
when the user's own query or an explicit opt-in proactive check-in
calls for it, never volunteered unprompted into an unrelated
conversation.

"How's my focus today?" and fatigue/break suggestions are a Planner
query over this data joined with calendar load and observed activity
patterns (`docs/23-autonomy/personal-analytics.md`'s existing rollup
mechanism) — an aggregation over already-structured data, not a
clinical inference; this document does not authorize NOVA to make a
health or medical judgment, only to surface the user's own data and
correlate it with their own schedule, framed as information rather
than diagnosis.

## External live data feeds

Weather, traffic, and flight tracking integrate as read-only,
provider-pattern data sources, each mapped to a concrete assistant task:
weather feeds a morning briefing and trip planning
(`docs/23-autonomy/background-life-assistant.md`), traffic feeds a
"you have a meeting in 15 minutes, traffic is heavy" proactive
suggestion (same document), and flight tracking answers "track this
flight and remind me before departure" — triggered by the user
confirming a proactive suggestion after NOVA notices a flight
confirmation in captured content (email, a copied itinerary), never by
NOVA silently deciding on its own to start tracking something the user
hasn't asked about or confirmed.

## Related documents

- `docs/18-providers/provider-interface.md` — the integration pattern every source in this document uses
- `docs/00-overview/non-goals.md`, `docs/references/feature-gap-analysis.md` — the scoping precedent behind this document's exclusions
- `docs/04-memory/knowledge-graph.md`, `docs/04-memory/memory-confidence.md` — where sensor and vitals facts live and how they age
- `docs/23-autonomy/background-life-assistant.md`, `docs/23-autonomy/personal-analytics.md` — the proactive and rollup mechanisms this document's briefings and focus queries reuse
- `docs/10-security/permissions.md` — the risk tier for device-control actions
- `docs/20-devices/remote-control.md` — the "integrate against the normalizing layer" precedent behind choosing Home Assistant
- `docs/20-devices/spatial-perception.md` — the companion phone's own sensors, explicitly out of this document's scope
