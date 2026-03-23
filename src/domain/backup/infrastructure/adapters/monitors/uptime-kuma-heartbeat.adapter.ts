import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { HeartbeatMonitorPort } from '@domain/backup/application/ports/heartbeat-monitor.port';

const HEARTBEAT_TIMEOUT_MS = 5000;
const MAX_MESSAGE_LENGTH = 200;

@Injectable()
export class UptimeKumaHeartbeatAdapter implements HeartbeatMonitorPort {
  private readonly baseUrl: string | undefined;

  constructor(configService: ConfigService) {
    this.baseUrl = configService.get<string>('UPTIME_KUMA_BASE_URL');
  }

  async sendHeartbeat(
    pushToken: string,
    status: 'up' | 'down',
    message: string,
    durationMs: number,
  ): Promise<void> {
    if (!this.baseUrl) return;

    const url = new URL(`/api/push/${pushToken}`, this.baseUrl);
    url.searchParams.set('status', status);
    url.searchParams.set('msg', message.slice(0, MAX_MESSAGE_LENGTH));
    url.searchParams.set('ping', String(durationMs));

    await axios.get(url.toString(), { timeout: HEARTBEAT_TIMEOUT_MS });
  }

  async checkConnectivity(): Promise<boolean> {
    if (!this.baseUrl) return false;

    try {
      const response = await axios.get(this.baseUrl, { timeout: HEARTBEAT_TIMEOUT_MS });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
