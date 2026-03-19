# TypeORM Migration Guide

backupctl uses **explicit TypeORM migrations** for all audit database schema changes. `synchronize` is always `false` — every schema change requires a migration file.

---

## How It Works

- **Entity**: `src/domain/audit/infrastructure/persistence/typeorm/schema/backup-log.record.ts`
- **Data source**: `src/domain/audit/infrastructure/persistence/typeorm/data-source.ts`
- **Migrations dir**: `src/domain/audit/infrastructure/persistence/typeorm/migrations/`
- **Auto-run on startup**: `migrationsRun: true` in `AppModule` TypeORM config

When the NestJS app starts, TypeORM automatically runs any pending migrations against the audit database. A `migrations` table in PostgreSQL tracks which migrations have already been applied.

---

## Data Source Configuration

The CLI data source at `src/domain/audit/infrastructure/persistence/typeorm/data-source.ts` is used by the TypeORM CLI for generating and running migrations manually:

```typescript
import { DataSource } from 'typeorm';
import { BackupLogRecord } from './schema/backup-log.record';

export default new DataSource({
  type: 'postgres',
  host: process.env.AUDIT_DB_HOST || 'localhost',
  port: parseInt(process.env.AUDIT_DB_PORT || '5432', 10),
  database: process.env.AUDIT_DB_NAME || 'backup_audit',
  username: process.env.AUDIT_DB_USER || 'audit_user',
  password: process.env.AUDIT_DB_PASSWORD || 'audit_secret',
  entities: [BackupLogRecord],
  migrations: ['src/domain/audit/infrastructure/persistence/typeorm/migrations/*.ts'],
});
```

All TypeORM CLI commands reference this file via the `-d` flag.

---

## Migration Commands

The easiest way to run migration commands is through `scripts/dev.sh`. All commands below assume the dev environment is running (`scripts/dev.sh up`).

### Generate a Migration (from Entity Changes)

After modifying the `BackupLogRecord` entity, generate a migration that captures the diff:

```bash
scripts/dev.sh migrate:generate DescriptiveName
```

This compares the current entity definitions against the database schema and generates a migration file with the necessary `ALTER TABLE` statements.

> **Important**: The database must be running and up to date with previous migrations for `generate` to produce a correct diff.

### Create an Empty Migration

For manual schema changes (indexes, constraints, data migrations):

```bash
scripts/dev.sh migrate:create DescriptiveName
```

This creates a blank migration file with `up()` and `down()` methods for you to fill in.

### Run Pending Migrations

```bash
scripts/dev.sh migrate:run
```

> **Note**: Migrations run automatically on app startup (`migrationsRun: true`), so manual `migrate:run` is only needed for debugging or out-of-band execution.

### Revert Last Migration

```bash
scripts/dev.sh migrate:revert
```

This reverts the most recently applied migration by calling its `down()` method.

### Show Migration Status

```bash
scripts/dev.sh migrate:show
```

Shows all migrations and whether they have been applied (`[X]`) or are pending.

### Direct TypeORM CLI (without dev.sh)

If you need to run TypeORM commands directly, use `ts-node` with `tsconfig-paths/register` to resolve path aliases:

```bash
# Inside dev container
docker exec backupctl-dev npx ts-node -r tsconfig-paths/register \
  ./node_modules/typeorm/cli.js migration:show \
  -d src/domain/audit/infrastructure/persistence/typeorm/data-source.ts

# Local (with Postgres accessible on localhost)
npx ts-node -r tsconfig-paths/register \
  ./node_modules/typeorm/cli.js migration:run \
  -d src/domain/audit/infrastructure/persistence/typeorm/data-source.ts
```

---

## Writing a Migration

### Naming Convention

Migration files are named with a timestamp prefix and a descriptive PascalCase name:

```
{timestamp}-DescriptiveName.ts
```

Examples:
- `1710720000000-CreateBackupLogTable.ts`
- `1710820000000-AddTagsColumnToBackupLog.ts`
- `1710920000000-CreateIndexOnProjectName.ts`

### Migration Template

```typescript
import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddTagsColumnToBackupLog1710820000000 implements MigrationInterface {
  name = 'AddTagsColumnToBackupLog1710820000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'backup_log',
      new TableColumn({
        name: 'tags',
        type: 'jsonb',
        isNullable: true,
      }),
    );

    await queryRunner.createIndex(
      'backup_log',
      new TableIndex({
        name: 'IDX_backup_log_tags',
        columnNames: ['tags'],
      }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('backup_log', 'IDX_backup_log_tags');
    await queryRunner.dropColumn('backup_log', 'tags');
  }
}
```

### Rules

1. **Always implement `down()`** — reversibility is required, even if you think you'll never revert
2. **Use the QueryRunner API** (`addColumn`, `createIndex`, `createTable`) instead of raw SQL when possible — this keeps migrations database-agnostic
3. **Use raw SQL for complex operations** when the QueryRunner API falls short:
   ```typescript
   await queryRunner.query(`ALTER TABLE backup_log ADD CONSTRAINT ...`);
   ```
4. **Never modify an existing migration** that has been applied in any environment — create a new one instead
5. **Keep migrations small and focused** — one logical change per migration
6. **Update the entity** (`backup-log.record.ts`) to match the new schema after writing the migration
7. **Test migrations** by running them against a fresh database:
   ```bash
   docker compose -f docker-compose.dev.yml down -v
   docker compose -f docker-compose.dev.yml up -d
   ```

---

## Common Patterns

### Add a Column

```typescript
async up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.addColumn('backup_log', new TableColumn({
    name: 'duration_seconds',
    type: 'int',
    isNullable: true,
  }));
}

async down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.dropColumn('backup_log', 'duration_seconds');
}
```

### Add an Index

```typescript
async up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.createIndex('backup_log', new TableIndex({
    name: 'IDX_backup_log_project_status',
    columnNames: ['project_name', 'status'],
  }));
}

async down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.dropIndex('backup_log', 'IDX_backup_log_project_status');
}
```

### Rename a Column

```typescript
async up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.renameColumn('backup_log', 'old_name', 'new_name');
}

async down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.renameColumn('backup_log', 'new_name', 'old_name');
}
```

### Change Column Type

```typescript
async up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.changeColumn('backup_log', 'duration_ms', new TableColumn({
    name: 'duration_ms',
    type: 'numeric',
    isNullable: true,
  }));
}

async down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.changeColumn('backup_log', 'duration_ms', new TableColumn({
    name: 'duration_ms',
    type: 'bigint',
    isNullable: true,
  }));
}
```

### Data Migration

```typescript
async up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.addColumn('backup_log', new TableColumn({
    name: 'is_encrypted',
    type: 'boolean',
    default: false,
  }));

  // Backfill from existing data
  await queryRunner.query(`
    UPDATE backup_log SET is_encrypted = true WHERE encrypted = true
  `);
}
```

---

## Workflow Summary

```
1. Modify entity       →  backup-log.record.ts
2. Generate migration  →  scripts/dev.sh migrate:generate DescriptiveName
3. Review the generated file
4. Run migration       →  scripts/dev.sh migrate:run (or restart app)
5. Verify              →  scripts/dev.sh migrate:show
6. Commit both the entity change and migration file together
```

---

## Troubleshooting

### "No changes in database schema were found"

The database is already in sync with the entity. Either:
- You forgot to save the entity file
- The migration was already generated and applied
- The database is out of sync — run pending migrations first

### "Migration has already been applied"

TypeORM tracks applied migrations in the `migrations` table. If you need to re-run a migration:

```sql
-- Check applied migrations
SELECT * FROM migrations ORDER BY timestamp DESC;

-- Remove a migration record (use with caution)
DELETE FROM migrations WHERE name = 'MigrationName1710820000000';
```

Then re-run `migration:run`.

### "Cannot find data source" or "Cannot find module"

Make sure you're using `ts-node` with `tsconfig-paths/register` to resolve path aliases. The `scripts/dev.sh` commands handle this automatically. If running manually:

```bash
npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:show \
  -d src/domain/audit/infrastructure/persistence/typeorm/data-source.ts
```

Also verify the database is running and accessible with the credentials in `.env`.

### Fresh Start (Development Only)

```bash
scripts/dev.sh reset
```

All migrations will re-run from scratch on the fresh database.
