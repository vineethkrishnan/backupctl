export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const threshold = 1024;

  let unitIndex = 0;
  let value = bytes;

  while (value >= threshold && unitIndex < units.length - 1) {
    value /= threshold;
    unitIndex++;
  }

  if (unitIndex === 0) return `${value} B`;
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatTimestamp(date: Date, timezone = 'Europe/Berlin'): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const partMap = new Map(parts.map((part) => [part.type, part.value]));

  const year = partMap.get('year');
  const month = partMap.get('month');
  const day = partMap.get('day');
  const hour = partMap.get('hour');
  const minute = partMap.get('minute');
  const second = partMap.get('second');

  return `${year}${month}${day}_${hour}${minute}${second}`;
}
