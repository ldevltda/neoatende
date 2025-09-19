import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo,
  Default
} from "sequelize-typescript";
import Company from "./Company";

@Table({
  tableName: "InventoryIntegrations"
})
class InventoryIntegration extends Model<InventoryIntegration> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column(DataType.TEXT)
  name: string;

  /** dica de categoria (imovel|carro|produto|servico...) */
  @Default(null)
  @Column(DataType.TEXT)
  categoryHint: string | null;

  /** Endpoint + headers + query/body default */
  @Column(DataType.JSONB)
  endpoint: {
    method: "GET" | "POST";
    url: string;
    default_query?: Record<string, any>;
    default_body?: Record<string, any>;
    headers?: Record<string, string>;
    timeout_s?: number;
  };

  /** Auth genérica */
  @Column(DataType.JSONB)
  auth: {
    type: "none" | "api_key" | "bearer" | "basic";
    in?: "header" | "query";
    name?: string;     // Authorization | key
    prefix?: string;   // Bearer
    key?: string;      // token | api_key
    username?: string; // basic
    password?: string; // basic
  };

  /** Paginação (naming por integração) */
  @Column(DataType.JSONB)
  pagination: {
    strategy: "none" | "page" | "offset" | "cursor";
    page_param?: string;   // ex.: "page"
    size_param?: string;   // ex.: "per_page", "limit"
    offset_param?: string; // quando strategy = offset
    cursor_param?: string; // quando strategy = cursor
    page_size_default?: number;
  };

  /** Resultado da inferência de schema (amostra + caminhos) */
  @Default(null)
  @Column(DataType.JSONB)
  schema: Record<string, any> | null;

  /** Papel dos campos (onde achar lista, id, title, etc) + querymap */
  @Default(null)
  @Column(DataType.JSONB)
  rolemap:
    | {
        list_path?: string | null;
        /** mapeamento de filtros canônicos -> nome de parâmetro dessa API */
        querymap?: Record<string, string> | null;
        fields?: {
          id?: string | null;
          title?: string | null;
          price?: string | null;
          images?: string | null; // caminho array: photos[].url
          status?: string | null;
          url?: string | null;
          description?: string | null;
          location?: {
            cidade?: string | null;
            uf?: string | null;
            bairro?: string | null;
          };
        };
      }
    | null;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @CreatedAt
  @Column(DataType.DATE(6))
  createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(6))
  updatedAt: Date;
}

export default InventoryIntegration;
