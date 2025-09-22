import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("AiMemories", {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      contactId: { type: DataTypes.INTEGER, allowNull: false },
      key: { type: DataTypes.STRING(120), allowNull: false },
      value: { type: DataTypes.TEXT, allowNull: false },
      confidence: { type: DataTypes.DECIMAL(5,2), allowNull: false, defaultValue: 0.80 },
      metadata: { type: DataTypes.JSONB, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false }
    });

    // índices normais
    await queryInterface.addIndex("AiMemories", ["companyId", "contactId"]);

    // índice ÚNICO (equivalente ao constraint)
    await queryInterface.addIndex("AiMemories", ["companyId", "contactId", "key"], {
      unique: true,
      name: "ai_memories_company_contact_key_uq"
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeIndex("AiMemories", "ai_memories_company_contact_key_uq");
    await queryInterface.removeIndex("AiMemories", ["companyId", "contactId"]);
    await queryInterface.dropTable("AiMemories");
  }
};
