import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement
} from "sequelize-typescript";

@Table
class OpenAiSettings extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: number;

  @Column(DataType.STRING)
  name!: string;

  @Column(DataType.TEXT)
  prompt!: string;

  @Column(DataType.STRING)
  voice!: string;

  @Column(DataType.STRING)
  voiceKey!: string;

  @Column(DataType.STRING)
  voiceRegion!: string;

  @Column(DataType.INTEGER)
  maxTokens!: number;

  @Column(DataType.FLOAT)
  temperature!: number;

  @Column(DataType.STRING)
  apiKey!: string;

  @Column(DataType.INTEGER)
  queueId!: number;

  @Column(DataType.INTEGER)
  maxMessages!: number;

  // NOVO
  @Column(DataType.STRING)
  model!: string; // ex.: gpt-4o-mini, gpt-4o, etc.
}

export default OpenAiSettings;
