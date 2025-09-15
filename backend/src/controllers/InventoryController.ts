import { Request, Response } from "express";
import * as Yup from "yup";
import AppError from "../errors/AppError";
import InventoryIntegration from "../models/InventoryIntegration";
import { fetchSamplesAndInfer } from "../services/InventoryServices/InferSchemaService";
import { ensureRolemap } from "../services/InventoryServices/RoleMapperService";
import { runSearch } from "../services/InventoryServices/RunSearchService";

/**
 * Schema flexível:
 * - auth é OPCIONAL (default: { type: "none", in: "header" })
 * - pagination é OPCIONAL (default: strategy "none")
 * - endpoint.url aceita URL crua (com JSON no query); checamos só http/https
 * - endpoint.default_* e headers defaultam para {}
 */
const createSchema = Yup.object({
  name: Yup.string().required(),
  companyId: Yup.number().optional(),

  categoryHint: Yup.string().nullable(),

  endpoint: Yup.object({
    method: Yup.mixed<"GET" | "POST">().oneOf(["GET", "POST"]).required(),
    // ⬇️ aceitar URL crua: só exige http/https
    url: Yup.string()
      .required("endpoint.url é obrigatório")
      .test("httpish", "endpoint.url deve iniciar com http:// ou https://", v =>
        typeof v === "string" && /^https?:\/\//i.test(v.trim())
      ),
    default_query: Yup.mixed().default({}),
    default_body: Yup.mixed().default({}),
    headers: Yup.mixed().default({}),
    timeout_s: Yup.number().default(8)
  }).required(),

  auth: Yup.object({
    type: Yup.mixed<"none" | "api_key" | "bearer" | "basic">()
      .oneOf(["none", "api_key", "bearer", "basic"])
      .default("none"),
    in: Yup.mixed<"header" | "query">().oneOf(["header", "query"]).default("header"),
    name: Yup.string().default(""),
    prefix: Yup.string().default(""),
    key: Yup.string().default(""),
    username: Yup.string().default(""),
    password: Yup.string().default("")
  }).default({ type: "none", in: "header" }),

  pagination: Yup.object({
    strategy: Yup.mixed<"none" | "page" | "offset" | "cursor">()
      .oneOf(["none", "page", "offset", "cursor"])
      .default("none"),
    page_param: Yup.string().default("page"),
    size_param: Yup.string().default("limit"),
    offset_param: Yup.string().default("offset"),
    cursor_param: Yup.string().default(""),
    page_size_default: Yup.number().default(20)
  }).default({
    strategy: "none",
    page_param: "page",
    size_param: "limit",
    offset_param: "offset",
    cursor_param: "",
    page_size_default: 20
  }),

  schema: Yup.mixed().optional(),
  rolemap: Yup.mixed().optional()
});

export const createIntegration = async (req: Request, res: Response) => {
  const casted = createSchema.cast(req.body); // aplica defaults
  try {
    await createSchema.validate(casted, { abortEarly: false, strict: false });
  } catch (err: any) {
    // retorna a lista de erros do Yup para facilitar debug
    const msg = Array.isArray(err?.errors) ? err.errors.join(" | ") : String(err?.message || err);
    throw new AppError(msg, 400);
  }

  const payload = { ...casted, companyId: (req as any).user.companyId };
  const integ = await InventoryIntegration.create(payload);
  return res.status(201).json(integ);
};

export const inferIntegration = async (req: Request, res: Response) => {
  const { id } = req.params;
  const integ = await InventoryIntegration.findByPk(id);
  if (!integ) throw new AppError("Integration not found", 404);

  const { samples, inferred } = await fetchSamplesAndInfer(integ);
  const rolemap = ensureRolemap(integ, samples?.[0]);
  integ.schema = inferred;
  integ.rolemap = rolemap;
  await integ.save();
  return res.json(integ);
};

export const guidedFix = async (req: Request, res: Response) => {
  const { id } = req.params;
  const integ = await InventoryIntegration.findByPk(id);
  if (!integ) throw new AppError("Integration not found", 404);

  const { price, title, images, status, url, description, list_path, location } = req.body || {};

  const rm = (integ.rolemap as any) || { list_path: null, fields: { location: {} } };
  if (list_path !== undefined) rm.list_path = list_path;
  rm.fields = rm.fields || {};
  if (price !== undefined) rm.fields.price = price;
  if (title !== undefined) rm.fields.title = title;
  if (images !== undefined) rm.fields.images = images;
  if (status !== undefined) rm.fields.status = status;
  if (url !== undefined) rm.fields.url = url;
  if (description !== undefined) rm.fields.description = description;
  if (location) {
    rm.fields.location = rm.fields.location || {};
    if ("cidade" in location) rm.fields.location.cidade = location.cidade;
    if ("uf" in location) rm.fields.location.uf = location.uf;
    if ("bairro" in location) rm.fields.location.bairro = location.bairro;
  }

  integ.rolemap = rm;
  await integ.save();

  return res.json({ ok: true, rolemap: rm });
};

export const searchInventory = async (req: Request, res: Response) => {
  const { id } = req.params;
  const integ = await InventoryIntegration.findByPk(id);
  if (!integ) throw new AppError("Integration not found", 404);

  const result = await runSearch(integ, req.body || {});
  return res.json(result);
};

export const listIntegrations = async (req: Request, res: Response) => {
  const companyId = (req as any).user.companyId;
  const rows = await InventoryIntegration.findAll({
    where: { companyId },
    order: [["id", "DESC"]]
  });
  return res.json(rows);
};
