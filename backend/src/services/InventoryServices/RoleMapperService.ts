import InventoryIntegration from "../../models/InventoryIntegration";
import { getListByPath } from "./jsonPath";

type RoleMap = NonNullable<InventoryIntegration["rolemap"]>;

export function ensureRolemap(integ: InventoryIntegration, sample: any): RoleMap {
  const rolemap: RoleMap = integ.rolemap || { list_path: null, fields: { location: {} as any } };

  // se não tiver list_path, tenta achar primeiro array "grande"
  if (!rolemap.list_path) {
    // heurística simples: percorre objeto e tenta encontrar lista de itens
    // aqui só salvamos "null" e deixamos o getListByPath achar automaticamente
    rolemap.list_path = null;
  }

  // tenta inferir campos por nome
  rolemap.fields = rolemap.fields || {} as any;
  rolemap.fields.location = rolemap.fields.location || { cidade: null, uf: null, bairro: null };

  const hint = guessFieldsFromSample(sample);
  rolemap.fields = { ...hint, ...rolemap.fields };

  return rolemap;
}

function guessFieldsFromSample(sample: any) {
  // pega primeiro item
  const list = getListByPath(sample, null);
  const first = list?.[0] || sample;

  const keys = Object.keys(first || {});
  const lower = (s: string) => (s || "").toLowerCase();

  const byName = (names: string[]) => keys.find(k => names.includes(lower(k)));

  const titleKey = byName(["title", "titulo", "name", "modelo", "product", "descricao"]);
  const priceKey = byName(["price", "preco", "valor", "amount", "amount_cents"]);
  const urlKey   = byName(["url", "link", "permalink"]);
  const statusKey= byName(["status", "available", "ativo", "disponivel"]);
  const descKey  = byName(["description", "descricao", "observacao", "obs"]);

  // imagens: procura por arrays com objetos que possuam url/src
  let imagesPath: string | null = null;
  for (const k of keys) {
    const v = first?.[k];
    if (Array.isArray(v)) {
      const it = v[0];
      if (it && typeof it === "object" && ("url" in it || "src" in it)) {
        imagesPath = `${k}[].${"url" in it ? "url" : "src"}`;
        break;
      }
      if (typeof it === "string" && (it.startsWith("http://") || it.startsWith("https://"))) {
        imagesPath = `${k}[]`;
        break;
      }
    }
  }

  // localização
  const location = {
    cidade: keys.find(k => ["cidade","city","municipio"].includes(lower(k))) || null,
    uf:     keys.find(k => ["uf","estado","state"].includes(lower(k))) || null,
    bairro: keys.find(k => ["bairro","district","neighborhood"].includes(lower(k))) || null
  };

  // id
  const idKey = keys.find(k => ["id","codigo","uuid","code"].includes(lower(k))) || null;

  return {
    id: idKey || null,
    title: titleKey || null,
    price: priceKey || null,
    images: imagesPath,
    url: urlKey || null,
    status: statusKey || null,
    description: descKey || null,
    location
  };
}
