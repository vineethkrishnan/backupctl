import { ConfigService } from '@nestjs/config';
import { SystemClockAdapter } from '@infrastructure/adapters/clock/system-clock.adapter';

describe('SystemClockAdapter', () => {
  function createAdapter(timezone?: string): SystemClockAdapter {
    const configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === 'TIMEZONE') return timezone ?? defaultValue ?? 'Europe/Berlin';
        return defaultValue;
      }),
    } as unknown as ConfigService;

    return new SystemClockAdapter(configService);
  }

  describe('now', () => {
    it('should return a Date instance', () => {
      const adapter = createAdapter();
      const result = adapter.now();

      expect(result).toBeInstanceOf(Date);
    });

    it('should return a date close to the current time', () => {
      const adapter = createAdapter();
      const before = Date.now();
      const result = adapter.now();
      const after = Date.now();

      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('timestamp', () => {
    it('should return a string matching YYYYMMDD_HHmmss pattern', () => {
      const adapter = createAdapter();
      const result = adapter.timestamp();

      expect(result).toMatch(/^\d{8}_\d{6}$/);
    });

    it('should use the configured timezone', () => {
      const utcAdapter = createAdapter('UTC');
      const berlinAdapter = createAdapter('Europe/Berlin');

      const utcResult = utcAdapter.timestamp();
      const berlinResult = berlinAdapter.timestamp();

      expect(utcResult).toMatch(/^\d{8}_\d{6}$/);
      expect(berlinResult).toMatch(/^\d{8}_\d{6}$/);
    });

    it('should default to Europe/Berlin when TIMEZONE is not set', () => {
      const adapter = createAdapter();

      jest.spyOn(adapter, 'now').mockReturnValue(new Date('2026-03-18T22:00:00Z'));
      const result = adapter.timestamp();

      // 22:00 UTC = 23:00 CET (Europe/Berlin in winter) or 00:00 CEST (summer)
      // March 18 2026: CET → CEST switch is March 29, so still CET (+1)
      expect(result).toBe('20260318_230000');
    });
  });
});
