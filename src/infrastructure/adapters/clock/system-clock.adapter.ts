import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClockPort } from '@domain/shared/ports/clock.port';
import { formatTimestamp } from '@shared/format.util';

@Injectable()
export class SystemClockAdapter implements ClockPort {
  private readonly timezone: string;

  constructor(configService: ConfigService) {
    this.timezone = configService.get<string>('TIMEZONE', 'Europe/Berlin');
  }

  now(): Date {
    return new Date();
  }

  timestamp(): string {
    return formatTimestamp(this.now(), this.timezone);
  }
}
