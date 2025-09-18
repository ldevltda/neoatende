import React, { useState, useContext, useEffect } from "react";
import clsx from "clsx";
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
  FormControl,
  FormLabel,
  RadioGroup,
  Radio,
  FormControlLabel,
  Switch,
  Box,
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
    [theme.breakpoints.down("sm")]: { height: "calc(100vh - 56px)" },
    backgroundColor: theme.palette.fancyBackground,
  },
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
    "&:hover": { color: "#9FE870", backgroundColor: "rgba(255,255,255,0.08)" },
  },
  menuButtonHidden: { display: "none" },
  titleSpacer: { flexGrow: 1 }, // só um spacer, sem texto (header limpo)
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
  // estilos do menu de perfil
  menuBlock: { padding: "8px 16px" },
  sectionTitle: { fontSize: 12, opacity: 0.7, marginBottom: 6 },
  greyButton: {
    margin: "6px 16px 12px",
    padding: "6px 10px",
    background: "#eee",
    borderRadius: 6,
    display: "inline-block",
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
  useMediaQuery(theme.breakpoints.up("sm")); // mantido se precisar

  const { dateToClient } = useDate();
  const socketManager = useContext(SocketContext);

  // volume 0/1 salvo em localStorage
  const [volume, setVolume] = useState(
    Number(localStorage.getItem("volume") || 1)
  );
  const setVolumeAndPersist = (n) => {
    setVolume(n);
    localStorage.setItem("volume", String(n));
  };

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

  // radios: tema
  const handleThemeChange = (e) => {
    const value = e.target.value; // "light" | "dark"
    if (value !== theme.mode) colorMode.toggleColorMode();
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

          {/* Header limpo: só um spacer no meio */}
          <div className={classes.titleSpacer} />

          {/* Ícones visíveis: Notificações, Comunicados, Chat e Perfil */}
          {user?.id && <NotificationsPopOver volume={volume} />}
          <AnnouncementsPopover />
          <ChatPopover />

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
              {/* Header do menu: Empresa / Usuário / Perfil */}
              <Box className={classes.menuBlock}>
                <Typography variant="subtitle2" style={{ fontWeight: 700 }}>
                  {user?.company?.name || ""}
                </Typography>
                <Typography variant="body2" style={{ opacity: 0.9 }}>
                  {user?.name || ""}
                </Typography>
                <div className={classes.greyButton}>
                  <span
                    onClick={handleOpenUserModal}
                    style={{ cursor: "pointer" }}
                  >
                    {i18n.t("mainDrawer.appBar.user.profile") || "Perfil"}
                  </span>
                </div>
              </Box>
              <Divider />

              {/* Selecione um Tema (radios) */}
              <MenuItem dense disableGutters>
                <div className={classes.menuBlock} style={{ width: "100%" }}>
                  <FormControl component="fieldset" style={{ width: "100%" }}>
                    <FormLabel component="legend" className={classes.sectionTitle}>
                      {i18n.t("common.selectTheme") || "Selecione um Tema"}
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

              {/* Volume (radios) */}
              <MenuItem dense disableGutters>
                <div className={classes.menuBlock} style={{ width: "100%" }}>
                  <FormControl component="fieldset" style={{ width: "100%" }}>
                    <FormLabel component="legend" className={classes.sectionTitle}>
                      {i18n.t("common.setVolume") || "Volume"}
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

              {/* Idioma (mantém seu componente) */}
              <MenuItem dense disableGutters>
                <div className={classes.menuBlock} style={{ width: "100%" }}>
                  <FormLabel component="legend" className={classes.sectionTitle}>
                    {i18n.t("common.selectLanguage") || "Selecione um idioma"}
                  </FormLabel>
                  <div style={{ marginTop: 6 }}>
                    <LanguageControl />
                  </div>
                </div>
              </MenuItem>

              <Divider />
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
