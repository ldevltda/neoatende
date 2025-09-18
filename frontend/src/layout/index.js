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
  Box,
  Tooltip,
  Switch,
  FormControlLabel,
} from "@material-ui/core";

import MenuIcon from "@mui/icons-material/Menu";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import AccountCircle from "@mui/icons-material/AccountCircle";

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

  langColumn: {
    "& .MuiFormGroup-root": { flexDirection: "column" },
    "& .MuiFormControlLabel-root": { marginLeft: 0, marginRight: 0 },
    "& legend, & .MuiFormLabel-root": { display: "none !important" },
    "& label[for='language-select']": { display: "none !important" },
    "& label[for='language'], & label[for='locale'], & label[for='i18n-language']": {
      display: "none !important",
    },
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
  titleSpacer: { flexGrow: 1 },

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

  menuBlock: { padding: "6px 16px" },
  sectionTitle: { fontSize: 12, opacity: 0.7, marginBottom: 6 },
  profileRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "nowrap",
  },
  rowSpacer: { flex: 1 },

  // 🔧 deixa os ícones no padrão do perfil
  inlineActions: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    "& .MuiIconButton-root": {
      padding: 6,                          // compacto
      color: theme.palette.text.secondary, // mesma cor do texto secundário
    },
    "& .MuiSvgIcon-root": {
      fontSize: 20,                        // mesmo tamanho do ícone pequeno do perfil
    },
    "& .MuiBadge-badge": {
      transform: "scale(0.65) translate(60%, -60%)", // badge discreto
    },
  },

  dividerDense: { margin: "0" },
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
  useMediaQuery(theme.breakpoints.up("sm"));

  const socketManager = useContext(SocketContext);

  const [volume, setVolume] = useState(
    Number(localStorage.getItem("volume") || 1)
  );
  const setVolumeAndPersist = (v) => {
    setVolume(v);
    localStorage.setItem("volume", String(v));
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

  const handleThemeToggle = (e) => {
    const wantsDark = e.target.checked;
    const isDark = theme.mode === "dark";
    if (wantsDark !== isDark) colorMode.toggleColorMode();
  };

  const handleVolumeToggle = (e) => {
    const on = e.target.checked;
    setVolumeAndPersist(on ? 1 : 0);
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

          <div className={classes.titleSpacer} />

          {/* Só o botão do perfil no header */}
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
              {/* Topo do menu: empresa | usuário + ações compactas */}
              <Box className={classes.menuBlock}>
                <div className={classes.profileRow}>
                  <Typography variant="subtitle2" style={{ fontWeight: 700, fontSize: "1rem" }}>
                    {user?.company?.name || ""}
                  </Typography>
                  <Typography variant="body2" style={{ opacity: 0.9, fontSize: "1rem" }}>
                    {" | "}{user?.name || ""}
                  </Typography>

                  <Tooltip title={i18n.t("mainDrawer.appBar.user.profile") || "Ver Perfil"}>
                    <IconButton size="small" onClick={handleOpenUserModal}>
                      <AccountCircle fontSize="small" />
                    </IconButton>
                  </Tooltip>

                  {/* <span className={classes.rowSpacer} /> */}

                  {/* Ícones no padrão do perfil */}
                  <div className={classes.inlineActions}>
                    {/* ChatPopover já usa IconButton; não força cor aqui */}
                    <ChatPopover />

                    {/* Sino (Avisos) e Mensagens (Tickets) com cor do texto secundário */}
                    <AnnouncementsPopover iconColor={undefined} />
                    <NotificationsPopOver
                      volume={volume}
                      iconColor={undefined}
                    />
                  </div>
                </div>
              </Box>

              <Divider className={classes.dividerDense} />

              {/* Tema */}
              <Box className={classes.menuBlock} style={{ paddingBottom: 0 }}>
                <Typography className={classes.sectionTitle}>
                  {i18n.t("selectTheme") || "Selecione o tema"}
                </Typography>
              </Box>
              <Box className={classes.menuBlock} style={{ paddingTop: 6 }}>
                <FormControlLabel
                  control={
                    <Switch
                      color="primary"
                      checked={theme.mode === "dark"}
                      onChange={handleThemeToggle}
                    />
                  }
                  label={theme.mode === "dark" ? "Dark" : "Light"}
                />
              </Box>

              <Divider className={classes.dividerDense} />

              {/* Volume */}
              <Box className={classes.menuBlock} style={{ paddingBottom: 0 }}>
                <Typography className={classes.sectionTitle}>
                  {i18n.t("setVolume") || "Volume"}
                </Typography>
              </Box>
              <Box className={classes.menuBlock} style={{ paddingTop: 6 }}>
                <FormControlLabel
                  control={
                    <Switch
                      color="primary"
                      checked={!!volume}
                      onChange={handleVolumeToggle}
                    />
                  }
                  label={volume ? "Ligado" : "Desligado"}
                />
              </Box>

              {/* Idioma */}
              <Divider className={classes.dividerDense} />
              <Box className={classes.menuBlock} style={{ paddingBottom: 0 }}>
                <Typography className={classes.sectionTitle}>
                  {i18n.t("selectLanguage") || "Selecione um idioma"}
                </Typography>
              </Box>
              <Box className={`${classes.menuBlock} ${classes.langColumn}`} style={{ paddingTop: 6 }}>
                <LanguageControl />
              </Box>

              <Divider className={classes.dividerDense} />
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
