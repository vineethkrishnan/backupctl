import { RetentionPolicy } from '@domain/config/domain/retention-policy.model';

describe('RetentionPolicy', () => {
  it('should accept valid values where all are >= 0', () => {
    const policy = new RetentionPolicy(7, 14, 4, 6);

    expect(policy.localDays).toBe(7);
    expect(policy.keepDaily).toBe(14);
    expect(policy.keepWeekly).toBe(4);
    expect(policy.keepMonthly).toBe(6);
  });

  it('should accept zero values', () => {
    const policy = new RetentionPolicy(0, 0, 0, 0);

    expect(policy.localDays).toBe(0);
    expect(policy.keepDaily).toBe(0);
    expect(policy.keepWeekly).toBe(0);
    expect(policy.keepMonthly).toBe(0);
  });

  it('should default keepMonthly to 0', () => {
    const policy = new RetentionPolicy(7, 14, 4);

    expect(policy.keepMonthly).toBe(0);
  });

  it('should throw on negative localDays', () => {
    expect(() => new RetentionPolicy(-1, 14, 4)).toThrow('localDays must be >= 0');
  });

  it('should throw on negative keepDaily', () => {
    expect(() => new RetentionPolicy(7, -1, 4)).toThrow('keepDaily must be >= 0');
  });

  it('should throw on negative keepWeekly', () => {
    expect(() => new RetentionPolicy(7, 14, -1)).toThrow('keepWeekly must be >= 0');
  });

  it('should throw on negative keepMonthly', () => {
    expect(() => new RetentionPolicy(7, 14, 4, -1)).toThrow('keepMonthly must be >= 0');
  });
});
