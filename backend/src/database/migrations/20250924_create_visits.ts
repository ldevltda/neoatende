import { QueryInterface, DataTypes } from "sequelize";

module.exports = {
  up: async (qi: QueryInterface) => {
    await qi.createTable("Visits", {
      id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      companyId: { type: DataTypes.INTEGER, allowNull: false },
      ticketId: { type: DataTypes.INTEGER, allowNull: false },
      contactId: { type: DataTypes.INTEGER, allowNull: false },
      propertyCode: { type: DataTypes.STRING, allowNull: true },
      propertyUrl: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: "requested" },
      when: { type: DataTypes.DATE, allowNull: true },
      notes: { type: DataTypes.TEXT, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    });
    await qi.addIndex("Visits", ["companyId", "ticketId"], { name: "visits_company_ticket_idx" });
  },

  down: async (qi: QueryInterface) => {
    await qi.dropTable("Visits");
  }
};
