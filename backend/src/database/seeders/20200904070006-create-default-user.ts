import { QueryInterface } from "sequelize";
import { hash } from "bcryptjs";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    return queryInterface.sequelize.transaction(async t => {
      const passwordHash = await hash("123456", 8);

      // Verifica se já existe
      const [user] = await queryInterface.sequelize.query(
        `SELECT id FROM "Users" WHERE email = :email LIMIT 1`,
        {
          replacements: { email: "admin@admin.com" },
          transaction: t
        }
      );

      if (!user || user.length === 0) {
        await queryInterface.bulkInsert(
          "Users",
          [
            {
              name: "Admin",
              email: "admin@admin.com",
              profile: "admin",
              passwordHash,
              companyId: 1,
              createdAt: new Date(),
              updatedAt: new Date(),
              super: true
            }
          ],
          { transaction: t }
        );
      }
    });
  },

  down: async (queryInterface: QueryInterface) => {
    return queryInterface.bulkDelete("Users", { email: "admin@admin.com" });
  }
};
