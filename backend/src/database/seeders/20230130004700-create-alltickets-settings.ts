import { QueryInterface } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.transaction(async t => {
      const upsertSql = `
        INSERT INTO "Settings" ("key","value","createdAt","updatedAt")
        VALUES ('allTicket', 'disabled', NOW(), NOW())
        ON CONFLICT ("key")
        DO UPDATE SET
          "value" = EXCLUDED."value",
          "updatedAt" = NOW();
      `;

      await queryInterface.sequelize.query(upsertSql, { transaction: t });
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.bulkDelete("Settings", { key: "allTicket" });
  }
};
