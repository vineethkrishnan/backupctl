import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { UptimeKumaHeartbeatAdapter } from '@domain/backup/infrastructure/adapters/monitors/uptime-kuma-heartbeat.adapter';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

function createConfigService(baseUrl?: string): ConfigService {
  return {
    get: jest.fn((key: string) => {
      if (key === 'UPTIME_KUMA_BASE_URL') return baseUrl;
      return undefined;
    }),
  } as unknown as ConfigService;
}

describe('UptimeKumaHeartbeatAdapter', () => {
  const baseUrl = 'http://uptime-kuma:3001';

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendHeartbeat', () => {
    it('should send HTTP GET with correct URL and query params on success', async () => {
      const adapter = new UptimeKumaHeartbeatAdapter(createConfigService(baseUrl));
      mockedAxios.get.mockResolvedValue({ status: 200 });

      await adapter.sendHeartbeat('abc123', 'up', 'OK - 3m 12s', 192000);

      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      const url = new URL(mockedAxios.get.mock.calls[0][0] as string);
      expect(url.pathname).toBe('/api/push/abc123');
      expect(url.searchParams.get('status')).toBe('up');
      expect(url.searchParams.get('msg')).toBe('OK - 3m 12s');
      expect(url.searchParams.get('ping')).toBe('192000');
    });

    it('should send status=down on backup failure', async () => {
      const adapter = new UptimeKumaHeartbeatAdapter(createConfigService(baseUrl));
      mockedAxios.get.mockResolvedValue({ status: 200 });

      await adapter.sendHeartbeat('abc123', 'down', 'FAIL - sync: connection timeout', 342000);

      const url = new URL(mockedAxios.get.mock.calls[0][0] as string);
      expect(url.searchParams.get('status')).toBe('down');
      expect(url.searchParams.get('msg')).toBe('FAIL - sync: connection timeout');
      expect(url.searchParams.get('ping')).toBe('342000');
    });

    it('should truncate message to 200 characters', async () => {
      const adapter = new UptimeKumaHeartbeatAdapter(createConfigService(baseUrl));
      mockedAxios.get.mockResolvedValue({ status: 200 });
      const longMessage = 'A'.repeat(300);

      await adapter.sendHeartbeat('abc123', 'up', longMessage, 1000);

      const url = new URL(mockedAxios.get.mock.calls[0][0] as string);
      expect(url.searchParams.get('msg')).toHaveLength(200);
    });

    it('should set 5000ms timeout on the HTTP call', async () => {
      const adapter = new UptimeKumaHeartbeatAdapter(createConfigService(baseUrl));
      mockedAxios.get.mockResolvedValue({ status: 200 });

      await adapter.sendHeartbeat('abc123', 'up', 'OK', 1000);

      const config = mockedAxios.get.mock.calls[0][1] as Record<string, unknown>;
      expect(config.timeout).toBe(5000);
    });

    it('should be a no-op when UPTIME_KUMA_BASE_URL is not set', async () => {
      const adapter = new UptimeKumaHeartbeatAdapter(createConfigService(undefined));

      await adapter.sendHeartbeat('abc123', 'up', 'OK', 1000);

      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should propagate errors from axios', async () => {
      const adapter = new UptimeKumaHeartbeatAdapter(createConfigService(baseUrl));
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      await expect(
        adapter.sendHeartbeat('abc123', 'up', 'OK', 1000),
      ).rejects.toThrow('Network error');
    });
  });

  describe('checkConnectivity', () => {
    it('should return true when Kuma responds with 200', async () => {
      const adapter = new UptimeKumaHeartbeatAdapter(createConfigService(baseUrl));
      mockedAxios.get.mockResolvedValue({ status: 200 });

      const result = await adapter.checkConnectivity();

      expect(result).toBe(true);
      expect(mockedAxios.get).toHaveBeenCalledWith(baseUrl, { timeout: 5000 });
    });

    it('should return false when Kuma is unreachable', async () => {
      const adapter = new UptimeKumaHeartbeatAdapter(createConfigService(baseUrl));
      mockedAxios.get.mockRejectedValue(new Error('Connection refused'));

      const result = await adapter.checkConnectivity();

      expect(result).toBe(false);
    });

    it('should return false when UPTIME_KUMA_BASE_URL is not set', async () => {
      const adapter = new UptimeKumaHeartbeatAdapter(createConfigService(undefined));

      const result = await adapter.checkConnectivity();

      expect(result).toBe(false);
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });
  });
});
