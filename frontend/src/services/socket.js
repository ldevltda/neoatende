import { io } from "socket.io-client";

const socket = io(process.env.REACT_APP_BACKEND_URL || window.location.origin, {
  transports: ["websocket"],   // força WS
  upgrade: false,              // não tenta "subir" de polling -> WS
  withCredentials: true,       // mantém cookies/credenciais se você usar
  query: { token }             // mantém seu token na query (igual está hoje)
});
