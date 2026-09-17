# Endpoint Catalog

## Purpose

The literal, enumerated method+path list for every REST endpoint in the
categories `rest-api.md` describes — that document covers categories and
conventions; this one is the concrete catalog an SDK or integration
would actually be generated from, the same role `docs/26-system-reference/
06-error-catalog.md` and `07-event-catalog.md` play for their respective
domains.

## Scope

Method, path, and one-line purpose per endpoint. Request/response body
shapes are docs/08-api/schemas.md; authentication is docs/08-api/
sdk.md`'s trust model; pagination behavior for list endpoints is
`pagination.md`.

## Catalog

| Method                                 | Path                         | Purpose                                                                                | Category          |
| -------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- | ----------------- |
| `POST`                                 | `/v1/tasks`                  | Submit a new task; returns immediately with `task_id` and initial state.               | Tasks             |
| `GET`                                  | `/v1/tasks/{task_id}`        | Query a task's current state and result.                                               | Tasks             |
| `GET`                                  | `/v1/tasks`                  | List tasks, filterable by state/date range (paginated).                                | Tasks             |
| `POST`                                 | `/v1/tasks/{task_id}/cancel` | Request cancellation of an in-flight task.                                             | Tasks             |
| `POST`                                 | `/v1/search`                 | Query the Retrieval Fusion Engine; same interface as internal Search.                  | Memory and search |
| `GET`                                  | `/v1/memory/{record_id}`     | Fetch a single memory record by ID, with lineage.                                      | Memory and search |
| `POST`                                 | `/v1/graph/query`            | Direct entity/relationship query against the Knowledge Graph.                          | Knowledge Graph   |
| `GET`                                  | `/v1/tools`                  | List registered tools and their metadata (paginated).                                  | Tools             |
| `POST`                                 | `/v1/tools/register`         | Register a new plugin tool, subject to `sdk.md`'s trust model.                         | Tools             |
| `GET`                                  | `/v1/permissions`            | Query current observer/execution permission grants.                                    | Permissions       |
| `PATCH`                                | `/v1/permissions/{grant_id}` | Update a single permission grant.                                                      | Permissions       |
| `GET`                                  | `/v1/config`                 | Read current provider/cost-budget/user-configurable settings.                          | Configuration     |
| `PATCH`                                | `/v1/config`                 | Update configuration values, subject to `docs/14-development/                          |
| configuration-schema.md`'s validation. | Configuration                |
| `POST`                                 | `/v1/events/subscribe`       | Register an external webhook callback and subscribed topics (`docs/08-api/events.md`). | External events   |

## Adding a new endpoint

Same discipline as `docs/26-system-reference/06-error-catalog.md`'s code
allocation: a new endpoint gets a row here in the same change that
implements it, with its category matching one already described in
`rest-api.md` (or a new category added to both files together, never one
without the other).

## Related documents

- `docs/08-api/rest-api.md` — endpoint categories and request/response conventions this catalog enumerates
- `docs/08-api/schemas.md` — request/response body shapes
- `pagination.md` — list-endpoint pagination behavior
- `docs/08-api/sdk.md` — authentication/trust model
- `docs/08-api/versioning.md` — how a breaking change to any endpoint here is versioned
