# TypeORM Migration Guide

backupctl uses **schema-driven TypeORM migrations** for all audit database schema changes. The workflow is: modify the `*.record.ts` schema first, then use `migration:generate` to produce the migration from the entity diff. Migrations are **never auto-run** — you have full manual control.

> **Golden rule**: The record schema (`*.record.ts`) is the source of truth. Always change the schema first, then generate the migration. Never hand-write migrations for schema changes.

---

## How It Works

- **Entity**: `src/domain/audit/infrastructure/persistence/typeorm/schema/backup-log.record.ts`
- **Config**: `src/config/typeorm.config.ts` (env-aware, `__dirname`-relative paths)
- **CLI Data Source**: `src/db/datasource.ts`
- **Migrations dir**: `src/db/migrations/`
- **Auto-run**: `migrationsRun: false` — you must run migrations manually

TypeORM tracks applied migrations in the `migrations` table in PostgreSQL. Run `migrate:show` to see pending vs applied migrations.

---

## Config Architecture

The TypeORM config is extracted into `src/config/typeorm.config.ts` with environment-specific settings:

- **Development**: uses `*.{js,ts}` globs, enables `migration` + `warn` + `error` logging
- **Production**: uses `*.js` only, enables `error` logging only
- Both environments: `migrationsRun: false`, `synchronize: false`

The config is registered via `@nestjs/config`'s `registerAs('typeorm', ...)` and consumed by `AppModule` through `ConfigService`.

A standalone `src/db/datasource.ts` exposes the same config as a raw `DataSource` for the TypeORM CLI.

---

## Migration Commands

The easiest way to run migration commands is through `scripts/dev.sh`. All commands below assume the dev environment is running (`scripts/dev.sh up`).

### Run Pending Migrations

```bash
scripts/dev.sh migrate:run
```

This is required after pulling new migration files or creating new ones.

### Show Migration Status

```bash
scripts/dev.sh migrate:show
```

Shows all migrations and whether they have been applied (`[X]`) or are pending.

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

### Revert Last Migration

```bash
scripts/dev.sh migrate:revert
```

This reverts the most recently applied migration by calling its `down()` method.

### Direct TypeORM CLI (without dev.sh)

If you need to run TypeORM commands directly, use `ts-node` with `tsconfig-paths/register` to resolve path aliases:

```bash
# Inside dev container
docker exec backupctl-dev npx ts-node -r tsconfig-paths/register \
  ./node_modules/typeorm/cli.js migration:show \
  -d src/db/datasource.ts

# Local (with Postgres accessible on localhost)
npx ts-node -r tsconfig-paths/register \
  ./node_modules/typeorm/cli.js migration:run \
  -d src/db/datasource.ts
```

---

## Production Migrations

Production migrations are **not** run manually. They are executed automatically by `scripts/backupctl-manage.sh deploy` and `scripts/backupctl-manage.sh upgrade` via a dedicated **migrator service**.

### Why a Dedicated Migrator Service

The production runtime image (the `backupctl` container) strips `npm` and `npx` to keep it lean. That means `docker exec backupctl npx typeorm ...` cannot work on prod. Instead, the migrator runs in a short-lived, purpose-built container that keeps `npm`/`npx` available.

### How It Works

- `docker-compose.yml` defines a `migrator` service under the `migrate` profile (so `docker compose up` never starts it automatically).
- The service builds from the `migrator` target in `Dockerfile`, which copies `node_modules/` from the `deps` stage and `dist/` from the `builder` stage, then runs `npx typeorm migration:run -d dist/db/datasource.js`.
- The deploy and upgrade scripts invoke it with `docker compose --profile migrate run --rm --build migrator`. The container exits after migrations complete.

### Run Migrations Manually on Production

If you ever need to run migrations outside of `deploy` / `upgrade` (for example, after editing a migration file):

```bash
cd /path/to/backupctl
docker compose --profile migrate run --rm --build migrator
```

To inspect status without applying:

```bash
docker compose --profile migrate run --rm --build --entrypoint sh migrator \
  -c "npx typeorm migration:show -d dist/db/datasource.js"
```

> The migrator service depends on `backupctl-audit-db` being healthy. If the audit DB is stopped, start it first with `docker compose up -d backupctl-audit-db`.

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

1. **Schema first** — always modify the `*.record.ts` file, then run `migrate:generate`. Never hand-write schema migrations
2. **Use `migrate:create` only for** data migrations, custom indexes, or SQL that `generate` can't capture
3. **Always implement `down()`** — reversibility is required, even if you think you'll never revert
4. **Never modify an existing migration** that has been applied in any environment — create a new one instead
5. **Keep migrations small and focused** — one logical change per migration
6. **Review the generated migration** before running it — `generate` can sometimes produce unnecessary changes
7. **Update the mapper** (`backup-log.mapper.ts`) if the new columns need domain-level representation
8. **Test migrations** by running them against a fresh database:
   ```bash
   docker compose -f docker-compose.dev.yml down -v
   docker compose -f docker-compose.dev.yml up -d
   scripts/dev.sh migrate:run
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
1. Modify record schema   →  *.record.ts (source of truth)
2. Generate migration     →  scripts/dev.sh migrate:generate DescriptiveName
3. Review generated file  →  src/db/migrations/
4. Run migration          →  scripts/dev.sh migrate:run
5. Verify                 →  scripts/dev.sh migrate:show
6. Update mapper          →  *.mapper.ts (if new columns need domain mapping)
7. Commit record + migration + mapper together
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

Then re-run `migrate:run`.

### "Cannot find data source" or "Cannot find module"

Make sure you're using `ts-node` with `tsconfig-paths/register` to resolve path aliases. The `scripts/dev.sh` commands handle this automatically. If running manually:

```bash
npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js migration:show \
  -d src/db/datasource.ts
```

Also verify the database is running and accessible with the credentials in `.env`.

### Fresh Start (Development Only)

```bash
scripts/dev.sh reset
scripts/dev.sh migrate:run
```

All migrations will re-run from scratch on the fresh database.
