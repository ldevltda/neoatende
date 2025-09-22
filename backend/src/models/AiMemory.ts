import {
  Table, Column, Model, DataType, PrimaryKey, AutoIncrement, AllowNull, Default, Index,
  CreatedAt, UpdatedAt
} from "sequelize-typescript";

@Table({ tableName: "AiMemories" })
export default class AiMemory extends Model<AiMemory> {
  @PrimaryKey
  @AutoIncrement
  @AllowNull(false)
  @Column(DataType.INTEGER)
  id!: number;

  @AllowNull(false)
  @Index
  @Column(DataType.INTEGER)
  companyId!: number;

  @AllowNull(false)
  @Index
  @Column(DataType.INTEGER)
  contactId!: number;

  @AllowNull(false)
  @Column(DataType.STRING(120))
  key!: string;

  @AllowNull(false)
  @Column(DataType.TEXT)
  value!: string;

  @AllowNull(false)
  @Default(0.8)
  @Column(DataType.DECIMAL(5,2))
  confidence!: number;

  @AllowNull(true)
  @Column(DataType.JSONB)
  metadata?: any;

  @CreatedAt
  @Column(DataType.DATE)
  createdAt!: Date;

  @UpdatedAt
  @Column(DataType.DATE)
  updatedAt!: Date;
}
