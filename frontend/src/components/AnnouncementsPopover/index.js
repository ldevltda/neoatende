// frontend/src/components/AnnouncementsPopover/index.js
import React, { useEffect, useReducer, useState, useContext } from "react";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Paper,
  Popover,
  Tooltip,
  Typography,
  makeStyles,
} from "@material-ui/core";
import NotificationsIcon from "@mui/icons-material/Notifications";

import moment from "moment";
import { isArray } from "lodash";

import api from "../../services/api";
import toastError from "../../errors/toastError";
import { SocketContext } from "../../context/Socket/SocketContext";

const useStyles = makeStyles((theme) => ({
  mainPaper: {
    flex: 1,
    maxHeight: 3000,
    maxWidth: 5000,
    padding: theme.spacing(1),
    overflowY: "scroll",
    ...theme.scrollbarStyles,
  },
}));

function AnnouncementDialog({ announcement, open, handleClose }) {
  const getMediaPath = (filename) =>
    `${process.env.REACT_APP_BACKEND_URL}/public/${filename}`;

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogTitle>{announcement?.title}</DialogTitle>
      <DialogContent>
        {announcement?.mediaPath && (
          <div
            style={{
              border: "1px solid #f1f1f1",
              margin: "0 auto 20px",
              textAlign: "center",
              width: 400,
              height: 300,
              backgroundImage: `url(${getMediaPath(announcement.mediaPath)})`,
              backgroundRepeat: "no-repeat",
              backgroundSize: "contain",
              backgroundPosition: "center",
            }}
          />
        )}
        <DialogContentText>{announcement?.text}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} color="primary" autoFocus>
          Fechar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const reducer = (state, action) => {
  if (action.type === "LOAD_ANNOUNCEMENTS") {
    const list = action.payload;
    const add = [];
    if (isArray(list)) {
      list.forEach((a) => {
        const idx = state.findIndex((u) => u.id === a.id);
        if (idx !== -1) state[idx] = a;
        else add.push(a);
      });
    }
    return [...state, ...add];
  }
  if (action.type === "UPDATE_ANNOUNCEMENTS") {
    const a = action.payload;
    const idx = state.findIndex((u) => u.id === a.id);
    if (idx !== -1) {
      state[idx] = a;
      return [...state];
    }
    return [a, ...state];
  }
  if (action.type === "DELETE_ANNOUNCEMENT") {
    const id = action.payload;
    const idx = state.findIndex((u) => u.id === id);
    if (idx !== -1) state.splice(idx, 1);
    return [...state];
  }
  if (action.type === "RESET") return [];
  return state;
};

/**
 * Avisos/broadcasts
 * Props:
 *  - iconColor?: string
 *  - badgeColor?: MUI color (default "secondary")
 *  - tooltip?: string (default "Avisos")
 *  - headless?: boolean (monta listeners sem renderizar UI)
 *  - onCountChange?: (n: number) => void   // reporta total de avisos
 */
export default function AnnouncementsPopover({
  iconColor,
  badgeColor = "secondary",
  tooltip = "Avisos",
  headless = false,
  onCountChange,
}) {
  const classes = useStyles();

  const [anchorEl, setAnchorEl] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [announcements, dispatch] = useReducer(reducer, []);
  const [announcement, setAnnouncement] = useState(null);
  const [showDialog, setShowDialog] = useState(false);

  const socketManager = useContext(SocketContext);

  // carregar primeira página
  useEffect(() => {
    dispatch({ type: "RESET" });
    setPageNumber(1);
  }, []);

  // paginação
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => {
      fetchAnnouncements();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber]);

  // sockets
  useEffect(() => {
    const companyId = localStorage.getItem("companyId");
    const socket = socketManager.getSocket(companyId);
    if (!socket) return () => {};

    socket.on(`company-announcement`, (data) => {
      if (data.action === "update" || data.action === "create") {
        dispatch({ type: "UPDATE_ANNOUNCEMENTS", payload: data.record });
      }
      if (data.action === "delete") {
        dispatch({ type: "DELETE_ANNOUNCEMENT", payload: +data.id });
      }
    });
    return () => socket.disconnect();
  }, [socketManager]);

  // reporta contagem para o layout quando mudar
  const count = announcements.length;
  useEffect(() => {
    if (typeof onCountChange === "function") onCountChange(count);
  }, [count, onCountChange]);

  const fetchAnnouncements = async () => {
    try {
      const { data } = await api.get("/announcements/", {
        params: { pageNumber },
      });
      dispatch({ type: "LOAD_ANNOUNCEMENTS", payload: data.records });
      setHasMore(data.hasMore);
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

  const open = Boolean(anchorEl);
  const id = open ? "ann-popover" : undefined;

  // modo headless: não renderiza UI, mas mantém efeitos/sockets ativos
  if (headless) return null;

  return (
    <div>
      <AnnouncementDialog
        announcement={announcement}
        open={showDialog}
        handleClose={() => setShowDialog(false)}
      />

      <Tooltip arrow placement="bottom" title={tooltip}>
        <IconButton
          size="small"
          aria-describedby={id}
          onClick={(e) => setAnchorEl(e.currentTarget)}
          color="inherit"
          style={iconColor ? { color: iconColor } : undefined}
        >
          <Badge
            overlap="circular"
            badgeContent={count}
            color={badgeColor}
            invisible={count === 0}
          >
            <NotificationsIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        id={id}
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        transformOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Paper
          variant="outlined"
          onScroll={handleScroll}
          className={classes.mainPaper}
        >
          <List component="nav" aria-label="announcements" style={{ minWidth: 300 }}>
            {isArray(announcements) &&
              announcements.map((item) => (
                <ListItem
                  key={item.id}
                  style={{
                    border: "1px solid #eee",
                    borderLeft:
                      item.priority === 1
                        ? "4px solid #b81111"
                        : item.priority === 2
                        ? "4px solid orange"
                        : "4px solid grey",
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    setAnnouncement(item);
                    setShowDialog(true); // <- aqui estava o nome antigo
                    setAnchorEl(null);
                  }}
                >
                  {item.mediaPath && (
                    <ListItemAvatar>
                      <Avatar
                        alt={item.mediaName}
                        src={`${process.env.REACT_APP_BACKEND_URL}/public/${item.mediaPath}`}
                      />
                    </ListItemAvatar>
                  )}
                  <ListItemText
                    primary={item.title}
                    secondary={
                      <>
                        <Typography component="span" style={{ fontSize: 12 }}>
                          {moment(item.createdAt).format("DD/MM/YYYY")}
                        </Typography>
                        <span style={{ marginTop: 5, display: "block" }} />
                        <Typography component="span" variant="body2">
                          {item.text}
                        </Typography>
                      </>
                    }
                  />
                </ListItem>
              ))}
            {isArray(announcements) && announcements.length === 0 && (
              <ListItem>
                <ListItemText primary="Nenhum registro" />
              </ListItem>
            )}
          </List>
        </Paper>
      </Popover>
    </div>
  );
}
