import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddBackupTypeToBackupLog1742467200000 implements MigrationInterface {
  name = 'AddBackupTypeToBackupLog1742467200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'backup_log',
      new TableColumn({
        name: 'backup_type',
        type: 'varchar',
        isNullable: true,
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('backup_log', 'backup_type');
  }
}
