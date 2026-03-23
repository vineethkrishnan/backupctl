# Technical Architecture: Uptime Kuma Heartbeat Monitoring

## Executive Summary

Add passive failure detection to backupctl by integrating Uptime Kuma push monitors. A single Uptime Kuma container joins the existing Docker Compose stack. A new `HeartbeatMonitorPort` (outbound port) with an `UptimeKumaHeartbeatAdapter` sends HTTP GET pings after each backup run. A new optional `monitor` field on `ProjectConfig` holds the per-project push token. The existing notification system is untouched.

**Key Architectural Decisions:**

| Decision | Rationale |
|----------|-----------|
| Separate `monitor` config from `notification` | Different concerns — notification is rich event data, monitor is a lightweight heartbeat signal. Keeps both independently configurable |
| `HeartbeatMonitorPort` as a standalone port (not extending `NotifierPort`) | The heartbeat API is fundamentally different — single `sendHeartbeat()` method vs. 5 notification methods. No shared contract |
| No registry pattern for monitors (unlike notifiers) | Only one monitor type exists today (`uptime-kuma`). A registry adds complexity without value. The port is resolved directly from config in `RunBackupUseCase`. If a second type is added later, extract a registry then (YAGNI) |
| Heartbeat after audit + notification (step 12) | Heartbeat confirms the entire flow completed, including audit persistence. Placing it earlier could send "up" before audit writes |
| No `depends_on` from backupctl to Kuma | Kuma unavailability must never prevent backups from running or starting |
| HTTP GET (not POST) for push | Uptime Kuma's push API uses GET with query parameters — this is the documented contract |
| `ping` parameter carries backup duration | Kuma displays this as "response time" in its UI, giving a visual trend of backup duration over time |

---

## System Context

### Affected Components

| Component | Change Type | Description |
|-----------|-------------|-------------|
| `docker-compose.yml` | Modified | Add `uptime-kuma` service and `uptime-kuma-data` volume |
| `src/domain/backup/application/ports/` | New file | `heartbeat-monitor.port.ts` — outbound port interface |
| `src/domain/backup/infrastructure/adapters/monitors/` | New directory | `uptime-kuma-heartbeat.adapter.ts` — HTTP GET adapter |
| `src/domain/backup/application/use-cases/run-backup/run-backup.use-case.ts` | Modified | Add heartbeat step after audit/notification finalization |
| `src/domain/config/domain/project-config.model.ts` | Modified | Add `monitor` field to `ProjectConfig` and `ProjectConfigParams` |
| `src/domain/config/infrastructure/yaml-config-loader.adapter.ts` | Modified | Parse `monitor` block from YAML |
| `src/domain/health/application/use-cases/check-health/check-health.use-case.ts` | Modified | Add Kuma connectivity check |
| `src/domain/audit/domain/health-check-result.model.ts` | Modified | Add `uptimeKumaConnected` and `uptimeKumaConfigured` fields |
| `src/common/di/injection-tokens.ts` | Modified | Add `HEARTBEAT_MONITOR_PORT` token |
| `src/domain/backup/backup.module.ts` | Modified | Bind `HEARTBEAT_MONITOR_PORT` → `UptimeKumaHeartbeatAdapter` |
| `.env.example` | Modified | Add `UPTIME_KUMA_BASE_URL`, `UPTIME_KUMA_PORT` |
| `config/projects-example.yml` | Modified | Add `monitor` block examples |

### Integration Points

- **Internal:** `RunBackupUseCase` → `HeartbeatMonitorPort` (new dependency)
- **Internal:** `CheckHealthUseCase` → `HeartbeatMonitorPort` (new dependency for connectivity check)
- **Internal:** `YamlConfigLoaderAdapter` → parses new `monitor` YAML block
- **External:** HTTP GET to Uptime Kuma push API (`/api/push/{token}?status=up|down&msg=...&ping=...`)
- **External:** Uptime Kuma container on `backupctl-network`

---

## Module Architecture

No new NestJS module is created. The heartbeat monitor is a port in the `backup` module (since it's triggered by the backup flow) with its adapter bound in `BackupModule`.

### New Files

```
src/domain/backup/
├── application/
│   └── ports/
│       └── heartbeat-monitor.port.ts          # NEW — outbound port interface
└── infrastructure/
    └── adapters/
        └── monitors/
            └── uptime-kuma-heartbeat.adapter.ts  # NEW — HTTP GET adapter
```

### Modified Files

```
src/domain/backup/
├── application/
│   └── use-cases/
│       └── run-backup/
│           └── run-backup.use-case.ts          # MODIFIED — add heartbeat step
├── backup.module.ts                            # MODIFIED — bind HEARTBEAT_MONITOR_PORT

src/domain/config/
├── domain/
│   └── project-config.model.ts                 # MODIFIED — add monitor field
└── infrastructure/
    └── yaml-config-loader.adapter.ts           # MODIFIED — parse monitor block

src/domain/health/
├── application/
│   └── use-cases/
│       └── check-health/
│           └── check-health.use-case.ts        # MODIFIED — add Kuma check

src/domain/audit/
└── domain/
    └── health-check-result.model.ts            # MODIFIED — add Kuma fields

src/common/
└── di/
    └── injection-tokens.ts                     # MODIFIED — add HEARTBEAT_MONITOR_PORT

docker-compose.yml                              # MODIFIED — add uptime-kuma service
.env.example                                    # MODIFIED — add Kuma env vars
config/projects-example.yml                     # MODIFIED — add monitor block
```

---

## Domain Model Changes

### ProjectConfig — Add `monitor` field

**File:** `src/domain/config/domain/project-config.model.ts`

Add to `ProjectConfigParams` and `ProjectConfig`:

```typescript
readonly monitor: {
  readonly type: string;
  readonly config: Record<string, unknown>;
} | null;
```

Add accessor method:

```typescript
hasMonitor(): boolean {
  return this.monitor != null;
}
```

This follows the exact same pattern as the existing `notification` field.

---

## Application Port

### HeartbeatMonitorPort

**File:** `src/domain/backup/application/ports/heartbeat-monitor.port.ts`

```typescript
export interface HeartbeatMonitorPort {
  sendHeartbeat(
    pushToken: string,
    status: 'up' | 'down',
    message: string,
    durationMs: number,
  ): Promise<void>;

  checkConnectivity(): Promise<boolean>;
}
```

**Design notes:**
- `pushToken` is passed per call (not in constructor) because different projects have different tokens
- `status` is `'up' | 'down'` — maps directly to Kuma's push API values
- `message` is a short human-readable status string
- `durationMs` maps to Kuma's `ping` parameter (displayed as response time)
- `checkConnectivity()` is used by the health check to verify Kuma is reachable

---

## Infrastructure Adapter

### UptimeKumaHeartbeatAdapter

**File:** `src/domain/backup/infrastructure/adapters/monitors/uptime-kuma-heartbeat.adapter.ts`

```typescript
@Injectable()
export class UptimeKumaHeartbeatAdapter implements HeartbeatMonitorPort {
  private readonly baseUrl: string | undefined;

  constructor(configService: ConfigService) {
    this.baseUrl = configService.get<string>('UPTIME_KUMA_BASE_URL');
  }

  async sendHeartbeat(
    pushToken: string,
    status: 'up' | 'down',
    message: string,
    durationMs: number,
  ): Promise<void> {
    if (!this.baseUrl) return;

    const url = new URL(`/api/push/${pushToken}`, this.baseUrl);
    url.searchParams.set('status', status);
    url.searchParams.set('msg', message.slice(0, 200));
    url.searchParams.set('ping', String(durationMs));

    await axios.get(url.toString(), { timeout: 5000 });
  }

  async checkConnectivity(): Promise<boolean> {
    if (!this.baseUrl) return false;

    const response = await axios.get(this.baseUrl, { timeout: 5000 });
    return response.status === 200;
  }
}
```

**Key behaviors:**
- If `UPTIME_KUMA_BASE_URL` is not set, `sendHeartbeat()` is a no-op (returns immediately)
- Message is truncated to 200 chars to stay within URL length limits
- 5-second timeout prevents hanging if Kuma is unresponsive
- Uses `axios.get()` (already a project dependency) — no new packages needed

---

## Use Case Changes

### RunBackupUseCase — Add heartbeat step

**File:** `src/domain/backup/application/use-cases/run-backup/run-backup.use-case.ts`

**New dependency:** `@Inject(HEARTBEAT_MONITOR_PORT) private readonly heartbeatMonitor: HeartbeatMonitorPort`

**Change in `executeBackup()`:** After `finalizeNotification()`, add:

```typescript
// Send heartbeat to push monitor (if configured)
if (config.hasMonitor()) {
  await this.finalizeHeartbeat(config, result);
}
```

**New private method:**

```typescript
private async finalizeHeartbeat(
  config: ProjectConfig,
  result: BackupResult,
): Promise<void> {
  try {
    const monitor = config.monitor;
    if (!monitor) return;

    const pushToken = monitor.config.push_token as string;
    if (!pushToken) return;

    const status = result.status === BackupStatus.Success ? 'up' : 'down';
    const message = result.status === BackupStatus.Success
      ? `OK - ${formatDuration(result.durationMs)}`
      : `FAIL - ${result.errorStage ?? 'unknown'}: ${result.errorMessage ?? 'unknown error'}`;

    await this.heartbeatMonitor.sendHeartbeat(
      pushToken,
      status,
      message,
      result.durationMs,
    );
  } catch (error) {
    this.logger.error(`Heartbeat failed for ${config.name}, continuing: ${String(error)}`);
  }
}
```

**Key behaviors:**
- Heartbeat failure is caught and logged — never affects backup status or exit code
- Uses existing `formatDuration()` from `@common/helpers/format.util.ts`
- Dry runs skip the heartbeat (already handled — dry run returns early before `executeBackup()`)
- `run --all` sends per-project heartbeat inside the `for` loop (each project's backup calls `executeBackup()` independently)

### Change in backup flow position

```
Previous:
  ... → finalizeAudit() → finalizeNotification() → return result

New:
  ... → finalizeAudit() → finalizeNotification() → finalizeHeartbeat() → return result
```

---

## Health Check Changes

### CheckHealthUseCase — Add Kuma connectivity check

**File:** `src/domain/health/application/use-cases/check-health/check-health.use-case.ts`

**New dependency:** `@Inject(HEARTBEAT_MONITOR_PORT) private readonly heartbeatMonitor: HeartbeatMonitorPort`

Add Kuma check to the `Promise.all` block:

```typescript
const uptimeKumaBaseUrl = this.configService.get<string>('UPTIME_KUMA_BASE_URL');
const isKumaConfigured = !!uptimeKumaBaseUrl;

// Add to Promise.all:
isKumaConfigured ? this.heartbeatMonitor.checkConnectivity() : Promise.resolve(false)
```

### HealthCheckResult — Add Kuma fields

**File:** `src/domain/audit/domain/health-check-result.model.ts`

Add two new fields:

```typescript
readonly uptimeKumaConnected: boolean;
readonly uptimeKumaConfigured: boolean;
```

Update constructor to accept these. Update `isHealthy()` — Kuma connectivity is NOT required for healthy status (it's informational only, like SSH when not configured). The health presenters (CLI + HTTP) will display it as a separate line.

---

## DI Token

### injection-tokens.ts

**File:** `src/common/di/injection-tokens.ts`

Add:

```typescript
export const HEARTBEAT_MONITOR_PORT = Symbol('HEARTBEAT_MONITOR_PORT');
```

---

## Module Wiring

### BackupModule

**File:** `src/domain/backup/backup.module.ts`

Add import and binding:

```typescript
import { UptimeKumaHeartbeatAdapter } from './infrastructure/adapters/monitors/uptime-kuma-heartbeat.adapter';
import { HEARTBEAT_MONITOR_PORT } from '@common/di/injection-tokens';

// In providers:
{ provide: HEARTBEAT_MONITOR_PORT, useClass: UptimeKumaHeartbeatAdapter },
```

Export `HEARTBEAT_MONITOR_PORT` so `HealthModule` can use it.

### HealthModule

**File:** `src/domain/health/health.module.ts`

Import `BackupModule` (for `HEARTBEAT_MONITOR_PORT`):

```typescript
imports: [AuditModule, BackupModule],
```

**Note:** This creates a dependency `HealthModule → BackupModule`. This is acceptable because `HealthModule` already depends on `AuditModule`, and `BackupModule` already depends on `AuditModule`. No circular dependency is introduced.

**Alternative:** If the coupling feels wrong, `HEARTBEAT_MONITOR_PORT` could be bound in `SharedInfraModule` instead. But since the port belongs to the backup domain, binding it in `BackupModule` and exporting is cleaner.

---

## Config Loader Changes

### YamlConfigLoaderAdapter

**File:** `src/domain/config/infrastructure/yaml-config-loader.adapter.ts`

**Add to `RawProjectEntry`:**

```typescript
monitor?: {
  type: string;
  config: Record<string, unknown>;
};
```

**Add to `buildProjectConfig()`:**

```typescript
monitor: resolved.monitor ?? null,
```

**Add to `validate()`:**

```typescript
if (resolved.monitor) {
  if (!resolved.monitor.type) {
    errors.push(`Project "${resolved.name}": monitor missing required field: type`);
  }
  if (resolved.monitor.type === 'uptime-kuma') {
    const pushToken = resolved.monitor.config?.push_token;
    if (!pushToken) {
      errors.push(`Project "${resolved.name}": monitor type "uptime-kuma" requires config.push_token`);
    }
    const kumaBaseUrl = this.configService.get<string>('UPTIME_KUMA_BASE_URL');
    if (!kumaBaseUrl) {
      errors.push(`Project "${resolved.name}": monitor type "uptime-kuma" requires UPTIME_KUMA_BASE_URL in .env`);
    }
  }
}
```

---

## Docker Compose Changes

**File:** `docker-compose.yml`

Add service:

```yaml
uptime-kuma:
  container_name: uptime-kuma
  image: louislam/uptime-kuma:1
  volumes:
    - uptime-kuma-data:/app/data
  ports:
    - '${UPTIME_KUMA_PORT:-3001}:3001'
  networks:
    - backupctl-network
  restart: unless-stopped
  deploy:
    resources:
      limits:
        memory: 512M
        cpus: '1'
```

Add volume:

```yaml
volumes:
  backupctl-audit-data:
  uptime-kuma-data:
```

**No `depends_on`** from `backupctl` to `uptime-kuma`. Kuma being down must never block backupctl.

---

## Environment Variables

**File:** `.env.example`

Add (commented out):

```env
# Uptime Kuma (optional — only if using heartbeat monitoring)
# UPTIME_KUMA_BASE_URL=http://uptime-kuma:3001
# UPTIME_KUMA_PORT=3001
```

---

## Cross-Cutting Concerns

### Error Handling

- `sendHeartbeat()` failures are caught in `finalizeHeartbeat()` and logged — never propagated
- No fallback writer for heartbeat failures (unlike audit/notification). Rationale: the heartbeat timeout in Kuma will detect the missed ping. Writing to fallback and replaying later would defeat the purpose (a late heartbeat gives a false "up" signal)
- `checkConnectivity()` failures are caught in `CheckHealthUseCase` and reported as `uptimeKumaConnected: false`

### Security

- Push tokens are non-sensitive (they can only send heartbeats, not access data), but they're still treated as config and stored in YAML
- `UPTIME_KUMA_BASE_URL` uses internal Docker hostname (`http://uptime-kuma:3001`) — not exposed to the internet unless the user explicitly maps the port
- No authentication needed for Kuma's push API (tokens are the authentication)

### Performance

- Single HTTP GET per backup run — negligible overhead (~50-100ms)
- 5-second timeout prevents hanging on Kuma unresponsiveness
- Health check adds one more parallel `Promise.all` entry — no sequential overhead

### Observability

- Heartbeat success/failure logged at `info`/`error` level via Winston
- Kuma dashboard provides its own monitoring history and response time graphs
- `backupctl health` output includes Kuma connectivity status

---

## Testing

### Unit Tests

| Test Target | File | What to Test |
|-------------|------|--------------|
| `UptimeKumaHeartbeatAdapter` | `test/unit/infrastructure/adapters/monitors/uptime-kuma-heartbeat.adapter.spec.ts` | Mock `axios.get`. URL construction with token, status, msg, ping. Message truncation at 200 chars. No-op when `UPTIME_KUMA_BASE_URL` not set. Timeout of 5000ms passed. `checkConnectivity()` returns true/false |
| `RunBackupUseCase` (heartbeat) | `test/unit/application/backup/backup-orchestrator.service.spec.ts` (existing file) | Add tests: heartbeat sent after audit+notification on success. Heartbeat sent with `down` on failure. Heartbeat failure logged but doesn't change result. Heartbeat skipped when project has no `monitor` config. Heartbeat skipped during dry run |
| `ProjectConfig` | `test/unit/domain/config/models/project-config.model.spec.ts` (existing file) | Add tests: `hasMonitor()` returns true/false. Monitor field correctly populated |
| `YamlConfigLoaderAdapter` | `test/unit/infrastructure/adapters/config/yaml-config-loader.adapter.spec.ts` (existing file) | Add tests: parses `monitor` block. Validation error when `push_token` missing. Validation error when `UPTIME_KUMA_BASE_URL` missing. Projects without `monitor` block load successfully |
| `CheckHealthUseCase` | `test/unit/application/health/check-health.use-case.spec.ts` (existing file) | Add tests: includes Kuma check when configured. Skips Kuma check when not configured |
| `HealthCheckResult` | `test/unit/domain/audit/models/health-check-result.model.spec.ts` (existing file) | Add tests: new fields present. `isHealthy()` unaffected by Kuma status |

### Integration Tests

| Test Target | What to Test |
|-------------|--------------|
| Config loading | YAML with `monitor` block loads correctly end-to-end |
| Backup flow | Full flow with mocked heartbeat adapter — verify heartbeat called with correct args |

---

## Files Summary

### Create

| Category | File | Purpose |
|----------|------|---------|
| Port | `src/domain/backup/application/ports/heartbeat-monitor.port.ts` | Outbound port interface |
| Adapter | `src/domain/backup/infrastructure/adapters/monitors/uptime-kuma-heartbeat.adapter.ts` | HTTP GET adapter for Kuma push API |
| Test | `test/unit/infrastructure/adapters/monitors/uptime-kuma-heartbeat.adapter.spec.ts` | Adapter unit tests |

### Modify

| File | Change |
|------|--------|
| `src/common/di/injection-tokens.ts` | Add `HEARTBEAT_MONITOR_PORT` token |
| `src/domain/config/domain/project-config.model.ts` | Add `monitor` field + `hasMonitor()` accessor |
| `src/domain/config/infrastructure/yaml-config-loader.adapter.ts` | Parse `monitor` from YAML, add validation rules |
| `src/domain/backup/application/use-cases/run-backup/run-backup.use-case.ts` | Inject `HeartbeatMonitorPort`, add `finalizeHeartbeat()` after notification |
| `src/domain/backup/backup.module.ts` | Bind `HEARTBEAT_MONITOR_PORT` → `UptimeKumaHeartbeatAdapter`, export token |
| `src/domain/health/application/use-cases/check-health/check-health.use-case.ts` | Add Kuma connectivity check |
| `src/domain/health/health.module.ts` | Import `BackupModule` for heartbeat port |
| `src/domain/audit/domain/health-check-result.model.ts` | Add `uptimeKumaConnected`, `uptimeKumaConfigured` fields |
| `docker-compose.yml` | Add `uptime-kuma` service + `uptime-kuma-data` volume |
| `.env.example` | Add `UPTIME_KUMA_BASE_URL`, `UPTIME_KUMA_PORT` |
| `config/projects-example.yml` | Add `monitor` block examples |
| Existing test files (5 files) | Add test cases for heartbeat integration |

### Delete

None.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Circular module dependency (`HealthModule` → `BackupModule` → `HealthModule`) | Build failure | Verified: no circular dependency. `BackupModule` does not import `HealthModule`. Only `HealthModule` imports `BackupModule` |
| Kuma container consumes too much memory | Resource contention | 512M memory limit in Docker Compose. Kuma is lightweight (SQLite-based) |
| Kuma push API changes in future versions | Heartbeat breaks silently | Pin to `louislam/uptime-kuma:1` (major version). Adapter isolated behind port — easy to update |
| Push token exposed in YAML config file | Attacker sends false heartbeats | Low impact (can't access backup data). YAML file permissions should be restricted (already `:ro` mounted) |
| Network timeout to Kuma delays backup completion | Backup takes 5s longer on Kuma outage | 5-second timeout on HTTP call. Heartbeat is the last step — doesn't delay any backup operations |

---

## Implementation Order

1. **Docker Compose + env vars** — Add Kuma service, volume, `.env.example` changes. Verify Kuma starts and UI is accessible
2. **Domain model** — Add `monitor` field to `ProjectConfig` + `hasMonitor()` accessor
3. **Config loader** — Parse `monitor` from YAML + validation rules
4. **Port** — Create `HeartbeatMonitorPort` interface
5. **DI token** — Add `HEARTBEAT_MONITOR_PORT` to injection tokens
6. **Adapter** — Implement `UptimeKumaHeartbeatAdapter` + unit tests
7. **Use case integration** — Add `finalizeHeartbeat()` to `RunBackupUseCase` + tests
8. **Module wiring** — Bind port in `BackupModule`, export for `HealthModule`
9. **Health check** — Add Kuma connectivity to `CheckHealthUseCase` + `HealthCheckResult` + tests
10. **Config examples** — Update `projects-example.yml` with `monitor` block
11. **Documentation** — Create `docs/monitoring.md`, update config reference

---

## Open Questions

None — all requirements were clarified during the PRD phase.
