import { Dialect } from "sequelize";
import dotenv from "dotenv";

dotenv.config();

type NodeEnv = "development" | "test" | "production";
const env: NodeEnv = (process.env.NODE_ENV as NodeEnv) || "development";

const DB_SSL =
  String(process.env.DB_SSL || "").toLowerCase() === "true" ? true : false;

const common = {
  timezone: "America/Sao_Paulo",
  logging: false,
  dialectOptions: {
    ssl: DB_SSL
      ? {
          require: true,
          rejectUnauthorized: false, // ajuste conforme seu provedor
        }
      : false,
  },
};

function safePort(p: string | number | undefined, fallback: number) {
  const n = Number(p);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function fromDatabaseUrl(urlStr: string) {
  const u = new URL(urlStr);

  // força um dialect válido
  const proto = (u.protocol || "").replace(":", "");
  const dialect: Dialect = (proto as Dialect) || "postgres";

  const database = decodeURIComponent(u.pathname.replace(/^\//, ""));
  const username = decodeURIComponent(u.username || "");
  const password = decodeURIComponent(u.password || "");
  const host = u.hostname || "localhost";
  const defaultPort = dialect === "postgres" ? 5432 : 3306;
  const port = safePort(u.port, defaultPort);

  return {
    [env]: {
      username,
      password,
      database,
      host,
      port,
      dialect,
      ...common,
    },
  };
}

function fromDiscreteEnv() {
  const dialect: Dialect = (process.env.DB_DIALECT as Dialect) || "postgres";
  const host = process.env.DB_HOST || "postgres";
  const defaultPort = dialect === "postgres" ? 5432 : 3306;
  const port = safePort(process.env.DB_PORT, defaultPort);

  return {
    [env]: {
      username: process.env.DB_USER || "postgres",
      password: process.env.DB_PASS || "postgres123",
      database: process.env.DB_NAME || "codatende",
      host,
      port,
      dialect,
      ...common,
    },
  };
}

let cfg: Record<string, any>;
try {
  cfg =
    process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== ""
      ? fromDatabaseUrl(process.env.DATABASE_URL)
      : fromDiscreteEnv();
} catch {
  // Se a URL estiver inválida, cai para o modo por variáveis discretas
  cfg = fromDiscreteEnv();
}

export default cfg;
// Compatibilidade com `require()` caso o sequelize-cli espere CommonJS
// (se não precisar, pode remover a linha abaixo)
module.exports = cfg;
