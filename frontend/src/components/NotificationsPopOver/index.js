import React, { useState, useRef, useEffect, useContext } from "react";
import { useHistory } from "react-router-dom";
import { format } from "date-fns";
import { SocketContext } from "../../context/Socket/SocketContext";
import useSound from "use-sound";

import {
  Badge,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Popover,
  Tooltip,
  makeStyles,
} from "@material-ui/core";

import ChatIcon from "@mui/icons-material/Chat";
import TicketListItem from "../TicketListItemCustom";
import useTickets from "../../hooks/useTickets";
import alertSound from "../../assets/sound.mp3";
import { AuthContext } from "../../context/Auth/AuthContext";
import { i18n } from "../../translate/i18n";
import toastError from "../../errors/toastError";

const useStyles = makeStyles((theme) => ({
  tabContainer: {
    overflowY: "auto",
    maxHeight: 350,
    ...theme.scrollbarStyles,
  },
  popoverPaper: {
    width: "100%",
    maxWidth: 350,
    marginLeft: theme.spacing(2),
    marginRight: theme.spacing(1),
    [theme.breakpoints.down("sm")]: { maxWidth: 270 },
  },
}));

/**
 * Notificações de tickets (mensagens novas)
 * Props opcionais:
 * - iconColor: cor do ícone (por padrão herda do contexto)
 * - badgeColor: cor do badge (padrão "secondary")
 * - tooltip: texto do tooltip (default traduzido)
 */
const NotificationsPopOver = ({
  volume: volumeProp,
  iconColor,
  badgeColor = "secondary",
  tooltip,
}) => {
  const classes = useStyles();

  const history = useHistory();
  const { user } = useContext(AuthContext);
  const ticketIdUrl = +history.location.pathname.split("/")[2];
  const ticketIdRef = useRef(ticketIdUrl);

  const anchorEl = useRef();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [showPendingTickets, setShowPendingTickets] = useState(false);

  const [, setDesktopNotifications] = useState([]);
  const { tickets } = useTickets({ withUnreadMessages: "true" });

  // volume: aceita prop (0/1) ou localStorage, default 1
  const effectiveVolume = Number(
    volumeProp ?? localStorage.getItem("volume") ?? 1
  );
  const [play] = useSound(alertSound, { volume: effectiveVolume });
  const soundAlertRef = useRef();

  const historyRef = useRef(history);
  const socketManager = useContext(SocketContext);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        if (user.allTicket === "enable") {
          setShowPendingTickets(true);
        }
      } catch (err) {
        toastError(err);
      }
    };
    fetchSettings();
  }, [user]);

  useEffect(() => {
    soundAlertRef.current = play;

    if (!("Notification" in window)) {
      console.log("This browser doesn't support notifications");
    } else {
      Notification.requestPermission();
    }
  }, [play]);

  useEffect(() => {
    const processNotifications = () => {
      if (showPendingTickets) {
        setNotifications(tickets);
      } else {
        const newNotifications = tickets.filter(
          (t) => t.status !== "pending"
        );
        setNotifications(newNotifications);
      }
    };
    processNotifications();
  }, [tickets, showPendingTickets]);

  useEffect(() => {
    ticketIdRef.current = ticketIdUrl;
  }, [ticketIdUrl]);

  useEffect(() => {
    const socket = socketManager.getSocket(user.companyId);

    socket.on("ready", () => socket.emit("joinNotification"));

    socket.on(`company-${user.companyId}-ticket`, (data) => {
      if (data.action === "updateUnread" || data.action === "delete") {
        setNotifications((prev) => {
          const idx = prev.findIndex((t) => t.id === data.ticketId);
          if (idx !== -1) {
            prev.splice(idx, 1);
            return [...prev];
          }
          return prev;
        });

        setDesktopNotifications((prev) => {
          const nIdx = prev.findIndex((n) => n.tag === String(data.ticketId));
          if (nIdx !== -1) {
            prev[nIdx].close();
            prev.splice(nIdx, 1);
            return [...prev];
          }
          return prev;
        });
      }
    });

    socket.on(`company-${user.companyId}-appMessage`, (data) => {
      if (
        data.action === "create" &&
        !data.message.fromMe &&
        data.ticket.status !== "pending" &&
        (!data.message.read || data.ticket.status === "pending") &&
        (data.ticket.userId === user?.id || !data.ticket.userId) &&
        (user?.queues?.some((q) => q.id === data.ticket.queueId) ||
          !data.ticket.queueId)
      ) {
        setNotifications((prev) => {
          const idx = prev.findIndex((t) => t.id === data.ticket.id);
          if (idx !== -1) {
            prev[idx] = data.ticket;
            return [...prev];
          }
          return [data.ticket, ...prev];
        });

        const shouldNotNotificate =
          (data.message.ticketId === ticketIdRef.current &&
            document.visibilityState === "visible") ||
          (data.ticket.userId && data.ticket.userId !== user?.id) ||
          data.ticket.isGroup;

        if (!shouldNotNotificate) {
          handleNotifications(data);
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [user, socketManager]);

  const handleNotifications = (data) => {
    const { message, contact, ticket } = data;

    const options = {
      body: `${message.body} - ${format(new Date(), "HH:mm")}`,
      icon: contact.urlPicture,
      tag: ticket.id,
      renotify: true,
    };

    const notification = new Notification(
      `${i18n.t("tickets.notification.message")} ${contact.name}`,
      options
    );

    notification.onclick = (e) => {
      e.preventDefault();
      window.focus();
      historyRef.current.push(`/tickets/${ticket.uuid}`);
    };

    setDesktopNotifications((prev) => {
      const nIdx = prev.findIndex((n) => n.tag === notification.tag);
      if (nIdx !== -1) {
        prev[nIdx] = notification;
        return [...prev];
      }
      return [notification, ...prev];
    });

    // ✅ evita 'no-unused-expressions'
    if (typeof soundAlertRef.current === "function") {
      soundAlertRef.current();
    }
  };

  const handleToggle = () => setIsOpen((p) => !p);
  const handleClickAway = () => setIsOpen(false);

  const count = notifications.length;

  return (
    <>
      <Tooltip
        arrow
        placement="bottom"
        title={tooltip || i18n.t("notifications.title") || "Conversas"}
      >
        <IconButton
          onClick={handleToggle}
          ref={anchorEl}
          aria-label="Open Notifications"
          color="inherit"
          size="small"
          style={iconColor ? { color: iconColor } : undefined}
        >
          <Badge
            overlap="circular"
            badgeContent={count}
            color={badgeColor}
            invisible={count === 0}
          >
            <ChatIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        disableScrollLock
        open={isOpen}
        anchorEl={anchorEl.current}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        classes={{ paper: classes.popoverPaper }}
        onClose={handleClickAway}
      >
        <List dense className={classes.tabContainer}>
          {count === 0 ? (
            <ListItem>
              <ListItemText>
                {i18n.t("notifications.noTickets")}
              </ListItemText>
            </ListItem>
          ) : (
            notifications.map((ticket) => (
              <div key={ticket.id} onClick={handleClickAway}>
                <TicketListItem ticket={ticket} />
              </div>
            ))
          )}
        </List>
      </Popover>
    </>
  );
};

export default NotificationsPopOver;
