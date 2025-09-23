import Setting from "../../models/Setting";
import Queue from "../../models/Queue";
// importe outros models que você quiser preconfigurar
import path from "path";
import fs from "fs/promises";

type Segment = "imoveis" | "veiculos" | "clinicas" | "varejo";

export async function applySegmentPresets(companyId: number, segment: Segment) {
  const base = path.resolve(__dirname, "../../../presets/segments");
  const file = path.join(base, `${segment}.json`);

  try {
    const raw = await fs.readFile(file, "utf-8");
    const preset = JSON.parse(raw);

    // Settings
    if (preset.settings) {
      for (const [key, value] of Object.entries(preset.settings)) {
        await Setting.findOrCreate({
          where: { companyId, key },
          defaults: { companyId, key, value: String(value) }
        }).then(async ([setting, created]) => {
          if (!created) await setting.update({ value: String(value) });
        });
      }
    }

    // Filas
    if (preset.queues) {
      for (const q of preset.queues) {
        await Queue.findOrCreate({
          where: { companyId, name: q.name },
          defaults: { ...q, companyId }
        });
      }
    }

    // Quick replies / mensagens padrão / prompts…
    // Integradores Inventory (ex: Vista, Webmotors) — se houver “credentialsTemplate”, só cria stub.
    // Fica a teu critério evoluir isso aos poucos.
  } catch (e) {
    // Não falhar a criação da empresa por preset — só loga
    console.warn(`[Presets] Falha ao aplicar ${segment} para company ${companyId}`, e);
  }
}
