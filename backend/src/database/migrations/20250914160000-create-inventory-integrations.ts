import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.createTable("InventoryIntegrations", {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
      },
      name: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      categoryHint: {
        type: DataTypes.TEXT,
        allowNull: true
      },
      endpoint: {
        type: DataTypes.JSONB,
        allowNull: false
      },
      auth: {
        type: DataTypes.JSONB,
        allowNull: false
      },
      pagination: {
        type: DataTypes.JSONB,
        allowNull: false
      },
      schema: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      rolemap: {
        type: DataTypes.JSONB,
        allowNull: true
      },
      companyId: {
        type: DataTypes.INTEGER,
        references: { model: "Companies", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL"
      },
      createdAt: {
        type: DataTypes.DATE(6),
        allowNull: false
      },
      updatedAt: {
        type: DataTypes.DATE(6),
        allowNull: false
      }
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.dropTable("InventoryIntegrations");
  }
};
