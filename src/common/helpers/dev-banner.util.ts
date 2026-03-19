const BANNER = `
\x1b[36m
  ██████╗  █████╗  ██████╗██╗  ██╗██╗   ██╗██████╗  ██████╗████████╗██╗
  ██╔══██╗██╔══██╗██╔════╝██║ ██╔╝██║   ██║██╔══██╗██╔════╝╚══██╔══╝██║
  ██████╔╝███████║██║     █████╔╝ ██║   ██║██████╔╝██║        ██║   ██║
  ██╔══██╗██╔══██║██║     ██╔═██╗ ██║   ██║██╔═══╝ ██║        ██║   ██║
  ██████╔╝██║  ██║╚██████╗██║  ██╗╚██████╔╝██║     ╚██████╗   ██║   ███████╗
  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝      ╚═════╝   ╚═╝   ╚══════╝
\x1b[0m`;

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;
const bold = (text: string) => `\x1b[1m${text}\x1b[0m`;
const cyan = (text: string) => `\x1b[36m${text}\x1b[0m`;
const green = (text: string) => `\x1b[32m${text}\x1b[0m`;
const yellow = (text: string) => `\x1b[33m${text}\x1b[0m`;

export function printDevBanner(port: string | number): void {
  if (process.env.NODE_ENV !== 'development') return;

  const pgAdminPort = process.env.PGADMIN_PORT ?? '5050';
  const auditDbPort = process.env.AUDIT_DB_PORT ?? '5432';
  const auditDbName = process.env.AUDIT_DB_NAME ?? 'backup_audit';
  const timezone = process.env.TIMEZONE ?? 'Europe/Berlin';
  const version = process.env.npm_package_version ?? '0.1.0';

  const separator = dim('  ─────────────────────────────────────────────────────');

  const lines = [
    BANNER,
    `  ${bold('backupctl')} ${dim(`v${version}`)}  ${dim('│')}  ${yellow('development mode')}`,
    '',
    separator,
    '',
    `  ${bold('Services')}`,
    `    ${green('▸')} API Server        ${cyan(`http://localhost:${port}`)}`,
    `    ${green('▸')} Health Check      ${cyan(`http://localhost:${port}/health`)}`,
    `    ${green('▸')} Backup Status     ${cyan(`http://localhost:${port}/status`)}`,
    '',
    `  ${bold('Tools')}`,
    `    ${green('▸')} pgAdmin           ${cyan(`http://localhost:${pgAdminPort}`)}`,
    '',
    `  ${bold('Database')}`,
    `    ${green('▸')} Audit DB          ${dim(`postgresql://localhost:${auditDbPort}/${auditDbName}`)}`,
    '',
    `  ${bold('CLI')}  ${dim('(inside container)')}`,
    `    ${dim('$')} backupctl run <project> --dry-run`,
    `    ${dim('$')} backupctl health`,
    `    ${dim('$')} backupctl status`,
    '',
    `  ${bold('Config')}`,
    `    ${green('▸')} Timezone          ${dim(timezone)}`,
    '',
    separator,
    '',
  ];

  console.log(lines.join('\n'));
}
