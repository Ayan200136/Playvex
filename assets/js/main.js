(() => {
  "use strict";

  // Playvex core script:
  // - Homepage: loads ./games.json (slugs only) and each /games/{slug}/meta.json to render cards.
  // - Game pages: hydrates title/description from meta.json and loads 3 other games.
  // - Failure behavior: missing meta.json is skipped; missing games.json shows a clean error.

  const cache = new Map();

  const RECENT_KEY = "playvex_recent_v1";
  const PROGRESS_KEY = "playvex_progress_v1";
  const SETTINGS_KEY = "playvex_settings_v1";

  const THUMB_PLACEHOLDER =
    "data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20viewBox%3D'0%200%20720%20405'%3E%3Cdefs%3E%3ClinearGradient%20id%3D'g'%20x1%3D'0'%20y1%3D'0'%20x2%3D'1'%20y2%3D'1'%3E%3Cstop%20stop-color%3D'%230e0f13'%20offset%3D'0'/%3E%3Cstop%20stop-color%3D'%2313161f'%20offset%3D'1'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect%20width%3D'720'%20height%3D'405'%20fill%3D'url(%23g)'/%3E%3Cpath%20d%3D'M300%20155l150%2047.5-150%2047.5z'%20fill%3D'%234cff7a'%20opacity%3D'.92'/%3E%3C/svg%3E";

  function readSettingsStore() {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      const data = safeJsonParse(raw || "");
      if (!data || typeof data !== "object") return {};
      return data;
    } catch {
      return {};
    }
  }

  function writeSettingsStore(store) {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(store));
    } catch {
      // ignore
    }
  }

  function getSetting(key, fallback) {
    const store = readSettingsStore();
    if (!store || typeof store !== "object") return fallback;
    if (!(key in store)) return fallback;
    return store[key];
  }

  function setSetting(key, value) {
    const store = readSettingsStore();
    store[key] = value;
    writeSettingsStore(store);
    window.dispatchEvent(new CustomEvent("playvex:settings", { detail: { key, value } }));
  }

  function applyMotionPreference() {
    const pref = getSetting("reducedMotion", null);
    const value = pref == null
      ? !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      : !!pref;
    document.body.classList.toggle("reduced-motion", value);
  }

  applyMotionPreference();

  const SITE_BASE = (() => {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts[0] === "games") return "../../";
    return "./";
  })();

  function readProgressStore() {
    try {
      const raw = window.localStorage.getItem(PROGRESS_KEY);
      const data = safeJsonParse(raw || "");
      if (!data || typeof data !== "object") return {};
      return data;
    } catch {
      return {};
    }
  }

  function writeProgressStore(store) {
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(store));
    } catch {
      // localStorage may be unavailable; ignore.
    }
  }

  function normalizeGameSlug(slug) {
    if (typeof slug !== "string") return null;
    const s = slug.trim();
    if (!s) return null;
    return s;
  }

  function getLocalProgress(slug) {
    const s = normalizeGameSlug(slug);
    if (!s) return null;
    const store = readProgressStore();
    const entry = store[s];
    if (!entry || typeof entry !== "object") return null;
    if (!entry.data || typeof entry.data !== "object") return null;
    return {
      data: entry.data,
      updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : 0
    };
  }

  function setLocalProgress(slug, data, { updatedAt = Date.now() } = {}) {
    const s = normalizeGameSlug(slug);
    if (!s) return;
    if (!data || typeof data !== "object") return;
    const store = readProgressStore();
    store[s] = {
      data,
      updatedAt: typeof updatedAt === "number" ? updatedAt : Date.now()
    };
    writeProgressStore(store);
  }

  function mergeLocalProgress(slug, patch) {
    const s = normalizeGameSlug(slug);
    if (!s) return;
    if (!patch || typeof patch !== "object") return;
    const cur = getLocalProgress(s);
    const nextData = Object.assign({}, cur?.data || {}, patch);
    setLocalProgress(s, nextData, { updatedAt: Date.now() });
  }

  function listLocalProgressSlugs() {
    const store = readProgressStore();
    return Object.keys(store).filter((k) => typeof k === "string" && k.trim().length > 0);
  }

  const account = {
    firebaseReady: false,
    config: null,
    firebase: null,
    auth: null,
    db: null,
    user: null,
    initPromise: null,
    loadPromise: null,
    writeTimers: new Map()
  };

  function getFirebaseConfig() {
    const cfg = window.PLAYVEX_FIREBASE_CONFIG;
    if (!cfg || typeof cfg !== "object") return null;
    return cfg;
  }

  function setAccountStatus(text, { lockMs = 0 } = {}) {
    const el = $("accountStatus");
    if (!el) return;
    el.textContent = text;
    if (typeof lockMs === "number" && lockMs > 0) {
      account.uiLockUntil = Date.now() + lockMs;
    }
  }

  function canAutoUpdateStatus() {
    return !account.uiLockUntil || Date.now() >= account.uiLockUntil;
  }

  function progressSummaryLine() {
    const saved = listLocalProgressSlugs().length;
    const last = readRecent()[0] || "";
    const lastLabel = last ? last.replace(/[-_]+/g, " ") : "";
    if (saved === 0 && !lastLabel) return "";
    if (saved > 0 && lastLabel) return `Saved progress: ${saved} game${saved === 1 ? "" : "s"} • Last played: ${lastLabel}`;
    if (saved > 0) return `Saved progress: ${saved} game${saved === 1 ? "" : "s"}`;
    return `Last played: ${lastLabel}`;
  }

  function withProgressSummary(text) {
    const extra = progressSummaryLine();
    return extra ? `${text}\n${extra}` : text;
  }

  function setAuthUiEnabled(enabled) {
    const ids = [
      "accountGoogleBtn",
      "accountEmailToggleBtn",
      "accountEmail",
      "accountPassword",
      "accountEmailSignInBtn",
      "accountEmailSignUpBtn"
    ];
    for (const id of ids) {
      const el = $(id);
      if (el) el.disabled = !enabled;
    }
  }

  function setSignedInUi(signedIn) {
    const googleBtn = $("accountGoogleBtn");
    const emailToggle = $("accountEmailToggleBtn");
    const emailWrap = $("accountEmailWrap");
    const signOutBtn = $("accountSignOutBtn");
    const emailSignInBtn = $("accountEmailSignInBtn");
    const emailSignUpBtn = $("accountEmailSignUpBtn");

    if (signOutBtn) signOutBtn.hidden = !signedIn;

    if (googleBtn) googleBtn.hidden = signedIn;
    if (emailToggle) emailToggle.hidden = signedIn;
    if (emailWrap) emailWrap.hidden = signedIn ? true : emailWrap.hidden;

    if (emailSignInBtn) emailSignInBtn.textContent = signedIn ? "Switch" : "Sign in";
    if (emailSignUpBtn) emailSignUpBtn.textContent = signedIn ? "Add" : "Sign up";
    if (emailToggle) emailToggle.textContent = signedIn ? "Add email login" : "Use email";
  }

  function authErrorText(err, fallback) {
    const e = err && typeof err === "object" ? err : null;
    const code = e && typeof e.code === "string" ? e.code : "";
    const message = e && typeof e.message === "string" ? e.message : "";
    if (code && message) return `${fallback || "Auth error"}: ${code} — ${message}`;
    if (code) return `${fallback || "Auth error"}: ${code}`;
    if (message) return `${fallback || "Auth error"}: ${message}`;
    return fallback || "Auth error";
  }

  function shouldUseRedirect(err) {
    const e = err && typeof err === "object" ? err : null;
    const code = e && typeof e.code === "string" ? e.code : "";
    return code === "auth/popup-blocked" || code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request";
  }

  function loadFirebaseCompat() {
    if (account.loadPromise) return account.loadPromise;

    const loadScript = (src) => new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });

    account.loadPromise = (async () => {
      const VERSION = "10.7.1";
      await loadScript(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-app-compat.js`);
      await loadScript(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-auth-compat.js`);
      await loadScript(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-firestore-compat.js`);
      if (!window.firebase) throw new Error("Firebase failed to initialize");
      return window.firebase;
    })();

    return account.loadPromise;
  }

  async function ensureFirebaseReady() {
    if (account.firebaseReady) return;
    if (account.initPromise) return account.initPromise;

    account.initPromise = (async () => {
      const cfg = getFirebaseConfig();
      if (!cfg) throw new Error("Firebase not configured");

      const firebase = await loadFirebaseCompat();

      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(cfg);
      }

      const auth = firebase.auth();
      const db = firebase.firestore();

      account.firebase = firebase;
      account.auth = auth;
      account.db = db;

      try {
        const res = await auth.getRedirectResult();
        if (res && res.user) {
          await reconcileCloudWithLocal();
        }
      } catch (e) {
        setAccountStatus(authErrorText(e, "Sign-in failed"));
      }

      auth.onAuthStateChanged(async (user) => {
        account.user = user || null;

        if (!user) {
          setSignedInUi(false);
          if (canAutoUpdateStatus()) setAccountStatus(withProgressSummary("Guest mode. Progress saved on this device."));
          return;
        }

        setSignedInUi(!user.isAnonymous);

        if (canAutoUpdateStatus()) {
          const who = user.email ? `Signed in as ${user.email}.` : "Signed in.";
          const label = user.isAnonymous
            ? "Guest mode. Progress saved on this device. Sign in to sync across devices."
            : `${who} Progress will sync across devices.`;
          setAccountStatus(withProgressSummary(label));
        }

        try {
          await reconcileCloudWithLocal();
        } catch {
          // Ignore sync errors; local progress still works.
        }
      });

      if (!auth.currentUser) {
        try {
          await auth.signInAnonymously();
        } catch {
          // Anonymous auth can fail (blocked third-party cookies / disabled storage). Local still works.
        }
      }

      account.firebaseReady = true;
    })();

    return account.initPromise;
  }

  function userDocBase() {
    const uid = account.user?.uid;
    if (!uid) return null;
    return account.db.collection("users").doc(uid).collection("games");
  }

  async function reconcileCloudWithLocal() {
    const base = userDocBase();
    if (!base) return;

    const snap = await base.get();
    const cloud = new Map();
    snap.forEach((doc) => {
      const d = doc.data();
      if (!d || typeof d !== "object") return;
      const updatedAt = typeof d.updatedAt === "number" ? d.updatedAt : 0;
      const data = d.data && typeof d.data === "object" ? d.data : null;
      if (!data) return;
      cloud.set(doc.id, { data, updatedAt });
    });

    const slugs = new Set([...listLocalProgressSlugs(), ...cloud.keys()]);
    for (const slug of slugs) {
      const local = getLocalProgress(slug);
      const remote = cloud.get(slug) || null;

      if (remote && (!local || remote.updatedAt > local.updatedAt)) {
        setLocalProgress(slug, remote.data, { updatedAt: remote.updatedAt });
      } else if (local && (!remote || local.updatedAt > remote.updatedAt)) {
        await base.doc(slug).set({ data: local.data, updatedAt: local.updatedAt }, { merge: true });
      }
    }
  }

  function scheduleCloudWrite(slug) {
    if (!account.firebaseReady) return;
    if (!account.user?.uid) return;
    const s = normalizeGameSlug(slug);
    if (!s) return;

    const existing = account.writeTimers.get(s);
    if (existing) window.clearTimeout(existing);

    const t = window.setTimeout(async () => {
      account.writeTimers.delete(s);
      const base = userDocBase();
      if (!base) return;
      const local = getLocalProgress(s);
      if (!local) return;
      try {
        await base.doc(s).set({ data: local.data, updatedAt: local.updatedAt }, { merge: true });
      } catch {
        // Ignore; local progress still works.
      }
    }, 500);

    account.writeTimers.set(s, t);
  }

  function initAccountUi() {
    const status = $("accountStatus");
    const googleBtn = $("accountGoogleBtn");
    const emailToggle = $("accountEmailToggleBtn");
    const emailWrap = $("accountEmailWrap");
    const emailEl = $("accountEmail");
    const passEl = $("accountPassword");
    const emailSignInBtn = $("accountEmailSignInBtn");
    const emailSignUpBtn = $("accountEmailSignUpBtn");
    const signOutBtn = $("accountSignOutBtn");

    if (!status || !googleBtn || !emailToggle || !emailWrap || !emailEl || !passEl || !emailSignInBtn || !emailSignUpBtn || !signOutBtn) {
      return;
    }

    const cfg = getFirebaseConfig();
    if (!cfg) {
      setAuthUiEnabled(false);
      setSignedInUi(false);
      setAccountStatus(withProgressSummary("Sync not configured yet. Progress saved on this device."));
      return;
    }

    setAuthUiEnabled(true);
    setSignedInUi(false);

    emailToggle.textContent = "Use email";
    emailSignInBtn.textContent = "Sign in";
    emailSignUpBtn.textContent = "Sign up";

    const initInIdle = () => {
      ensureFirebaseReady().catch(() => {
        setAccountStatus(withProgressSummary("Sync unavailable right now. Progress saved on this device."));
        setAuthUiEnabled(false);
      });
    };

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(initInIdle, { timeout: 1500 });
    } else {
      window.setTimeout(initInIdle, 400);
    }

    emailToggle.addEventListener("click", () => {
      emailWrap.hidden = !emailWrap.hidden;
      emailToggle.textContent = emailWrap.hidden ? "Use email" : "Hide email";
      if (!emailWrap.hidden) {
        try { emailEl.focus(); } catch { /* ignore */ }
      }
    });

    googleBtn.addEventListener("click", async () => {
      try {
        await ensureFirebaseReady();
        const firebase = account.firebase;
        const auth = account.auth;
        if (!firebase || !auth) return;

        const provider = new firebase.auth.GoogleAuthProvider();

        if (auth.currentUser && auth.currentUser.isAnonymous) {
          try {
            await auth.currentUser.linkWithPopup(provider);
            await reconcileCloudWithLocal();
            return;
          } catch (e) {
            const code = e && typeof e === "object" ? e.code : "";
            if (code === "auth/credential-already-in-use") {
              try {
                await auth.signInWithPopup(provider);
                await reconcileCloudWithLocal();
                return;
              } catch (e2) {
                if (shouldUseRedirect(e2)) {
                  await auth.signInWithRedirect(provider);
                  return;
                }
                throw e2;
              }
            }

            if (shouldUseRedirect(e)) {
              await auth.currentUser.linkWithRedirect(provider);
              return;
            }

            throw e;
          }
        }

        try {
          await auth.signInWithPopup(provider);
          await reconcileCloudWithLocal();
        } catch (e) {
          if (shouldUseRedirect(e)) {
            await auth.signInWithRedirect(provider);
            return;
          }
          throw e;
        }
      } catch (e) {
        setAccountStatus(authErrorText(e, "Google sign-in failed"));
      }
    });

    const readEmailPass = () => {
      const email = (emailEl.value || "").trim();
      const password = passEl.value || "";
      return { email, password };
    };

    emailSignUpBtn.addEventListener("click", async () => {
      try {
        await ensureFirebaseReady();
        const firebase = account.firebase;
        const auth = account.auth;
        if (!firebase || !auth) return;

        const { email, password } = readEmailPass();
        if (!email || !password) {
          setAccountStatus("Enter email and password.");
          return;
        }

        if (auth.currentUser) {
          const cred = firebase.auth.EmailAuthProvider.credential(email, password);
          await auth.currentUser.linkWithCredential(cred);
          setAccountStatus("Email login added to your account.", { lockMs: 2500 });
        } else {
          await auth.createUserWithEmailAndPassword(email, password);
          setAccountStatus("Account created. Sync is on.", { lockMs: 2500 });
        }

        await reconcileCloudWithLocal();
      } catch (e) {
        setAccountStatus(authErrorText(e, "Email sign-up failed"), { lockMs: 5000 });
      }
    });

    emailSignInBtn.addEventListener("click", async () => {
      try {
        await ensureFirebaseReady();
        const firebase = account.firebase;
        const auth = account.auth;
        if (!firebase || !auth) return;

        const { email, password } = readEmailPass();
        if (!email || !password) {
          setAccountStatus("Enter email and password.");
          return;
        }

        if (auth.currentUser && !auth.currentUser.isAnonymous) {
          setAccountStatus("You are already signed in. Use Sign out to switch accounts.", { lockMs: 4000 });
          return;
        }

        if (auth.currentUser && auth.currentUser.isAnonymous) {
          const cred = firebase.auth.EmailAuthProvider.credential(email, password);
          try {
            await auth.currentUser.linkWithCredential(cred);
            setAccountStatus("Signed in. Sync is on.", { lockMs: 2500 });
          } catch {
            await auth.signInWithEmailAndPassword(email, password);
            await reconcileCloudWithLocal();
            setAccountStatus("Signed in. Sync is on.", { lockMs: 2500 });
          }
        } else {
          await auth.signInWithEmailAndPassword(email, password);
          await reconcileCloudWithLocal();
          setAccountStatus("Signed in. Sync is on.", { lockMs: 2500 });
        }
      } catch (e) {
        setAccountStatus(authErrorText(e, "Email sign-in failed"), { lockMs: 5000 });
      }
    });

    signOutBtn.addEventListener("click", async () => {
      try {
        await ensureFirebaseReady();
        if (account.auth) {
          await account.auth.signOut();
          try {
            await account.auth.signInAnonymously();
          } catch {
            // Ignore; local progress still works.
          }
        }
        setAccountStatus(withProgressSummary("Signed out. Progress saved on this device."));
      } catch {
        setAccountStatus("Sign out failed.");
      }
    });
  }

  window.PlayvexProgress = {
    get(slug) {
      const v = getLocalProgress(slug);
      return v ? Object.assign({}, v.data) : null;
    },
    set(slug, data) {
      setLocalProgress(slug, data, { updatedAt: Date.now() });
      scheduleCloudWrite(slug);
    },
    merge(slug, patch) {
      mergeLocalProgress(slug, patch);
      scheduleCloudWrite(slug);
    }
  };

  window.PlayvexSettings = {
    get(key, fallback) {
      if (typeof key !== "string" || !key) return fallback;
      return getSetting(key, fallback);
    },
    set(key, value) {
      if (typeof key !== "string" || !key) return;
      setSetting(key, value);
      if (key === "reducedMotion") applyMotionPreference();
    },
    all() {
      return Object.assign({}, readSettingsStore());
    }
  };

  function $(id) {
    return document.getElementById(id);
  }

  function safeJsonParse(str) {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }

  function updateViewportUnits() {
    const h = window.visualViewport && window.visualViewport.height ? window.visualViewport.height : window.innerHeight;
    const vh = h * 0.01;
    document.documentElement.style.setProperty("--vh", `${vh}px`);
  }

  function lockPageScroll() {
    if (document.body.dataset.locked === "true") return;
    const y = window.scrollY || window.pageYOffset || 0;
    document.body.dataset.locked = "true";
    document.body.dataset.scrollY = String(y);
    document.body.style.position = "fixed";
    document.body.style.top = `-${y}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }

  function unlockPageScroll() {
    if (document.body.dataset.locked !== "true") return;
    const y = Number(document.body.dataset.scrollY || "0") || 0;
    document.body.dataset.locked = "false";
    document.body.dataset.scrollY = "";
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    window.scrollTo(0, y);
  }

  function readRecent() {
    try {
      const raw = window.localStorage.getItem(RECENT_KEY);
      const data = safeJsonParse(raw || "");
      if (!Array.isArray(data)) return [];
      return data.filter((x) => typeof x === "string" && x.trim().length > 0);
    } catch {
      return [];
    }
  }

  function writeRecent(slugs) {
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(slugs));
    } catch {
      // localStorage may be unavailable; ignore.
    }
  }

  function pushRecent(slug) {
    if (typeof slug !== "string" || slug.trim().length === 0) return;
    const cur = readRecent();
    const next = [slug, ...cur.filter((s) => s !== slug)].slice(0, 8);
    writeRecent(next);
  }

  function slugFromHref(href) {
    if (typeof href !== "string") return null;
    const m = href.match(/(?:^|\/)games\/([^/]+)\//);
    return m ? m[1] : null;
  }

  function isSameOriginRelative(url) {
    if (typeof url !== "string") return false;
    if (/^https?:\/\//i.test(url)) return false;
    if (/^\/\//.test(url)) return false;
    if (/^javascript:/i.test(url)) return false;
    return true;
  }

  async function fetchJson(url, { timeoutMs = 6000 } = {}) {
    if (!isSameOriginRelative(url)) {
      throw new Error("Only relative URLs are allowed");
    }

    if (cache.has(url)) return cache.get(url);

    const controller = new AbortController();
    const t = window.setTimeout(() => controller.abort(), timeoutMs);

    const p = fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-cache",
      signal: controller.signal,
      headers: { "Accept": "application/json" }
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .finally(() => window.clearTimeout(t));

    cache.set(url, p);
    return p;
  }

  function setMenuOpen(open) {
    const menu = $("mobileMenu");
    const scrim = $("menuScrim");
    const btn = $("menuButton");

    if (!menu || !scrim || !btn) return;

    btn.setAttribute("aria-expanded", String(open));

    if (open) {
      scrim.hidden = false;
      menu.hidden = false;
      menu.dataset.open = "true";
      document.documentElement.classList.add("noscroll");
      document.body.classList.add("noscroll");
      lockPageScroll();
    } else {
      menu.dataset.open = "false";
      document.documentElement.classList.remove("noscroll");
      document.body.classList.remove("noscroll");
      unlockPageScroll();

      window.setTimeout(() => {
        scrim.hidden = true;
        menu.hidden = true;
      }, 150);
    }
  }

  function initMenu() {
    const menu = $("mobileMenu");
    const scrim = $("menuScrim");
    const openBtn = $("menuButton");
    const closeBtn = $("menuCloseButton");

    if (!menu || !scrim || !openBtn || !closeBtn) return;

    openBtn.addEventListener("click", () => setMenuOpen(true));
    closeBtn.addEventListener("click", () => setMenuOpen(false));
    scrim.addEventListener("click", () => setMenuOpen(false));

    menu.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.matches("a")) setMenuOpen(false);
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    });
  }

  function initTopbarScrollState() {
    const bar = document.querySelector(".topbar");
    if (!bar) return;

    const THRESHOLD = 24;
    let raf = 0;

    const apply = () => {
      raf = 0;
      const scrolled = window.scrollY > THRESHOLD;
      bar.dataset.scrolled = scrolled ? "true" : "false";
    };

    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", schedule, { passive: true });
  }

  function renderSkeletonCards(gridEl, count) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const card = document.createElement("div");
      card.className = "card";

      const thumb = document.createElement("div");
      thumb.className = "card__thumb skeleton";

      const body = document.createElement("div");
      body.className = "card__body";

      const title = document.createElement("div");
      title.className = "notice skeleton";
      title.style.margin = "0";
      title.style.height = "44px";

      const desc = document.createElement("div");
      desc.className = "notice skeleton";
      desc.style.margin = "0";
      desc.style.height = "56px";

      const btn = document.createElement("div");
      btn.className = "notice skeleton";
      btn.style.margin = "0";
      btn.style.height = "44px";

      body.appendChild(title);
      body.appendChild(desc);
      body.appendChild(btn);

      card.appendChild(thumb);
      card.appendChild(body);
      frag.appendChild(card);
    }

    gridEl.innerHTML = "";
    gridEl.appendChild(frag);
  }

  function buildGameCard(meta) {
    const card = document.createElement("article");
    card.className = "card";

    const thumbWrap = document.createElement("div");
    thumbWrap.className = "card__thumb";

    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = meta.title ? `${meta.title} thumbnail` : "Game thumbnail";
    img.src = `${SITE_BASE}games/${meta.slug}/${meta.thumbnail}`;

    img.addEventListener("error", () => {
      img.src = THUMB_PLACEHOLDER;
    }, { once: true });

    thumbWrap.appendChild(img);

    const body = document.createElement("div");
    body.className = "card__body";

    const h3 = document.createElement("h3");
    h3.className = "card__title";
    h3.textContent = meta.title || "Untitled game";

    const p = document.createElement("p");
    p.className = "card__desc";
    p.textContent = meta.description || "";

    const metaRow = document.createElement("div");
    metaRow.className = "card__meta";
    const cat = (meta.category || "").toString().trim();
    const catLabel = cat
      ? cat.split(/[-_\s]+/g).filter(Boolean).map((x) => x.slice(0, 1).toUpperCase() + x.slice(1)).join(" ")
      : "";
    const orientation = (meta.orientation || "").toString().toLowerCase().includes("landscape") ? "Landscape" : "Portrait";
    if (catLabel) {
      const el = document.createElement("div");
      el.innerHTML = `<b>${catLabel}</b> • ${orientation}`;
      metaRow.appendChild(el);
    } else {
      const el = document.createElement("div");
      el.innerHTML = `<b>${orientation}</b>`;
      metaRow.appendChild(el);
    }
    const saved = getLocalProgress(meta.slug);
    if (saved) {
      const el = document.createElement("div");
      el.innerHTML = `<b>Saved</b>`;
      metaRow.appendChild(el);
    }

    const actions = document.createElement("div");
    actions.className = "card__actions";

    const playLink = document.createElement("a");
    playLink.className = "btn";
    playLink.href = `${SITE_BASE}games/${meta.slug}/`;
    playLink.textContent = "Play";
    playLink.dataset.slug = meta.slug;
    playLink.setAttribute("aria-label", meta.title ? `Play ${meta.title}` : "Play game");

    actions.appendChild(playLink);

    body.appendChild(h3);
    body.appendChild(p);
    body.appendChild(metaRow);
    body.appendChild(actions);

    card.appendChild(thumbWrap);
    card.appendChild(body);

    return card;
  }

  function wireNavigation(containerEl) {
    const prefetched = new Set();
    const prefetch = (href) => {
      if (!href || prefetched.has(href)) return;
      prefetched.add(href);
      const l = document.createElement("link");
      l.rel = "prefetch";
      l.href = href;
      document.head.appendChild(l);
    };

    const prefetchForSlug = (slug) => {
      if (!slug) return;
      prefetch(`${SITE_BASE}games/${slug}/`);
      prefetch(`${SITE_BASE}games/${slug}/game.js`);
    };

    containerEl.addEventListener("mouseover", (e) => {
      const t = e.target;
      if (!t || !(t instanceof HTMLElement)) return;
      const link = t.closest("a[data-slug]");
      if (!link) return;
      const slug = link.getAttribute("data-slug") || "";
      prefetchForSlug(slug);
    });

    containerEl.addEventListener("focusin", (e) => {
      const t = e.target;
      if (!t || !(t instanceof HTMLElement)) return;
      const link = t.closest("a[data-slug]");
      if (!link) return;
      const slug = link.getAttribute("data-slug") || "";
      prefetchForSlug(slug);
    });

    containerEl.addEventListener("click", (e) => {
      const t = e.target;
      if (!t || !(t instanceof HTMLElement)) return;

      const link = t.closest("a[data-slug]");
      if (link) {
        const slug = link.getAttribute("data-slug");
        if (slug) pushRecent(slug);
        return;
      }

      const btn = t.closest("button[data-href]");
      if (!btn) return;
      const href = btn.getAttribute("data-href");
      if (!href) return;
      const slug = slugFromHref(href);
      if (slug) pushRecent(slug);
      window.location.href = href;
    });
  }

  function normalizeCategory(value) {
    if (typeof value !== "string") return "";
    return value.trim().toLowerCase();
  }

  function labelizeCategory(value) {
    const v = normalizeCategory(value);
    if (!v) return "";
    return v
      .split(/[-_\s]+/g)
      .filter(Boolean)
      .map((p) => p.slice(0, 1).toUpperCase() + p.slice(1))
      .join(" ");
  }

  async function loadSlugs() {
    const data = await fetchJson(`${SITE_BASE}games.json`, { timeoutMs: 6000 });
    if (!Array.isArray(data)) throw new Error("games.json must be an array");
    return data.filter((x) => typeof x === "string" && x.trim().length > 0);
  }

  async function loadMetaForSlug(slug) {
    const meta = await fetchJson(`${SITE_BASE}games/${slug}/meta.json`, { timeoutMs: 6000 });

    if (!meta || typeof meta !== "object") throw new Error("Invalid meta.json");
    if (typeof meta.slug !== "string") meta.slug = slug;
    if (typeof meta.thumbnail !== "string") meta.thumbnail = "thumb.jpg";

    return meta;
  }

  async function initHomepage() {
    const grid = $("gamesGrid");
    const error = $("gamesError");
    const empty = $("gamesEmpty");
    const searchInput = $("searchInput");
    const categorySelect = $("categorySelect");
    const sortSelect = $("sortSelect");
    const continueSection = $("continue");
    const recentGrid = $("recentGrid");
    if (!grid) return;

    renderSkeletonCards(grid, 4);

    let slugs;
    try {
      slugs = await loadSlugs();
    } catch {
      grid.innerHTML = "";
      if (error) error.hidden = false;
      return;
    }

    const heroRandomBtn = $("heroRandomBtn");
    if (heroRandomBtn) {
      heroRandomBtn.addEventListener("click", () => {
        if (!Array.isArray(slugs) || slugs.length === 0) return;
        const slug = slugs[Math.floor(Math.random() * slugs.length)];
        if (!slug) return;
        pushRecent(slug);
        window.location.href = `${SITE_BASE}games/${slug}/`;
      });
    }

    const metas = [];
    const order = new Map();
    for (let i = 0; i < slugs.length; i++) order.set(slugs[i], i);

    const settled = await Promise.allSettled(
      slugs.map((slug) => loadMetaForSlug(slug))
    );

    for (const r of settled) {
      if (r.status === "fulfilled") metas.push(r.value);
    }

    grid.innerHTML = "";
    if (empty) empty.hidden = true;

    if (metas.length === 0) {
      if (error) error.hidden = false;
      return;
    }

    const metasBySlug = new Map();
    for (const m of metas) {
      if (m && typeof m.slug === "string") metasBySlug.set(m.slug, m);
    }

    const categories = Array.from(
      new Set(
        metas
          .map((m) => normalizeCategory(m.category))
          .filter((x) => x.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b));

    if (categorySelect) {
      const frag = document.createDocumentFragment();

      const allOpt = document.createElement("option");
      allOpt.value = "all";
      allOpt.textContent = "All";
      frag.appendChild(allOpt);

      for (const c of categories) {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = labelizeCategory(c);
        frag.appendChild(opt);
      }

      categorySelect.innerHTML = "";
      categorySelect.appendChild(frag);
    }

    const renderList = (list) => {
      const frag = document.createDocumentFragment();
      for (const meta of list) frag.appendChild(buildGameCard(meta));
      grid.innerHTML = "";
      grid.appendChild(frag);
      wireNavigation(grid);

      const hasAny = list.length > 0;
      if (empty) empty.hidden = hasAny;
    };

    const applyFilters = () => {
      const q = (searchInput && typeof searchInput.value === "string")
        ? searchInput.value.trim().toLowerCase()
        : "";

      const cat = categorySelect ? normalizeCategory(categorySelect.value) : "all";
      const sort = sortSelect ? sortSelect.value : "featured";

      let list = metas.slice();

      if (q.length > 0) {
        list = list.filter((m) => {
          const title = (m.title || "").toString().toLowerCase();
          const desc = (m.description || "").toString().toLowerCase();
          return title.includes(q) || desc.includes(q);
        });
      }

      if (cat !== "all" && cat.length > 0) {
        list = list.filter((m) => normalizeCategory(m.category) === cat);
      }

      if (sort === "az") {
        list.sort((a, b) => (a.title || "").toString().localeCompare((b.title || "").toString()));
      } else {
        list.sort((a, b) => (order.get(a.slug) ?? 1e9) - (order.get(b.slug) ?? 1e9));
      }

      renderList(list);
    };

    const renderRecent = () => {
      if (!continueSection || !recentGrid) return;
      const rec = readRecent();
      const items = rec
        .map((s) => metasBySlug.get(s))
        .filter(Boolean)
        .slice(0, 4);

      if (items.length === 0) {
        continueSection.hidden = true;
        recentGrid.innerHTML = "";
        return;
      }

      const frag = document.createDocumentFragment();
      for (const meta of items) frag.appendChild(buildGameCard(meta));
      recentGrid.innerHTML = "";
      recentGrid.appendChild(frag);
      wireNavigation(recentGrid);
      continueSection.hidden = false;
    };

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        applyFilters();
      });
    };

    if (searchInput) searchInput.addEventListener("input", schedule);
    if (categorySelect) categorySelect.addEventListener("change", schedule);
    if (sortSelect) sortSelect.addEventListener("change", schedule);

    renderRecent();
    applyFilters();
  }

  function guessSlugFromPathname() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const idx = parts.lastIndexOf("games");
    if (idx === -1) return null;
    return parts[idx + 1] || null;
  }

  function setMetaDescription(content) {
    if (typeof content !== "string" || content.trim().length === 0) return;

    let el = document.querySelector('meta[name="description"]');
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", "description");
      document.head.appendChild(el);
    }
    el.setAttribute("content", content.trim());
  }

  async function initGamePage() {
    const slug = document.body?.dataset?.gameSlug || guessSlugFromPathname();
    if (!slug) return;

    const titleEl = $("gameTitle");
    const descEl = $("gameDesc");
    const moreGrid = $("moreGamesGrid");

    let meta = null;
    try {
      meta = await loadMetaForSlug(slug);
    } catch {
      if (titleEl) titleEl.textContent = "Game unavailable";
      if (descEl) descEl.textContent = "This game could not be loaded right now.";
      document.title = "Playvex — Game unavailable";
      setMetaDescription("This game could not be loaded right now.");
      return;
    }

    if (titleEl) titleEl.textContent = meta.title || "Untitled game";
    if (descEl) descEl.textContent = meta.description || "";

    document.title = `${meta.title || "Game"} — Playvex`;
    setMetaDescription(meta.description || "Play instant games on Playvex.");

    if (moreGrid) {
      try {
        const slugs = await loadSlugs();
        const others = slugs.filter((s) => s !== slug).slice(0, 3);
        const settled = await Promise.allSettled(others.map((s) => loadMetaForSlug(s)));
        const metas = settled
          .filter((r) => r.status === "fulfilled")
          .map((r) => r.value);

        if (metas.length === 0) {
          moreGrid.innerHTML = "";
          return;
        }

        const frag = document.createDocumentFragment();
        for (const m of metas) frag.appendChild(buildGameCard(m));
        moreGrid.innerHTML = "";
        moreGrid.appendChild(frag);
        wireNavigation(moreGrid);
      } catch {
        moreGrid.innerHTML = "";
      }
    }

    const stage = $("gameStage");

    const gameWrap = stage ? stage.closest(".game-wrap") : null;
    const gameShell = stage ? stage.closest(".game-shell") : null;
    let noticeEl = null;
    const ensureNotice = () => {
      if (!gameShell) return null;
      if (noticeEl && document.contains(noticeEl)) return noticeEl;
      const el = document.createElement("div");
      el.className = "notice";
      el.id = "gameNotice";
      el.hidden = true;
      gameShell.insertBefore(el, gameShell.firstChild);
      noticeEl = el;
      return el;
    };

    const showNotice = (text, { lockMs = 2200 } = {}) => {
      const el = ensureNotice();
      if (!el) return;
      el.textContent = String(text || "");
      el.hidden = false;
      window.clearTimeout(el._pvxT);
      el._pvxT = window.setTimeout(() => {
        el.hidden = true;
      }, Math.max(800, lockMs));
    };

    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
    const canFs = () => !!(gameWrap && (gameWrap.requestFullscreen || gameWrap.webkitRequestFullscreen || gameWrap.msRequestFullscreen));
    const requestFs = async () => {
      if (!gameWrap) return;
      const fn = gameWrap.requestFullscreen || gameWrap.webkitRequestFullscreen || gameWrap.msRequestFullscreen;
      if (!fn) throw new Error("fullscreen_not_supported");
      await fn.call(gameWrap);
    };
    const exitFs = async () => {
      const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (!fn) return;
      await fn.call(document);
    };

    const isTheater = () => document.body.classList.contains("game-theater");
    const enterTheater = () => {
      document.body.classList.add("game-theater");
      document.body.classList.add("game-immersive");
      document.documentElement.classList.add("noscroll");
      document.body.classList.add("noscroll");
      lockPageScroll();
      updateViewportUnits();
    };

    const exitTheater = () => {
      document.body.classList.remove("game-theater");
      document.body.classList.remove("game-immersive");
      document.documentElement.classList.remove("noscroll");
      document.body.classList.remove("noscroll");
      unlockPageScroll();
      updateViewportUnits();
    };

    const setFsButtonState = (btn) => {
      const on = !!fsEl() || isTheater();
      btn.dataset.active = on ? "true" : "false";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.textContent = on ? "Exit" : "Fullscreen";
    };

    const ensureControls = () => {
      if (!gameWrap) return null;
      const existing = gameWrap.querySelector(".game-controls");
      if (existing) return existing;

      const overlay = document.createElement("div");
      overlay.className = "game-overlay";
      overlay.hidden = true;

      const overlayCard = document.createElement("div");
      overlayCard.className = "game-overlay__card";
      overlay.appendChild(overlayCard);

      const setOverlay = ({ title, text, body, actions } = {}) => {
        overlayCard.innerHTML = "";
        const h = document.createElement("h3");
        h.className = "game-overlay__title";
        h.textContent = title || "";
        overlayCard.appendChild(h);

        if (text) {
          const p = document.createElement("p");
          p.className = "game-overlay__text";
          p.textContent = text;
          overlayCard.appendChild(p);
        }

        if (body) overlayCard.appendChild(body);

        if (actions) {
          const a = document.createElement("div");
          a.className = "game-overlay__actions";
          for (const el of actions) a.appendChild(el);
          overlayCard.appendChild(a);
        }
      };

      let paused = false;
      const setPaused = (on) => {
        paused = !!on;
        document.body.classList.toggle("game-paused", paused);
        window.dispatchEvent(new CustomEvent(paused ? "playvex:pause" : "playvex:resume", { detail: { slug } }));
      };

      const syncPauseUi = () => {
        pauseBtn.dataset.active = paused ? "true" : "false";
        pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
        pauseBtn.textContent = paused ? "Resume" : "Pause";
      };

      const closeOverlay = () => {
        overlay.hidden = true;
      };

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeOverlay();
      });

      window.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (!overlay.hidden) {
          closeOverlay();
          return;
        }
        if (paused) setPaused(false);
      });
      const bar = document.createElement("div");
      bar.className = "game-controls";

      const fsBtn = document.createElement("button");
      fsBtn.type = "button";
      fsBtn.className = "game-control-btn";
      fsBtn.setAttribute("aria-label", "Toggle fullscreen");
      fsBtn.setAttribute("aria-pressed", "false");
      fsBtn.textContent = "Fullscreen";

      const immersiveBtn = document.createElement("button");
      immersiveBtn.type = "button";
      immersiveBtn.className = "game-control-btn";
      immersiveBtn.setAttribute("aria-label", "Toggle immersive mode");
      immersiveBtn.setAttribute("aria-pressed", "false");
      immersiveBtn.textContent = "Immersive";

      const restartBtn = document.createElement("button");
      restartBtn.type = "button";
      restartBtn.className = "game-control-btn";
      restartBtn.setAttribute("aria-label", "Restart game");
      restartBtn.textContent = "Restart";

      const pauseBtn = document.createElement("button");
      pauseBtn.type = "button";
      pauseBtn.className = "game-control-btn";
      pauseBtn.setAttribute("aria-label", "Toggle pause");
      pauseBtn.setAttribute("aria-pressed", "false");
      pauseBtn.textContent = "Pause";

      const helpBtn = document.createElement("button");
      helpBtn.type = "button";
      helpBtn.className = "game-control-btn";
      helpBtn.setAttribute("aria-label", "How to play");
      helpBtn.textContent = "Help";

      const settingsBtn = document.createElement("button");
      settingsBtn.type = "button";
      settingsBtn.className = "game-control-btn";
      settingsBtn.setAttribute("aria-label", "Settings");
      settingsBtn.textContent = "Settings";

      pauseBtn.addEventListener("click", () => {
        setPaused(!paused);
        closeOverlay();
        syncPauseUi();
      });

      fsBtn.addEventListener("click", async () => {
        try {
          if (isTheater()) {
            exitTheater();
            return;
          }

          if (fsEl()) {
            await exitFs();
            return;
          }

          if (!canFs()) {
            enterTheater();
            showNotice("Using game mode for fullscreen on this device.");
            return;
          }

          await requestFs();
        } catch {
          enterTheater();
          showNotice("Using game mode for fullscreen on this device.");
        }
      });

      immersiveBtn.addEventListener("click", () => {
        const on = document.body.classList.toggle("game-immersive");
        immersiveBtn.dataset.active = on ? "true" : "false";
        immersiveBtn.setAttribute("aria-pressed", on ? "true" : "false");
        updateViewportUnits();
      });

      restartBtn.addEventListener("click", () => {
        const ev = new CustomEvent("playvex:restart", { detail: { slug }, cancelable: true });
        const ok = window.dispatchEvent(ev);
        if (ok) window.location.reload();
      });

      const helpTextBySlug = {
        "example-game": "Drag to move. Dodge the blocks. Tap to restart after a hit.",
        "aim-pop": "Tap targets before they fade. Miss too many and the run ends.",
        "lane-sprint": "Swipe left or right to switch lanes. Dodge blocks as speed ramps up.",
        "tap-challenge": "Tap as fast as you can for 10 seconds. Beat your best."
      };

      helpBtn.addEventListener("click", () => {
        setPaused(true);
        syncPauseUi();

        const resume = document.createElement("button");
        resume.type = "button";
        resume.className = "btn";
        resume.textContent = "Resume";
        resume.addEventListener("click", () => {
          setPaused(false);
          syncPauseUi();
          closeOverlay();
        });

        setOverlay({
          title: "How to play",
          text: helpTextBySlug[slug] || "Play instantly. Tap to start, and use touch controls to survive and score.",
          actions: [resume]
        });
        overlay.hidden = false;
      });

      settingsBtn.addEventListener("click", () => {
        setPaused(true);
        syncPauseUi();

        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "10px";
        wrap.style.marginTop = "10px";

        const makeToggle = ({ key, title, desc, fallback = true } = {}) => {
          const row = document.createElement("label");
          row.className = "toggle";

          const left = document.createElement("div");
          left.className = "toggle__label";
          const b = document.createElement("b");
          b.textContent = title || key;
          const s = document.createElement("span");
          s.textContent = desc || "";
          left.appendChild(b);
          left.appendChild(s);

          const input = document.createElement("input");
          input.className = "toggle__input";
          input.type = "checkbox";
          input.checked = !!window.PlayvexSettings.get(key, fallback);

          input.addEventListener("change", () => {
            window.PlayvexSettings.set(key, !!input.checked);
          });

          row.appendChild(left);
          row.appendChild(input);
          return row;
        };

        wrap.appendChild(makeToggle({
          key: "vibrate",
          title: "Vibration",
          desc: "Haptic feedback on taps",
          fallback: true
        }));

        wrap.appendChild(makeToggle({
          key: "reducedMotion",
          title: "Reduced motion",
          desc: "Less animations and motion",
          fallback: false
        }));

        const resume = document.createElement("button");
        resume.type = "button";
        resume.className = "btn";
        resume.textContent = "Resume";
        resume.addEventListener("click", () => {
          setPaused(false);
          syncPauseUi();
          closeOverlay();
        });

        const close = document.createElement("button");
        close.type = "button";
        close.className = "btn btn-secondary";
        close.textContent = "Close";
        close.addEventListener("click", () => closeOverlay());

        setOverlay({
          title: "Settings",
          body: wrap,
          actions: [resume, close]
        });
        overlay.hidden = false;
      });

      bar.appendChild(fsBtn);
      bar.appendChild(immersiveBtn);
      bar.appendChild(pauseBtn);
      bar.appendChild(settingsBtn);
      bar.appendChild(helpBtn);
      bar.appendChild(restartBtn);
      gameWrap.appendChild(bar);
      gameWrap.appendChild(overlay);

      const onFsChange = () => {
        setFsButtonState(fsBtn);
        document.body.classList.toggle("game-fullscreen", !!fsEl());
        if (fsEl()) {
          document.body.classList.remove("game-theater");
          document.documentElement.classList.remove("noscroll");
          document.body.classList.remove("noscroll");
          unlockPageScroll();
        }
        updateViewportUnits();
      };
      document.addEventListener("fullscreenchange", onFsChange);
      document.addEventListener("webkitfullscreenchange", onFsChange);
      document.addEventListener("MSFullscreenChange", onFsChange);
      onFsChange();
      syncPauseUi();
      return bar;
    };

    ensureControls();
    const desired = typeof meta.orientation === "string" ? meta.orientation : "portrait-primary";

    const tryLock = async () => {
      if (!screen.orientation || typeof screen.orientation.lock !== "function") return;
      try {
        await screen.orientation.lock(desired);
      } catch {
        // Orientation lock can fail silently depending on platform and gesture requirements.
      }
    };

    if (stage) {
      stage.addEventListener("pointerdown", tryLock, { once: true });
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    updateViewportUnits();
    window.addEventListener("resize", updateViewportUnits, { passive: true });
    window.addEventListener("orientationchange", () => window.setTimeout(updateViewportUnits, 150), { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", updateViewportUnits, { passive: true });
      window.visualViewport.addEventListener("scroll", updateViewportUnits, { passive: true });
    }
    initMenu();
    initTopbarScrollState();
    initAccountUi();
    initHomepage();
    initGamePage();
  });
})();
