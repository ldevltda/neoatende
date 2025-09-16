import "dotenv/config";
import OpenAIRolemapService from "../src/services/InventoryServices/OpenAIRolemapService";

async function main() {
  const sample = {
    total: 15,
    raw: {
      "1": { id: 1, title: "Apto 2q - Centro", bedrooms: 2, price: 450000 },
      "2": { id: 2, title: "Casa 3q - Bairro X", bedrooms: 3, price: 690000 }
    }
  };

  const categoryHint = "imóveis";
  const rolemap = await OpenAIRolemapService.inferFromSamplePayload(sample, categoryHint);
  console.log(JSON.stringify(rolemap, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
