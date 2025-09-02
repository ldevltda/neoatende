import { QueryInterface } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.transaction(async t => {
      // Garante o plano e obtém o id (create-if-not-exists)
      const [planRows] = await queryInterface.sequelize.query(
        `
        WITH ins_plan AS (
          INSERT INTO "Plans" ("name","users","connections","queues","value","createdAt","updatedAt")
          VALUES ('Plano 1', 10, 10, 10, 30, NOW(), NOW())
          ON CONFLICT ("name") DO NOTHING
          RETURNING id
        )
        SELECT id FROM ins_plan
        UNION ALL
        SELECT id FROM "Plans" WHERE "name" = 'Plano 1'
        LIMIT 1;
        `,
        { transaction: t }
      );

      const planId = (planRows as Array<{ id: number }>)[0].id;

      // Garante a empresa e obtém o id (create-if-not-exists)
      const [companyRows] = await queryInterface.sequelize.query(
        `
        WITH ins_company AS (
          INSERT INTO "Companies" ("name","planId","dueDate","createdAt","updatedAt")
          VALUES ('Empresa 1', :planId, '2093-03-14 04:00:00+01'::timestamptz, NOW(), NOW())
          ON CONFLICT ("name") DO NOTHING
          RETURNING id
        )
        SELECT id FROM ins_company
        UNION ALL
        SELECT id FROM "Companies" WHERE "name" = 'Empresa 1'
        LIMIT 1;
        `,
        { transaction: t, replacements: { planId } }
      );

      const companyId = (companyRows as Array<{ id: number }>)[0].id;

      // (Opcional) se quiser garantir que a empresa existente esteja vinculada ao planId acima:
      await queryInterface.sequelize.query(
        `
        UPDATE "Companies"
           SET "planId" = :planId,
               "updatedAt" = NOW()
         WHERE id = :companyId
           AND "planId" <> :planId;
        `,
        { transaction: t, replacements: { planId, companyId } }
      );
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.bulkDelete("Companies", { name: "Empresa 1" });
    await queryInterface.bulkDelete("Plans", { name: "Plano 1" });
  }
};
