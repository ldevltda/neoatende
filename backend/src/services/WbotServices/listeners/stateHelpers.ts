export interface AgentState {
  mode: "smalltalk" | "inventory" | "booking";
  slots: any;
  page: number;
  pageSize: number;
  lastList?: any[];
  lastMapping?: Record<number, string>;
}

export const loadState = async () => {
  console.log("loadState chamado");
};

export const saveState = async () => {
  console.log("saveState chamado");
};

export const clearState = async () => {
  console.log("clearState chamado");
};
