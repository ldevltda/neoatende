import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import DoneIcon from "@material-ui/icons/Done";
import DoneAllIcon from "@material-ui/icons/DoneAll";

const WAGray = "#8696a0";
const WABlue = "#34B7F1";

const useStyles = makeStyles(() => ({
  wrap: { display: "inline-flex", alignItems: "center", marginLeft: 6, lineHeight: 0 },
  icon: { fontSize: 16 },
}));

export default function AckTicks({ ack = 0 }) {
  const c = useStyles();
  if (!ack) return null;
  if (ack === 1) return <span className={c.wrap}><DoneIcon className={c.icon} style={{ color: WAGray }} /></span>;
  if (ack === 2) return <span className={c.wrap}><DoneAllIcon className={c.icon} style={{ color: WAGray }} /></span>;
  // 3 (lido) ou 4 (reproduzido) = azul
  return <span className={c.wrap}><DoneAllIcon className={c.icon} style={{ color: WABlue }} /></span>;
}
