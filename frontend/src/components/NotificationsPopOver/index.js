// frontend/src/components/NotificationsPopOver/index.js
import React, { useState, useRef, useEffect, useContext } from "react";
import { useHistory } from "react-router-dom";
import { format } from "date-fns";
import { SocketContext } from "../../context/Socket/SocketContext";

import useSound from "use-sound";

import Popover from "@material-ui/core/Popover";
import IconButton from "@material-ui/core/IconButton";
import List from "@material-ui/core/List";
import ListItem from "@material-ui/core/ListItem";
import ListItemText from "@material-ui/core/ListItemText";
import { makeStyles } from "@material-ui/core/styles";
import Badge from "@material-ui/core/Badge";
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
    [theme.breakpoints.down("sm")]: {
      maxWidth: 270,
    },
  },
  noShadow: {
    boxShadow: "none !important",
  },
}));

const NotificationsPopOver = ({ volume = 1, iconColor = "white" }) => {
  const classes = useStyles();

  const history = useHistory();
  const { user } = useContext(AuthContext);
  const ticketIdUrl = +history.location.pathname.split("/")[2];
  const ticketIdRef = useRef(ticketIdUrl);
  const anchorEl = useRef();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [, setDesktopNotifications] = useState([]);

  const { tickets } = useTickets({ withUnreadMessages: "true" });

  const [play] = useSound(alertSound, { volume });
  const soundAlertRef = useRef();
  const historyRef = useRef(history);

  const socketManager = useContext(SocketContext);

  // Permissão para notificações do navegador
  useEffect(() => {
    soundAlertRef.current = play;
    if ("Notification" in window) {
      Notification.requestPermission();
    }
  }, [play]);

  // Atualiza a lista de notificações
  useEffect(() => {
    setNotifications(tickets);
  }, [tickets]);

  // Atualiza referência do ticket atual
  useEffect(() => {
    ticketIdRef.current = ticketIdUrl;
  }, [ticketIdUrl]);

  // Socket listeners
  useEffect(() => {
    const socket = socketManager.getSocket(user.companyId);

    socket.on("ready", () => socket.emit("joinNotification"));

    socket.on(`company-${user.companyId}-ticket`, (data) => {
      if (data.action === "updateUnread" || data.action === "delete") {
        setNotifications((prev) =>
          prev.filter((t) => t.id !== data.ticketId)
        );
        setDesktopNotifications((prev) => {
          const idx = prev.findIndex((n) => n.tag === String(data.ticketId));
          if (idx !== -1) {
            prev[idx].close();
            prev.splice(idx, 1);
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

        const shouldNotNotify =
          (data.message.ticketId === ticketIdRef.current &&
            document.visibilityState === "visible") ||
          (data.ticket.userId && data.ticket.userId !== user?.id) ||
          data.ticket.isGroup;

        if (!shouldNotNotify) handleNotifications(data);
      }
    });

    return () => {
      socket.off(`company-${user.companyId}-ticket`);
      socket.off(`company-${user.companyId}-appMessage`);
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
      const idx = prev.findIndex((n) => n.tag === notification.tag);
      if (idx !== -1) {
        prev[idx] = notification;
        return [...prev];
      }
      return [notification, ...prev];
    });

    soundAlertRef.current();
  };

  return (
    <>
      <IconButton
        onClick={() => setIsOpen((p) => !p)}
        ref={anchorEl}
        aria-label="Open Notifications"
        style={{ color: iconColor }}
      >
        <Badge
          overlap="rectangular"
          badgeContent={notifications.length}
          color="secondary"
          invisible={notifications.length === 0}
        >
          <ChatIcon />
        </Badge>
      </IconButton>

      <Popover
        disableScrollLock
        open={isOpen}
        anchorEl={anchorEl.current}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        classes={{ paper: classes.popoverPaper }}
        onClose={() => setIsOpen(false)}
      >
        <List dense className={classes.tabContainer}>
          {notifications.length === 0 ? (
            <ListItem>
              <ListItemText>{i18n.t("notifications.noTickets")}</ListItemText>
            </ListItem>
          ) : (
            notifications.map((ticket) => (
              <div key={ticket.id} onClick={() => setIsOpen(false)}>
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
