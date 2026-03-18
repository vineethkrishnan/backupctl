import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
} from 'typeorm';

@Entity('backup_log')
export class BackupLogEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'project_name', type: 'varchar' })
  projectName!: string;

  @Column({ type: 'varchar' })
  status!: string;

  @Column({ name: 'current_stage', type: 'varchar', nullable: true })
  currentStage!: string | null;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'dump_size_bytes', type: 'bigint', nullable: true })
  dumpSizeBytes!: string | null;

  @Column({ type: 'boolean', default: false })
  encrypted!: boolean;

  @Column({ type: 'boolean', default: false })
  verified!: boolean;

  @Column({ name: 'snapshot_id', type: 'varchar', nullable: true })
  snapshotId!: string | null;

  @Column({ name: 'snapshot_mode', type: 'varchar', nullable: true })
  snapshotMode!: string | null;

  @Column({ name: 'files_new', type: 'int', nullable: true })
  filesNew!: number | null;

  @Column({ name: 'files_changed', type: 'int', nullable: true })
  filesChanged!: number | null;

  @Column({ name: 'bytes_added', type: 'bigint', nullable: true })
  bytesAdded!: string | null;

  @Column({ name: 'prune_snapshots_removed', type: 'int', nullable: true })
  pruneSnapshotsRemoved!: number | null;

  @Column({ name: 'local_files_cleaned', type: 'int', nullable: true })
  localFilesCleaned!: number | null;

  @Column({ name: 'error_stage', type: 'varchar', nullable: true })
  errorStage!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount!: number;

  @Column({ name: 'duration_ms', type: 'bigint', nullable: true })
  durationMs!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
