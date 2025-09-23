// backend/src/models/Setting.ts

import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  ForeignKey,
  BelongsTo,
  AutoIncrement,
  Index,
  DataType
} from "sequelize-typescript";

import Company from "./Company";

@Table({
  tableName: "Settings",
  timestamps: true
})
class Setting extends Model<Setting> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Index({ name: "settings_companyId_key_unique", unique: true })
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  // parte do índice composto com companyId
  @Index({ name: "settings_companyId_key_unique", unique: true })
  @Column({ type: DataType.STRING, allowNull: false })
  key: string;

  @Column({ type: DataType.TEXT, allowNull: false, defaultValue: "" })
  value: string;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Setting;
