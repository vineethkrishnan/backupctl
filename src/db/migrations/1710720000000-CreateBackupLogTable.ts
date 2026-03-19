import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateBackupLogTable1710720000000 implements MigrationInterface {
  name = 'CreateBackupLogTable1710720000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'backup_log',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'project_name', type: 'varchar' },
          { name: 'status', type: 'varchar' },
          { name: 'current_stage', type: 'varchar', isNullable: true },
          { name: 'started_at', type: 'timestamptz' },
          { name: 'completed_at', type: 'timestamptz', isNullable: true },
          { name: 'dump_size_bytes', type: 'bigint', isNullable: true },
          { name: 'encrypted', type: 'boolean', default: false },
          { name: 'verified', type: 'boolean', default: false },
          { name: 'snapshot_id', type: 'varchar', isNullable: true },
          { name: 'snapshot_mode', type: 'varchar', isNullable: true },
          { name: 'files_new', type: 'int', isNullable: true },
          { name: 'files_changed', type: 'int', isNullable: true },
          { name: 'bytes_added', type: 'bigint', isNullable: true },
          { name: 'prune_snapshots_removed', type: 'int', isNullable: true },
          { name: 'local_files_cleaned', type: 'int', isNullable: true },
          { name: 'error_stage', type: 'varchar', isNullable: true },
          { name: 'error_message', type: 'text', isNullable: true },
          { name: 'retry_count', type: 'int', default: 0 },
          { name: 'duration_ms', type: 'bigint', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('backup_log');
  }
}
