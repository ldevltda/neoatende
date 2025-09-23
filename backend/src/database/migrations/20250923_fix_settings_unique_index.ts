import { QueryInterface } from "sequelize";

const TABLE = "Settings"; // ajuste se o nome for diferente no seu schema

async function tryRemove(qi: QueryInterface, name: string) {
  try { await qi.removeIndex(TABLE, name as any); } catch {}
  try { await qi.removeConstraint(TABLE, name as any); } catch {}
}

export = {
  up: async (qi: QueryInterface) => {
    // Remover possíveis índices/constraints antigos SOMENTE em `key`
    await tryRemove(qi, "Settings_key_key");
    await tryRemove(qi, "settings_key_unique");
    await tryRemove(qi, "key_unique");
    await tryRemove(qi, "unique_key");

    // fallback: tenta remover por campos (nem sempre funciona, mas não quebra)
    try { await qi.removeIndex(TABLE, ["key"] as any); } catch {}

    // Criar índice único composto (companyId, key)
    await qi.addIndex(TABLE, ["companyId", "key"], {
      unique: true,
      name: "settings_companyId_key_unique"
    });
  },

  down: async (qi: QueryInterface) => {
    // Reverte: remove o composto e recria único só em key (não recomendado em produção)
    try { await qi.removeIndex(TABLE, "settings_companyId_key_unique"); } catch {}
    await qi.addIndex(TABLE, ["key"], {
      unique: true,
      name: "settings_key_unique"
    });
  }
};
