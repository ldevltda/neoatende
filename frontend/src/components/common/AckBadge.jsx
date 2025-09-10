// frontend/src/components/common/AckBadge.jsx
import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import Chip from "@material-ui/core/Chip";
import Tooltip from "@material-ui/core/Tooltip";
import DoneIcon from "@material-ui/icons/Done";
import DoneAllIcon from "@material-ui/icons/DoneAll";
import VisibilityIcon from "@material-ui/icons/Visibility";
import PlayArrowIcon from "@material-ui/icons/PlayArrow";
import ScheduleIcon from "@material-ui/icons/Schedule";

const useStyles = makeStyles((theme) => ({
  chip: {
    height: 22,
    fontSize: 11,
    paddingRight: theme.spacing(0.5),
    "& svg": { fontSize: 16 },
  },
  // cores pensadas pra ficar legível em tema claro/escuro
  pending: { background: theme.palette.grey[300] },
  sent: { background: theme.palette.info.light, color: theme.palette.common.white },
  delivered: { background: theme.palette.success.light, color: theme.palette.common.white },
  read: { background: theme.palette.secondary.light, color: theme.palette.common.white },
  played: { background: theme.palette.warning.light, color: theme.palette.common.white },
}));

/**
 * ack:
 * 0 = pendente (ainda construindo/envio local)
 * 1 = enviado/ack do servidor
 * 2 = entregueS
 * 3 = lido
 * 4 = reproduzido (áudio)
 */
const getAckMeta = (ack) => {
  switch (ack) {
    case 4:
      return { label: "Reproduzido", icon: <PlayArrowIcon />, className: "played" };
    case 3:
      return { label: "Lido", icon: <VisibilityIcon />, className: "read" };
    case 2:
      return { label: "Entregue", icon: <DoneAllIcon />, className: "delivered" };
    case 1:
      return { label: "Enviado", icon: <DoneIcon />, className: "sent" };
    case 0:
    default:
      return { label: "Pendente", icon: <ScheduleIcon />, className: "pending" };
  }
};

const AckBadge = ({ ack = 0, size = "small", compact = false, className = "" }) => {
  const classes = useStyles();
  const meta = getAckMeta(Number(ack));
  const chipClass = classes[meta.className];

  const chip = (
    <Chip
      className={`${classes.chip} ${chipClass} ${className}`}
      size={size}
      label={compact ? "" : meta.label}
      icon={meta.icon}
      variant="default"
    />
  );

  return compact ? (
    <Tooltip title={meta.label} arrow placement="top">
      <span>{chip}</span>
    </Tooltip>
  ) : (
    <Tooltip title={meta.label} arrow placement="top">
      <span>{chip}</span>
    </Tooltip>
  );
};

export default AckBadge;
