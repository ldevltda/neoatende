import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.addColumn("Tickets", "leadScore", {
      type: DataTypes.INTEGER,
      allowNull: true
    });
    await queryInterface.addColumn("Tickets", "leadStage", {
      type: DataTypes.STRING,
      allowNull: true
    });
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.removeColumn("Tickets", "leadScore");
    await queryInterface.removeColumn("Tickets", "leadStage");
  }
};
