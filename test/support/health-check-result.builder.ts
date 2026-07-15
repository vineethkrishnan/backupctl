import {
  HealthCheckResult,
  HealthCheckResultParams,
  StorageHealthCheck,
} from '@domain/audit/domain/health-check-result.model';

export function buildStorageHealthCheck(
  overrides: Partial<StorageHealthCheck> = {},
): StorageHealthCheck {
  return {
    project: 'vinsware',
    backendType: 'sftp',
    reachable: true,
    error: null,
    ...overrides,
  };
}

export function buildHealthCheckResult(
  overrides: Partial<HealthCheckResultParams> = {},
): HealthCheckResult {
  return new HealthCheckResult({
    auditDbConnected: true,
    diskSpaceAvailable: true,
    diskFreeGb: 50,
    storageChecks: [buildStorageHealthCheck()],
    uptime: 3600,
    ...overrides,
  });
}
