import { QueryInterface } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.transaction(async t => {
      // Lista de pares key/value a garantir para companyId = 1
      const settings: Array<{ key: string; value: string }> = [
        { key: "chatBotType", value: "text" },
        { key: "sendGreetingAccepted", value: "disabled" },
        { key: "sendMsgTransfTicket", value: "disabled" },
        { key: "sendGreetingMessageOneQueues", value: "disabled" },
        { key: "userRating", value: "disabled" },
        { key: "scheduleType", value: "queue" },
        { key: "CheckMsgIsGroup", value: "enabled" },
        { key: "call", value: "disabled" },
        { key: "ipixc", value: "" },
        { key: "tokenixc", value: "" },
        { key: "ipmkauth", value: "" },
        { key: "clientidmkauth", value: "" },
        { key: "clientsecretmkauth", value: "" },
        { key: "asaas", value: "" }
      ];

      // Monta o VALUES (...),(...)
      const valuesSql = settings
        .map(
          s =>
            `('${s.key.replace(/'/g, "''")}', '${s.value.replace(/'/g, "''")}', 1, NOW(), NOW())`
        )
        .join(",\n");

      // UPSERT por (key, companyId). É esperado haver UNIQUE em ("key","companyId")
      const upsertSql = `
        INSERT INTO "Settings" ("key","value","companyId","createdAt","updatedAt")
        VALUES
        ${valuesSql}
        ON CONFLICT ("key","companyId")
        DO UPDATE SET
          "value" = EXCLUDED."value",
          "updatedAt" = NOW();
      `;

      await queryInterface.sequelize.query(upsertSql, { transaction: t });
    });
  },

  down: async (queryInterface: QueryInterface) => {
    const keys = [
      "chatBotType",
      "sendGreetingAccepted",
      "sendMsgTransfTicket",
      "sendGreetingMessageOneQueues",
      "userRating",
      "scheduleType",
      "CheckMsgIsGroup",
      "call",
      "ipixc",
      "tokenixc",
      "ipmkauth",
      "clientidmkauth",
      "clientsecretmkauth",
      "asaas"
    ];

    // Remove apenas os registros que você inseriu/garantiu (companyId = 1 e keys listadas)
    await queryInterface.bulkDelete("Settings", {
      companyId: 1,
      key: keys
    });
  }
};
