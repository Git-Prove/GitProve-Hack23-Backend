import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity()
export class Session {
  @PrimaryColumn("varchar", { length: 255 })
  sid: string;

  @Column("text")
  sess: string;

  @Column("timestamptz")
  expire: Date;
}
