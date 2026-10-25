import type { Model, PipelineStage } from 'mongoose';
import {
  paginate,
  type Paginated,
  type PaginationQueryDto,
  toSkip,
} from '../pagination/pagination';

/** Runs a pipeline and returns one page plus the total, in a single round trip. */
export async function aggregatePage<T>(
  model: Model<T>,
  pipeline: PipelineStage[],
  query: Pick<PaginationQueryDto, 'page' | 'limit'>,
): Promise<Paginated<unknown>> {
  const [result] = await model.aggregate<{
    data: unknown[];
    total: { n: number }[];
  }>([
    ...pipeline,
    {
      $facet: {
        data: [{ $skip: toSkip(query) }, { $limit: query.limit }],
        total: [{ $count: 'n' }],
      },
    },
  ]);
  return paginate(result?.data ?? [], result?.total[0]?.n ?? 0, query);
}
