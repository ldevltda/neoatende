// backend/src/services/CompanyService/CreateCompanyService.ts

import * as Yup from "yup";
import AppError from "../../errors/AppError";
import Company from "../../models/Company";
import User from "../../models/User";
import Setting from "../../models/Setting";
import { hash } from "bcryptjs";

type SegmentType = "imoveis"; // | "veiculos" | "clinicas" | "varejo";

interface CompanyData {
  name: string;
  phone?: string;
  email?: string;
  password?: string;
  status?: boolean;
  planId?: number;
  campaignsEnabled?: boolean;
  dueDate?: string;
  recurrence?: string;
  segment?: SegmentType; // preparado para expandir no futuro
}

const CreateCompanyService = async (
  companyData: CompanyData
): Promise<Company> => {
  const {
    name,
    phone,
    email,
    status,
    planId,
    campaignsEnabled,
    dueDate,
    recurrence,
    password,
    segment = "imoveis"
  } = companyData;

  const companySchema = Yup.object().shape({
    name: Yup.string()
      .min(2, "ERR_COMPANY_INVALID_NAME")
      .required("ERR_COMPANY_INVALID_NAME")
      .test(
        "Check-unique-name",
        "ERR_COMPANY_NAME_ALREADY_EXISTS",
        async value => {
          if (value) {
            const companyWithSameName = await Company.findOne({
              where: { name: value }
            });
            return !companyWithSameName;
          }
          return false;
        }
      ),
    segment: Yup.string().oneOf(["imoveis"]).default("imoveis")
    // quando liberar novos nichos: .oneOf(["imoveis","veiculos","clinicas","varejo"])
  });

  try {
    // ⚠️ valida também o segment (antes só validava name)
    await companySchema.validate({ name, segment });
  } catch (err: any) {
    throw new AppError(err.message);
  }

  // cria empresa já com o segment
  const company = await Company.create({
    name,
    phone,
    email,
    status,
    planId,
    dueDate,
    recurrence,
    // @ts-ignore (caso o Model ainda não tenha a coluna, o Sequelize ignora)
    segment
  });

  const safePassword = password || "123456";
  const passwordHash = await hash(safePassword, 8);

  await User.create({
    name: company.name,
    email: company.email,
    password: safePassword, // mantém compatibilidade com código atual
    passwordHash,
    profile: "admin",
    companyId: company.id
  });

  // ===== Settings padrão =====

  await Setting.findOrCreate({
    where: { companyId: company.id, key: "asaas" },
    defaults: { companyId: company.id, key: "asaas", value: "" }
  });

  // tokenixc
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "tokenixc" },
    defaults: { companyId: company.id, key: "tokenixc", value: "" }
  });

  // ipixc
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "ipixc" },
    defaults: { companyId: company.id, key: "ipixc", value: "" }
  });

  // ipmkauth
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "ipmkauth" },
    defaults: { companyId: company.id, key: "ipmkauth", value: "" }
  });

  // clientsecretmkauth
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "clientsecretmkauth" },
    defaults: { companyId: company.id, key: "clientsecretmkauth", value: "" }
  });

  // clientidmkauth
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "clientidmkauth" },
    defaults: { companyId: company.id, key: "clientidmkauth", value: "" }
  });

  // ✅ CheckMsgIsGroup (corrigido: antes gravava key errada)
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "CheckMsgIsGroup" },
    defaults: { companyId: company.id, key: "CheckMsgIsGroup", value: "disabled" }
  });

  // ✅ call (corrigido: antes fazia where com key vazio "")
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "call" },
    defaults: { companyId: company.id, key: "call", value: "disabled" }
  });

  // scheduleType
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "scheduleType" },
    defaults: { companyId: company.id, key: "scheduleType", value: "disabled" }
  });

  // Enviar mensagem ao aceitar ticket
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "sendGreetingAccepted" },
    defaults: { companyId: company.id, key: "sendGreetingAccepted", value: "disabled" }
  });

  // Enviar mensagem de transferência
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "sendMsgTransfTicket" },
    defaults: { companyId: company.id, key: "sendMsgTransfTicket", value: "disabled" }
  });

  // userRating
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "userRating" },
    defaults: { companyId: company.id, key: "userRating", value: "disabled" }
  });

  // chatBotType
  await Setting.findOrCreate({
    where: { companyId: company.id, key: "chatBotType" },
    defaults: { companyId: company.id, key: "chatBotType", value: "text" }
  });

  await Setting.findOrCreate({
    where: { companyId: company.id, key: "tokensgp" },
    defaults: { companyId: company.id, key: "tokensgp", value: "" }
  });

  await Setting.findOrCreate({
    where: { companyId: company.id, key: "ipsgp" },
    defaults: { companyId: company.id, key: "ipsgp", value: "" }
  });

  await Setting.findOrCreate({
    where: { companyId: company.id, key: "appsgp" },
    defaults: { companyId: company.id, key: "appsgp", value: "" }
  });

  // campaignsEnabled (quando vier no payload)
  if (companyData.campaignsEnabled !== undefined) {
    const [setting, created] = await Setting.findOrCreate({
      where: { companyId: company.id, key: "campaignsEnabled" },
      defaults: {
        companyId: company.id,
        key: "campaignsEnabled",
        value: `${campaignsEnabled}`
      }
    });
    if (!created) {
      await setting.update({ value: `${campaignsEnabled}` });
    }
  }

  return company;
};

export default CreateCompanyService;
