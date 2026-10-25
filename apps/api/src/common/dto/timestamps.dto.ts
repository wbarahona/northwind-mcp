/** Fields every stored record has. */
export class TimestampsDto {
  /** When the record was created in this database (seeding counts as creation). */
  createdAt: Date;
  /** When the record was last changed. */
  updatedAt: Date;
}
