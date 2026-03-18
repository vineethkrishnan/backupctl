export interface HookExecutorPort {
  execute(command: string): Promise<void>;
}
