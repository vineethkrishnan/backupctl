export class RetentionPolicy {
  readonly localDays: number;
  readonly keepDaily: number;
  readonly keepWeekly: number;
  readonly keepMonthly: number;

  constructor(localDays: number, keepDaily: number, keepWeekly: number, keepMonthly: number = 0) {
    if (localDays < 0) {
      throw new Error('localDays must be >= 0');
    }
    if (keepDaily < 0) {
      throw new Error('keepDaily must be >= 0');
    }
    if (keepWeekly < 0) {
      throw new Error('keepWeekly must be >= 0');
    }
    if (keepMonthly < 0) {
      throw new Error('keepMonthly must be >= 0');
    }

    this.localDays = localDays;
    this.keepDaily = keepDaily;
    this.keepWeekly = keepWeekly;
    this.keepMonthly = keepMonthly;
  }
}
