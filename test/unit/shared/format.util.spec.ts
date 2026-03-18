import { formatBytes, formatDuration, formatTimestamp } from '../../../src/shared/format.util';

describe('formatBytes', () => {
  it('should return "0 B" for zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('should format bytes below 1 KB', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('should format kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(1536)).toBe('1.50 KB');
  });

  it('should format megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.00 MB');
    expect(formatBytes(5242880)).toBe('5.00 MB');
  });

  it('should format gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1.00 GB');
    expect(formatBytes(2684354560)).toBe('2.50 GB');
  });
});

describe('formatDuration', () => {
  it('should return "<1s" for durations under 1000ms', () => {
    expect(formatDuration(0)).toBe('<1s');
    expect(formatDuration(500)).toBe('<1s');
    expect(formatDuration(999)).toBe('<1s');
  });

  it('should format seconds', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(45000)).toBe('45s');
  });

  it('should format minutes and seconds', () => {
    expect(formatDuration(192000)).toBe('3m 12s');
    expect(formatDuration(60000)).toBe('1m 0s');
  });

  it('should format hours and minutes', () => {
    expect(formatDuration(3900000)).toBe('1h 5m');
    expect(formatDuration(7200000)).toBe('2h 0m');
  });
});

describe('formatTimestamp', () => {
  it('should return YYYYMMDD_HHmmss format', () => {
    const date = new Date('2026-03-18T14:30:45Z');
    const result = formatTimestamp(date, 'UTC');

    expect(result).toBe('20260318_143045');
  });

  it('should respect timezone parameter', () => {
    const date = new Date('2026-03-18T14:30:45Z');
    const utcResult = formatTimestamp(date, 'UTC');
    const berlinResult = formatTimestamp(date, 'Europe/Berlin');

    expect(utcResult).toBe('20260318_143045');
    expect(berlinResult).toBe('20260318_153045');
  });

  it('should default to Europe/Berlin timezone', () => {
    const date = new Date('2026-03-18T14:30:45Z');
    const defaultResult = formatTimestamp(date);
    const berlinResult = formatTimestamp(date, 'Europe/Berlin');

    expect(defaultResult).toBe(berlinResult);
  });
});
