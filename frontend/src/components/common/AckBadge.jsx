import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import DoneIcon from "@material-ui/icons/Done";
import DoneAllIcon from "@material-ui/icons/DoneAll";

// Cores no estilo WhatsApp
const WAGray = "#8696a0";   // cinza dos ticks
const WABlue = "#34B7F1";   // azul de lido

const useStyles = makeStyles(() => ({
  wrap: {
    display: "inline-flex",
    alignItems: "center",
    marginLeft: 6,
    verticalAlign: "middle",
    lineHeight: 0,
  },
  icon: {
    fontSize: 16,
  },
}));

/**
 * ack:
 * 1 = enviado (✔ cinza)
 * 2 = entregue (✔✔ cinza)
 * 3 = lido (✔✔ azul)
 * 4 = reproduzido (usa ✔✔ azul também)
 */
const AckTicks = ({ ack = 0 }) => {
  const classes = useStyles();
  if (!ack) return null;

  const playedOrRead = ack >= 3;
  const delivered = ack === 2;
  const sent = ack === 1;

  return (
    <span className={classes.wrap}>
      {sent && <DoneIcon className={classes.icon} style={{ color: WAGray }} />}
      {delivered && <DoneAllIcon className={classes.icon} style={{ color: WAGray }} />}
      {playedOrRead && <DoneAllIcon className={classes.icon} style={{ color: WABlue }} />}
    </span>
  );
};

export default AckTicks;
