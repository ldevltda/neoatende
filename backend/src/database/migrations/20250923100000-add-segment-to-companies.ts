import { QueryInterface, DataTypes } from "sequelize";

const TABLE = "Companies";
const COL = "segment";

export = {
  up: async (qi: QueryInterface) => {
    await qi.addColumn(TABLE, COL, {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: "imoveis", // default seguro pro teu momento
    });
    await qi.addIndex(TABLE, [COL], { name: "idx_companies_segment" });
  },
  down: async (qi: QueryInterface) => {
    await qi.removeIndex(TABLE, "idx_companies_segment");
    await qi.removeColumn(TABLE, COL);
  }
};
