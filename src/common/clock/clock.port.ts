export interface ClockPort {
  now(): Date;
  timestamp(): string;
}
