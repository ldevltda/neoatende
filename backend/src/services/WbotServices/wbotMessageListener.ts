// backend/src/services/WbotServices/wbotMessageListener.ts

// exporta o listener real da implementação
export { wbotMessageListener } from "./wbotMessageListenerImpl";

// e reexporta a função handleMessage para manter compatibilidade
export { handleMessage } from "./listeners/handleMessage";

/*
  Nota: mantemos este arquivo apenas como “fachada” para o path original.
*/
