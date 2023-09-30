import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from "typeorm";

@Entity()
export class User {
  constructor(user: Partial<User>) {
    Object.assign(this, user);
  }

  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true, type: "int" })
  githubId: number;

  @Column({ type: "text" })
  avatarUrl: string;

  @Column({ type: "text" })
  name: string;
}
