import { ProjectConfig } from '../models/project-config.model';

export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

export interface ConfigLoaderPort {
  loadAll(): ProjectConfig[];
  getProject(name: string): ProjectConfig;
  validate(): ValidationResult;
  reload(): void;
}
