import { MilestoneSumConstraint } from './milestone-sum.validator';
import { ValidationArguments } from 'class-validator';

describe('MilestoneSumConstraint', () => {
  let constraint: MilestoneSumConstraint;
  let mockValidationArgs: ValidationArguments;

  beforeEach(() => {
    constraint = new MilestoneSumConstraint();
    mockValidationArgs = {
      value: [],
      constraints: [],
      targetName: '',
      object: {},
      property: 'milestones',
    };
  });

  it('should pass when a single milestone is exactly 100%', () => {
    const milestones = [{ paymentPercent: 100 }];
    expect(constraint.validate(milestones, mockValidationArgs)).toBe(true);
  });

  it('should pass when multiple milestones sum to exactly 100%', () => {
    const milestones = [{ paymentPercent: 30 }, { paymentPercent: 70 }];
    expect(constraint.validate(milestones, mockValidationArgs)).toBe(true);
  });

  it('should fail when milestones sum to less than 100% (under-sum)', () => {
    const milestones = [{ paymentPercent: 40 }, { paymentPercent: 30 }];
    expect(constraint.validate(milestones, mockValidationArgs)).toBe(false);
  });

  it('should fail when milestones sum to more than 100% (over-sum)', () => {
    const milestones = [{ paymentPercent: 40 }, { paymentPercent: 40 }, { paymentPercent: 40 }];
    expect(constraint.validate(milestones, mockValidationArgs)).toBe(false);
  });

  it('should fail when a single milestone is not exactly 100%', () => {
    const milestones = [{ paymentPercent: 99 }];
    expect(constraint.validate(milestones, mockValidationArgs)).toBe(false);
  });

  it('should generate the correct error message with the actual sum', () => {
    const milestones = [{ paymentPercent: 40 }, { paymentPercent: 40 }, { paymentPercent: 40 }];
    mockValidationArgs.value = milestones;
    
    const errorMessage = constraint.defaultMessage(mockValidationArgs);
    expect(errorMessage).toBe('Milestone payment percentages must sum to exactly 100. Got 120.');
  });
});