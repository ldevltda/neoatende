"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("OpenAiSettings", "model", {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: "gpt-4o-mini"
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn("OpenAiSettings", "model");
  }
};
