import { Request, Response } from "express";
import * as Yup from "yup";
import AppError from "../errors/AppError";
import InventoryIntegration from "../models/InventoryIntegration";
import { fetchSamplesAndInfer } from "../services/InventoryServices/InferSchemaService";
import { ensureRolemap } from "../services/InventoryServices/RoleMapperService";
import { runSearch } from "../services/InventoryServices/RunSearchService";

export const createIntegration = async (req: Request, res: Response) => {
  const schema = Yup.object().shape({
    name: Yup.string().required(),
    companyId: Yup.number().optional(),
    categoryHint: Yup.string().nullable(),
    endpoint: Yup.object({
      method: Yup.string().oneOf(["GET", "POST"]).required(),
      url: Yup.string().url().required(),
      default_query: Yup.object().optional(),
      default_body: Yup.object().optional(),
      headers: Yup.object().optional(),
      timeout_s: Yup.number().optional()
    }).required(),
    auth: Yup.object().required(),
    pagination: Yup.object({
      strategy: Yup.string().oneOf(["none","page","offset","cursor"]).required(),
      page_param: Yup.string().optional(),
      size_param: Yup.string().optional(),
      offset_param: Yup.string().optional(),
      cursor_param: Yup.string().optional(),
      page_size_default: Yup.number().optional()
    }).required()
  });

  try {
    await schema.validate(req.body);
  } catch (err: any) {
    throw new AppError(err.message);
  }

  const payload = { ...req.body, companyId: req.user.companyId };
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
