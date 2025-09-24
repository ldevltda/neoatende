import {
  Table, Column, Model, DataType, ForeignKey, BelongsTo, PrimaryKey, AutoIncrement, Index, AllowNull, Default
} from "sequelize-typescript";
import Company from "./Company";
import Ticket from "./Ticket";
import Contact from "./Contact";

@Table({
  tableName: "Visits",
  timestamps: true,
  indexes: [
    { name: "visits_company_ticket_idx", fields: ["companyId", "ticketId"] }
  ]
})
export default class Visit extends Model<Visit> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id!: number;

  @ForeignKey(() => Company)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  companyId!: number;

  @ForeignKey(() => Ticket)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  ticketId!: number;

  @ForeignKey(() => Contact)
  @AllowNull(false)
  @Column(DataType.INTEGER)
  contactId!: number;

  // referência do imóvel (código interno ou URL)
  @Column(DataType.STRING)
  propertyCode!: string;

  @Column(DataType.STRING)
  propertyUrl!: string;

  // requested | proposed | confirmed | done | canceled
  @Default("requested")
  @Column(DataType.STRING)
  status!: string;

  @Column(DataType.DATE)
  when!: Date | null;

  @Column(DataType.TEXT)
  notes!: string | null;

  @BelongsTo(() => Company) company!: Company;
  @BelongsTo(() => Ticket) ticket!: Ticket;
  @BelongsTo(() => Contact) contact!: Contact;
}
