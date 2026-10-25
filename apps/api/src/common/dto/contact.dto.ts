import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsE164Phone } from '../validation/validators';

/** The person to talk to at a customer or supplier. */
export class ContactDto {
  /** @example "Maria Anders" */
  name: string;
  /** @example "Sales Representative" */
  title: string | null;
  /** @example maria.anders@alfreds-futterkiste.example */
  email: string | null;
  /** E.164 where the number could be converted; older numbers are kept as written. @example +49300074321 */
  phone: string | null;
}

export class ContactInputDto {
  /** @example "Maria Anders" */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** @example "Sales Representative" */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string | null;

  /** @example maria.anders@alfreds-futterkiste.example */
  @IsOptional()
  @IsEmail()
  email?: string | null;

  /** E.164 format. @example +49300074321 */
  @IsOptional()
  @IsE164Phone()
  phone?: string | null;
}
