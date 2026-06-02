import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

@ValidatorConstraint({ name: 'milestonePercentagesSum', async: false })
export class MilestoneSumConstraint implements ValidatorConstraintInterface {
  validate(milestones: any[], args: ValidationArguments) {
    if (!Array.isArray(milestones)) return false;
    
    const sum = milestones.reduce((total, m) => total + (m?.paymentPercent || 0), 0);
    return sum === 100;
  }

  defaultMessage(args: ValidationArguments) {
    const milestones = args.value;
    const sum = Array.isArray(milestones)
      ? milestones.reduce((total, m) => total + (m?.paymentPercent || 0), 0)
      : 0;
      
    return `Milestone payment percentages must sum to exactly 100. Got ${sum}.`;
  }
}

// Export the decorator to be used in the DTO
export function IsMilestoneSumValid(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: MilestoneSumConstraint,
    });
  };
}