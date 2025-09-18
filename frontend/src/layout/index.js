import React, { useState, useContext, useEffect } from "react";
import clsx from "clsx";
import moment from "moment";
import {
  makeStyles,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  Divider,
  MenuItem,
  IconButton,
  Menu,
  useTheme,
  useMediaQuery,
  FormControlLabel,
  Switch,
  FormControl,
  FormLabel,
  RadioGroup,
  Radio,
} from "@material-ui/core";

// ===== ÍCONES (Material v5) =====
import MenuIcon from "@mui/icons-material/Menu";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import AccountCircle from "@mui/icons-material/AccountCircle";
// ================================

import MainListItems from "./MainListItems";
import NotificationsPopOver from "../components/NotificationsPopOver";
import UserModal from "../components/UserModal";
import { AuthContext } from "../context/Auth/AuthContext";
import BackdropLoading from "../components/BackdropLoading";
import { i18n } from "../translate/i18n";
import toastError from "../errors/toastError";
import AnnouncementsPopover from "../components/AnnouncementsPopover";

import logo from "../assets/logo.png";
import { SocketContext } from "../context/Socket/SocketContext";
import ChatPopover from "../pages/Chat/ChatPopover";

import { useDate } from "../hooks/useDate";

import ColorModeContext from "../layout/themeContext";
import LanguageControl from "../components/LanguageControl";

const drawerWidth = 240;

const useStyles = makeStyles((theme) => ({
  root: {
    display: "flex",
    height: "100vh",
    [theme.breakpoints.down("sm")]: {
      height: "calc(100vh - 56px)",
    },
    backgroundColor: theme.palette.fancyBackground,
    "& .MuiButton-outlinedPrimary": {
      color: "#FFF",
      backgroundColor:
        theme.mode === "light" ? theme.palette.primary.main : "#1c1c1c",
    },
    "& .MuiTab-textColorPrimary.Mui-selected": {
      color: theme.mode === "light" ? "Primary" : "#FFF",
    },
  },
  avatar: { width: "100%" },
  toolbar: {
    paddingRight: 24,
    color: theme.palette.dark.main,
    background: theme.palette.barraSuperior,
  },
  toolbarIcon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 8px",
    minHeight: "48px",
    [theme.breakpoints.down("sm")]: { height: "48px" },
  },
  appBar: {
    zIndex: theme.zIndex.drawer + 1,
    transition: theme.transitions.create(["width", "margin"], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.leavingScreen,
    }),
  },
  appBarShift: {
    marginLeft: drawerWidth,
    width: `calc(100% - ${drawerWidth}px)`,
    transition: theme.transitions.create(["width", "margin"], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
    [theme.breakpoints.down("sm")]: { display: "none" },
  },
  menuButton: {
    marginRight: 36,
    color: "#FFFFFF",
    backgroundColor: "transparent",
    "&:hover": {
      color: "#9FE870",
      backgroundColor: "rgba(255,255,255,0.08)",
    },
  },
  menuButtonHidden: { display: "none" },
  title: { flexGrow: 1, fontSize: 14, color: "white" },
  drawerPaper: {
    position: "relative",
    whiteSpace: "nowrap",
    width: drawerWidth,
    transition: theme.transitions.create("width", {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
    [theme.breakpoints.down("sm")]: { width: "100%" },
    ...theme.scrollbarStylesSoft,
  },
  drawerPaperClose: {
    overflowX: "hidden",
    transition: theme.transitions.create("width", {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.leavingScreen,
    }),
    width: theme.spacing(7),
    [theme.breakpoints.up("sm")]: { width: theme.spacing(9) },
    [theme.breakpoints.down("sm")]: { width: "100%" },
  },
  appBarSpacer: { minHeight: "48px" },
  content: { flex: 1, overflow: "auto" },
  container: { paddingTop: theme.spacing(4), paddingBottom: theme.spacing(4) },
  paper: {
    padding: theme.spacing(2),
    display: "flex",
    overflow: "auto",
    flexDirection: "column",
  },
  containerWithScroll: {
    flex: 1,
    padding: theme.spacing(1),
    overflowY: "scroll",
    ...theme.scrollbarStyles,
  },
  logo: {
    width: "80%",
    height: "auto",
    maxWidth: 180,
    [theme.breakpoints.down("sm")]: { width: "auto", height: "80%", maxWidth: 180 },
    logo: theme.logo,
  },
}));

const LoggedInLayout = ({ children }) => {
  const classes = useStyles();
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { handleLogout, loading } = useContext(AuthContext);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerVariant, setDrawerVariant] = useState("permanent");
  const { user } = useContext(AuthContext);

  const theme = useTheme();
  const { colorMode } = useContext(ColorModeContext);
  const greaterThenSm = useMediaQuery(theme.breakpoints.up("sm"));

  // volume 0/1 salvo em localStorage
  const [volume, setVolume] = useState(
    Number(localStorage.getItem("volume") || 1)
  );
  const setVolumeAndPersist = (n) => {
    setVolume(n);
    localStorage.setItem("volume", String(n));
  };

  const { dateToClient } = useDate();
  const socketManager = useContext(SocketContext);

  useEffect(() => {
    if (document.body.offsetWidth > 1200) setDrawerOpen(true);
  }, []);

  useEffect(() => {
    if (document.body.offsetWidth < 600) setDrawerVariant("temporary");
    else setDrawerVariant("permanent");
  }, [drawerOpen]);

  useEffect(() => {
    const companyId = localStorage.getItem("companyId");
    const userId = localStorage.getItem("userId");
    const socket = socketManager.getSocket(companyId);

    socket.on(`company-${companyId}-auth`, (data) => {
      if (data.user.id === +userId) {
        toastError("Sua conta foi acessada em outro computador.");
        setTimeout(() => {
          localStorage.clear();
          window.location.reload();
        }, 1000);
      }
    });

    socket.emit("userStatus");
    const interval = setInterval(() => socket.emit("userStatus"), 1000 * 60 * 5);
    return () => {
      socket.disconnect();
      clearInterval(interval);
    };
  }, [socketManager]);

  const handleMenu = (event) => {
    setAnchorEl(event.currentTarget);
    setMenuOpen(true);
  };
  const handleCloseMenu = () => {
    setAnchorEl(null);
    setMenuOpen(false);
  };
  const handleOpenUserModal = () => {
    setUserModalOpen(true);
    handleCloseMenu();
  };
  const handleClickLogout = () => {
    handleCloseMenu();
    handleLogout();
  };
  const drawerClose = () => {
    if (document.body.offsetWidth < 600) setDrawerOpen(false);
  };
  const handleMenuItemClick = () => {
    const { innerWidth: width } = window;
    if (width <= 600) setDrawerOpen(false);
  };

  // radios: tema
  const handleThemeChange = (e) => {
    const value = e.target.value; // "light" | "dark"
    if (value !== theme.mode) {
      colorMode.toggleColorMode();
    }
  };

  // radios: volume
  const handleVolumeChange = (e) => {
    const v = e.target.value === "on" ? 1 : 0;
    setVolumeAndPersist(v);
  };

  if (loading) return <BackdropLoading />;

  return (
    <div className={classes.root}>
      <Drawer
        variant={drawerVariant}
        className={drawerOpen ? classes.drawerPaper : classes.drawerPaperClose}
        classes={{
          paper: clsx(
            classes.drawerPaper,
            !drawerOpen && classes.drawerPaperClose
          ),
        }}
        open={drawerOpen}
      >
        <div className={classes.toolbarIcon}>
          <img src={logo} className={classes.logo} alt="logo" />
          <IconButton onClick={() => setDrawerOpen(!drawerOpen)}>
            <ChevronLeftIcon />
          </IconButton>
        </div>
        <Divider />
        <List className={classes.containerWithScroll}>
          <MainListItems drawerClose={drawerClose} collapsed={!drawerOpen} />
        </List>
        <Divider />
      </Drawer>

      <UserModal
        open={userModalOpen}
        onClose={() => setUserModalOpen(false)}
        userId={user?.id}
      />

      <AppBar
        position="absolute"
        className={clsx(classes.appBar, drawerOpen && classes.appBarShift)}
        color="primary"
      >
        <Toolbar variant="dense" className={classes.toolbar}>
          <IconButton
            edge="start"
            variant="contained"
            aria-label="open drawer"
            onClick={() => setDrawerOpen(!drawerOpen)}
            className={clsx(
              classes.menuButton,
              drawerOpen && classes.menuButtonHidden
            )}
          >
            <MenuIcon />
          </IconButton>

          <Typography
            component="h2"
            variant="h6"
            color="inherit"
            noWrap
            className={classes.title}
          >
            {greaterThenSm && user?.profile === "admin" && user?.company?.dueDate ? (
              <>
                {i18n.t("mainDrawer.appBar.greeting.hello")} <b>{user.name}</b>,{" "}
                {i18n.t("mainDrawer.appBar.greeting.welcome")}{" "}
                <b>{user?.company?.name}</b>! (
                {i18n.t("mainDrawer.appBar.greeting.active")}{" "}
                {dateToClient(user?.company?.dueDate)})
              </>
            ) : (
              <>
                {i18n.t("mainDrawer.appBar.greeting.hello")} <b>{user.name}</b>,{" "}
                {i18n.t("mainDrawer.appBar.greeting.welcome")}{" "}
                <b>{user?.company?.name}</b>!
              </>
            )}
          </Typography>

          {/* Ícones visíveis: Notificações, Comunicados, Chat e Perfil */}
          {user.id && <NotificationsPopOver volume={volume} />}

          <AnnouncementsPopover />

          <ChatPopover />

          {/* Perfil */}
          <div>
            <IconButton
              aria-label="account of current user"
              aria-controls="menu-appbar"
              aria-haspopup="true"
              onClick={handleMenu}
              variant="contained"
              style={{ color: "white" }}
            >
              <AccountCircle />
            </IconButton>

            <Menu
              id="menu-appbar"
              anchorEl={anchorEl}
              getContentAnchorEl={null}
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              transformOrigin={{ vertical: "top", horizontal: "right" }}
              open={menuOpen}
              onClose={handleCloseMenu}
            >
              {/* Perfil */}
              <MenuItem onClick={handleOpenUserModal} style={{ fontWeight: 600 }}>
                {i18n.t("mainDrawer.appBar.user.profile")}
              </MenuItem>

              {/* Selecione o tema */}
              <MenuItem dense disableGutters>
                <div style={{ padding: "6px 16px", width: "100%" }}>
                  <FormControl component="fieldset" style={{ width: "100%" }}>
                    <FormLabel component="legend" style={{ fontSize: 12, opacity: 0.7 }}>
                      {i18n.t("common.selectTheme") || "Selecione o tema"}
                    </FormLabel>
                    <RadioGroup
                      aria-label="theme"
                      name="theme"
                      value={theme.mode}
                      onChange={handleThemeChange}
                    >
                      <FormControlLabel
                        value="light"
                        control={<Radio color="primary" />}
                        label={i18n.t("common.lightMode") || "Light"}
                      />
                      <FormControlLabel
                        value="dark"
                        control={<Radio color="primary" />}
                        label={i18n.t("common.darkMode") || "Dark"}
                      />
                    </RadioGroup>
                  </FormControl>
                </div>
              </MenuItem>

              {/* Defina volume */}
              <MenuItem dense disableGutters>
                <div style={{ padding: "6px 16px", width: "100%" }}>
                  <FormControl component="fieldset" style={{ width: "100%" }}>
                    <FormLabel component="legend" style={{ fontSize: 12, opacity: 0.7 }}>
                      {i18n.t("common.setVolume") || "Defina volume"}
                    </FormLabel>
                    <RadioGroup
                      aria-label="volume"
                      name="volume"
                      value={volume ? "on" : "off"}
                      onChange={handleVolumeChange}
                    >
                      <FormControlLabel
                        value="on"
                        control={<Radio color="primary" />}
                        label={i18n.t("common.on") || "Ligado"}
                      />
                      <FormControlLabel
                        value="off"
                        control={<Radio color="primary" />}
                        label={i18n.t("common.off") || "Desligado"}
                      />
                    </RadioGroup>
                  </FormControl>
                </div>
              </MenuItem>

              {/* Selecione um idioma */}
              <MenuItem dense disableGutters>
                <div style={{ padding: "6px 16px", width: "100%" }}>
                  <FormLabel component="legend" style={{ fontSize: 12, opacity: 0.7 }}>
                    {i18n.t("common.selectLanguage") || "Selecione um idioma"}
                  </FormLabel>
                  <div style={{ marginTop: 6 }}>
                    <LanguageControl />
                  </div>
                </div>
              </MenuItem>

              {/* Sair */}
              <MenuItem onClick={handleClickLogout}>
                {i18n.t("mainDrawer.appBar.user.logout")}
              </MenuItem>
            </Menu>
          </div>
        </Toolbar>
      </AppBar>

      <main className={classes.content}>
        <div className={classes.appBarSpacer} />
        {children ? children : null}
      </main>
    </div>
  );
};

export default LoggedInLayout;
