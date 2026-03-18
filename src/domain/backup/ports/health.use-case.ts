import { HealthCheckResult } from '../../audit/models/health-check-result.model';

export interface HealthUseCase {
  checkHealth(): Promise<HealthCheckResult>;
}
