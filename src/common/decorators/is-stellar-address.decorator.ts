import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';
import { StrKey } from '@stellar/stellar-sdk';

export function IsStellarAddress(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStellarAddress',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: any) {
          return typeof value === 'string' && StrKey.isValidEd25519PublicKey(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid Stellar Ed25519 public key`;
        },
      },
    });
  };
}
