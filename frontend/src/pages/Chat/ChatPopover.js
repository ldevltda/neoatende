// (versão completa; nova prop `headless` + retorno condicional)
import React, {
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { makeStyles } from "@material-ui/core/styles";
import {
  Badge,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Paper,
  Popover,
  Tooltip,
  Typography,
} from "@material-ui/core";
import ForumIcon from "@mui/icons-material/Forum";

import api from "../../services/api";
import { isArray } from "lodash";
import { SocketContext } from "../../context/Socket/SocketContext";
import { useDate } from "../../hooks/useDate";
import { AuthContext } from "../../context/Auth/AuthContext";

import notifySound from "../../assets/chat_notify.mp3";
import useSound from "use-sound";
import toastError from "../../errors/toastError";
import { i18n } from "../../translate/i18n";

const useStyles = makeStyles((theme) => ({
  mainPaper: {
    flex: 1,
    maxHeight: 300,
    maxWidth: 500,
    padding: theme.spacing(1),
    overflowY: "scroll",
    ...theme.scrollbarStyles,
  },
  popoverPaper: {
    width: "100%",
    maxWidth: 360,
  },
}));

const reducer = (state, action) => {
  switch (action.type) {
    case "LOAD_CHATS": {
      const incoming = action.payload || [];
      const next = [...state];
      if (isArray(incoming)) {
        incoming.forEach((chat) => {
          const idx = next.findIndex((c) => c.id === chat.id);
          if (idx !== -1) next[idx] = chat;
          else next.push(chat);
        });
      }
      return next;
    }
    case "CHANGE_CHAT":
      return state.map((c) =>
        c.id === action.payload.chat.id ? action.payload.chat : c
      );
    case "RESET":
      return [];
    default:
      return state;
  }
};

/**
 * Props:
 * - headless?: boolean
 * - iconColor, badgeColor
 * - onCountChange?: (n)=>void
 */
export default function ChatPopover({
  headless = false,
  iconColor,
  badgeColor = "secondary",
  onCountChange,
}) {
  const classes = useStyles();
  const { user } = useContext(AuthContext);
  const socketManager = useContext(SocketContext);
  const { datetimeToClient } = useDate();

  const [anchorEl, setAnchorEl] = useState(null);
  const [chats, dispatch] = useReducer(reducer, []);
  const [pageNumber, setPageNumber] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchParam] = useState("");

  const [unreadCount, setUnreadCount] = useState(0);

  const [play] = useSound(notifySound);
  const soundRef = useRef();

  useEffect(() => {
    soundRef.current = play;
    if ("Notification" in window) Notification.requestPermission();
  }, [play]);

  useEffect(() => {
    dispatch({ type: "RESET" });
    setPageNumber(1);
  }, [searchParam]);

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => void fetchChats(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParam, pageNumber]);

  useEffect(() => {
    const companyId = localStorage.getItem("companyId");
    const socket = socketManager.getSocket(companyId);
    if (!socket) return () => {};

    socket.on(`company-${companyId}-chat`, (data) => {
      if (data.action === "new-message") {
        dispatch({ type: "CHANGE_CHAT", payload: data });
        try {
          const usersArr = data.newMessage?.chat?.users || [];
          const userIds = usersArr.map((u) => u.userId);
          const fromOther = data.newMessage?.senderId !== user?.id;
          if (userIds.includes(user?.id) && fromOther) {
            if (typeof soundRef.current === "function") soundRef.current();
          }
        } catch (_) {}
      }
      if (data.action === "update") {
        dispatch({ type: "CHANGE_CHAT", payload: data });
      }
    });

    return () => socket.disconnect();
  }, [socketManager, user?.id]);

  useEffect(() => {
    let total = 0;
    for (const chat of chats) {
      for (const cu of chat.users || []) {
        if (cu.userId === user?.id) total += Number(cu.unreads || 0);
      }
    }
    setUnreadCount(total);
  }, [chats, user?.id]);

  useEffect(() => {
    if (typeof onCountChange === "function") onCountChange(unreadCount);
  }, [unreadCount, onCountChange]);

  const fetchChats = async () => {
    try {
      const { data } = await api.get("/chats/", {
        params: { searchParam, pageNumber },
      });
      dispatch({ type: "LOAD_CHATS", payload: data.records || [] });
      setHasMore(!!data.hasMore);
      setLoading(false);
    } catch (err) {
      toastError(err);
      setLoading(false);
    }
  };

  const loadMore = () => setPageNumber((p) => p + 1);

  const handleScroll = (e) => {
    if (!hasMore || loading) return;
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - (scrollTop + 100) < clientHeight) loadMore();
  };

  if (headless) return null;

  const handleOpen = (ev) => setAnchorEl(ev.currentTarget);
  const handleClose = () => setAnchorEl(null);
  const goToMessages = (chat) => (window.location.href = `/chats/${chat.uuid}`);

  const open = Boolean(anchorEl);
  const id = open ? "chat-popover" : undefined;

  return (
    <div>
      <Tooltip
        arrow
        placement="bottom"
        title={i18n.t("chat.tooltip") || "Mensagens internas"}
      >
        <IconButton
          size="small"
          aria-describedby={id}
          onClick={handleOpen}
          style={iconColor ? { color: iconColor } : undefined}
        >
          <Badge
            overlap="circular"
            badgeContent={unreadCount}
            color={badgeColor}
            invisible={unreadCount === 0}
          >
            <ForumIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        id={id}
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        classes={{ paper: classes.popoverPaper }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Paper variant="outlined" onScroll={handleScroll} className={classes.mainPaper}>
          <List component="nav" aria-label="chat list" style={{ minWidth: 300 }}>
            {isArray(chats) && chats.length > 0 ? (
              chats.map((item) => {
                const me = (item.users || []).find((u) => u.userId === user?.id);
                const unread = Number(me?.unreads || 0);
                return (
                  <ListItem
                    key={item.id}
                    style={{ border: "1px solid #eee", cursor: "pointer" }}
                    onClick={() => goToMessages(item)}
                    button
                  >
                    <ListItemText
                      primaryTypographyProps={{ noWrap: true }}
                      primary={item.lastMessage || item.title || "Mensagens"}
                      secondary={
                        <>
                          <Typography component="span" style={{ fontSize: 12 }}>
                            {datetimeToClient(item.updatedAt)}
                          </Typography>
                          {unread > 0 && (
                            <Typography component="span" style={{ fontSize: 12, marginLeft: 8 }}>
                              • {unread} não lida{unread > 1 ? "s" : ""}
                            </Typography>
                          )}
                        </>
                      }
                    />
                  </ListItem>
                );
              })
            ) : (
              <ListItem>
                <ListItemText
                  primary={i18n.t("mainDrawer.appBar.notRegister") || "Nenhum registro"}
                />
              </ListItem>
            )}
          </List>
        </Paper>
      </Popover>
    </div>
  );
}
