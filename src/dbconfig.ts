import { DataSource } from "typeorm";
import path from "path";

const AppDataSource = new DataSource({
  type: "postgres",
  host: "localhost",
  port: 5432,
  username: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  entities: [path.join(__dirname, "entities", "*.js")],
});

async function getEm() {
  // Initialize connection
  await AppDataSource.initialize();
  // Sync the schema
  await AppDataSource.synchronize();

  // Return the manage
  return AppDataSource.manager;
}

export const globalEm = getEm();
