export enum BackupStage {
  NotifyStarted = 'notify_started',
  PreHook = 'pre_hook',
  Dump = 'dump',
  Verify = 'verify',
  Encrypt = 'encrypt',
  Sync = 'sync',
  Prune = 'prune',
  Cleanup = 'cleanup',
  PostHook = 'post_hook',
  Audit = 'audit',
  NotifyResult = 'notify_result',
}
