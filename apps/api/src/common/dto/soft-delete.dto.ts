import { IsBoolean, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../pagination/pagination.dto';
import { ToBoolean } from '../validation/validators';

/** List params for resources that are soft-deleted. */
export class SoftDeleteListQueryDto extends PaginationQueryDto {
  /** Include deleted records (they carry a `deletedAt` date). */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeDeleted?: boolean;
}
