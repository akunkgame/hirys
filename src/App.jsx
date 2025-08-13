// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import BouncingLogos from "./BouncingLogos";

/* =============== NETWORK =============== */
const IRYS_CHAIN_ID = 1270;
const IRYS_CHAIN_HEX = "0x4F6";
const IRYS_RPC = "https://testnet-rpc.irys.xyz/v1/execution-rpc";
const IRYS_EXPLORER = "https://testnet-explorer.irys.xyz";

/* =============== CONTRACT ============== */
const CONTRACT_ADDRESS = "0x229D336624b807489CcB034Be5F8c967205c1C1a"; // your GMRegistry address
const ABI = [
  "event GM(address indexed user, string gm, uint256 day, string irysId)",
  "function sayGM(string gm, string irysId) external",
  "function streak(address) view returns (uint256)",
  "function lastDay(address) view returns (uint256)",
];

/* =============== HELPERS =============== */
const fmtAddr = (a = "") => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const fmtIRYS = (wei) => {
  try { return Number(ethers.formatEther(wei)).toFixed(3); } catch { return "0.000"; }
};
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ===== Day math helpers ===== */
const todayDay = () => Math.floor(Date.now() / 86400000); // UTC day number
const formatHMS = (ms) => {
  if (ms <= 0) return "00:00:00";
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
};

/* =============== STARFIELD BG ========== */
const spaceBg = {
  backgroundColor: "#060913",
  backgroundImage: `
    radial-gradient(2px 2px at 20% 30%, rgba(255,255,255,0.35) 40%, transparent 42%),
    radial-gradient(1.5px 1.5px at 80% 70%, rgba(255,255,255,0.25) 40%, transparent 42%),
    radial-gradient(1.8px 1.8px at 40% 80%, rgba(255,255,255,0.28) 40%, transparent 42%),
    radial-gradient(2px 2px at 65% 20%, rgba(255,255,255,0.32) 40%, transparent 42%),
    radial-gradient(900px 600px at 50% 10%, rgba(16, 24, 48, 0.9), rgba(6,9,19,1))
  `,
  animation: "twinkle 200s infinite linear",
};

/* =============== CONFETTI ============== */
function fireConfetti() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.style.position = "fixed";
  canvas.style.inset = "0";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = "9999";
  document.body.appendChild(canvas);

  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
  };
  resize();
  window.addEventListener("resize", resize, { once: true });

  const N = 160;
  const particles = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const colors = ["#51FFD6", "#00D4AA", "#FFFFFF", "#B3FFF0", "#7CFFE5"];

  for (let i = 0; i < N; i++) {
    particles.push({
      x: canvas.width / 2 + rnd(-80 * dpr, 80 * dpr),
      y: rnd(-50 * dpr, 0),
      r: rnd(2 * dpr, 4 * dpr),
      vx: rnd(-2, 2) * dpr,
      vy: rnd(6, 10) * dpr,
      a: rnd(-0.03, 0.03),
      rot: rnd(0, Math.PI * 2),
      col: colors[Math.floor(Math.random() * colors.length)],
    });
  }

  let t0 = performance.now();
  const duration = 1600;
  (function frame(t) {
    const dt = t - t0;
    t0 = t;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.rot += p.a;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.col; ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
      ctx.restore();
    });
    if (performance.now() - (t - dt) < duration && particles.some((p) => p.y < canvas.height + 20)) {
      requestAnimationFrame(frame);
    } else { canvas.remove(); }
  })(performance.now());
}

export default function App() {
  // wallet
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [address, setAddress] = useState("");
  const [balance, setBalance] = useState("");
  const [networkOk, setNetworkOk] = useState(false);

  // dapp
  const [hirysMsg, setHirysMsg] = useState("Hirys Datapunks");
  const [busy, setBusy] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [streak, setStreak] = useState(0);
  const [lastDay, setLastDay] = useState(null);
  const [err, setErr] = useState("");
  // countdown until next allowed Hirys
  const [nextLeft, setNextLeft] = useState(0);

  /* ---------- connect ---------- */
  const connect = async () => {
    setErr("");
    if (!window.ethereum) { alert("Install MetaMask or a compatible EVM wallet."); return; }
    const prov = new ethers.BrowserProvider(window.ethereum);
    await prov.send("eth_requestAccounts", []);

    // ensure 1270
    const net = await prov.getNetwork();
    if (Number(net.chainId) !== IRYS_CHAIN_ID) { await switchToIrys(); }

    // hydrate state
    await refreshWalletOnly();
  };

  /* ---------- switch network helper ---------- */
  const switchToIrys = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: IRYS_CHAIN_HEX }] });
    } catch (e) {
      if (e?.code === 4902 || String(e?.message || "").includes("Unrecognized chain ID")) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: IRYS_CHAIN_HEX,
            chainName: "Irys Testnet",
            nativeCurrency: { name: "IRYS", symbol: "IRYS", decimals: 18 },
            rpcUrls: [IRYS_RPC],
            blockExplorerUrls: [IRYS_EXPLORER],
          }],
        });
      } else { throw e; }
    }
  };

  /* ---------- wallet refresh helpers (no page reload) ---------- */
  const clearWallet = () => {
    setProvider(null); setSigner(null); setAddress(""); setBalance(""); setNetworkOk(false);
    setStreak(0); setLastDay(null);
  };

  const refreshWalletOnly = async () => {
    try {
      if (!window.ethereum) return clearWallet();
      const prov = new ethers.BrowserProvider(window.ethereum);
      const accounts = await prov.send("eth_accounts", []);
      if (!accounts || accounts.length === 0) return clearWallet();

      const s = await prov.getSigner();
      const addr = await s.getAddress();
      const net = await prov.getNetwork();
      const bal = await prov.getBalance(addr);

      setProvider(prov); setSigner(s); setAddress(addr);
      setNetworkOk(Number(net.chainId) === IRYS_CHAIN_ID);
      setBalance(fmtIRYS(bal));
    } catch (e) { console.error("refreshWalletOnly:", e); }
  };

  /* ---------- contract ---------- */
  const contract = useMemo(() => {
    try {
      if (!signer) return null;
      if (!CONTRACT_ADDRESS || CONTRACT_ADDRESS.startsWith("0xYOUR_")) return null;
      return new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    } catch (e) { console.error(e); return null; }
  }, [signer]);

  const refresh = async () => {
    if (!contract || !address) return;
    try {
      const s = await contract.streak(address);
      const ld = await contract.lastDay(address);
      setStreak(Number(s)); setLastDay(Number(ld));
    } catch (e) { console.error(e); setErr(e?.message || String(e)); }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [contract, address]);

  // live countdown for "Next Hirys in"
  useEffect(() => {
    const id = setInterval(() => {
      if (lastDay === null) return setNextLeft(0);
      const nowDay = todayDay();
      if (lastDay === nowDay) {
        const end = (nowDay + 1) * 86400 * 1000; // next UTC day start
        setNextLeft(Math.max(0, end - Date.now()));
      } else { setNextLeft(0); }
    }, 1000);
    return () => clearInterval(id);
  }, [lastDay]);

  // react to wallet/chain changes WITHOUT page reload
  useEffect(() => {
    if (!window.ethereum) return;
    const onAccountsChanged = () => refreshWalletOnly();
    const onChainChanged = () => refreshWalletOnly();
    window.ethereum.on?.("accountsChanged", onAccountsChanged);
    window.ethereum.on?.("chainChanged", onChainChanged);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", onChainChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- submit on-chain ---------- */
  const submitHirys = async () => {
    setErr("");
    if (!contract) { alert("Set CONTRACT_ADDRESS"); return; }
    if (!networkOk) { alert("Please switch to Irys Testnet (1270)."); return; }
    if (!hirysMsg.trim()) return; // guard
    setBusy(true); setTxHash("");
    try {
      const msg = (hirysMsg || "Hirys Datapunks").trim();
      const tx = await contract.sayGM(msg, "");
      const rx = await tx.wait();
      setTxHash(rx.hash);

      // toast
      const toast = document.createElement("div");
      toast.textContent = "Hirys submitted on-chain ✓";
      Object.assign(toast.style, { position: "fixed", right: "16px", bottom: "16px", background: "rgba(20,250,200,0.15)", border: "1px solid rgba(20,250,200,0.35)", color: "#cffff4", padding: "10px 12px", borderRadius: "10px", zIndex: 9999, fontFamily: "Inter, system-ui" });
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2200);

      // confetti
      fireConfetti();

      await refresh();
    } catch (e) { console.error(e); setErr(e?.shortMessage || e?.message || String(e)); }
    finally { setBusy(false); }
  };

  /* ---------- UI ---------- */
  return (
    <div style={{ minHeight: "100vh", ...spaceBg, color: "white", fontFamily: "'Space Mono', monospace" }}>
      <style>{`
        @keyframes twinkle { 0% { background-position: 0 0,0 0,0 0,0 0,0 0; } 100% { background-position: 4000px 0,-3000px 0,2500px 0,-2000px 0,0 0; } }
        @font-face { font-family: 'NB International Pro'; src: url('https://irys.xyz/_next/static/media/7b3a157484479c5b-s.p.woff2') format('woff2'); }
        @font-face { font-family: 'Mona Sans'; src: url('https://irys.xyz/_next/static/media/99f63174c49a6c04-s.p.woff2') format('woff2'); }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .cardAnimated { animation: fadeInUp 0.5s ease-out; }
        .ctaBtn:hover { background: linear-gradient(180deg, rgba(133,255,229,0.25), rgba(133,255,229,0.15)); }
        .primaryBtn:not(:disabled):hover { background: linear-gradient(180deg, rgba(133,255,229,0.22), rgba(133,255,229,0.14)); transform: translateY(-1px); box-shadow: 0 6px 20px rgba(0,0,0,0.2); }
        .primaryBtn:disabled { opacity: 0.5; cursor: not-allowed; }
        .link:hover { color: #bfe0ff; }
        .pillLink:hover { background: rgba(133,255,229,0.2); border-color: rgba(133,255,229,0.4); }
        .input:focus { border-color: rgba(133,255,229,0.5); }
      `}</style>

      {/* background decoration */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
        <BouncingLogos />
      </div>

      {/* Topbar */}
      <header style={{ ...topbar, zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BrandLogo />
          <div style={{ fontWeight: 800, letterSpacing: 0.5, fontFamily: "'NB International Pro', sans-serif" }}>Hirys Streak</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Network pill */}
          {networkOk ? (
            <div title="Connected to Irys Testnet" style={pillOk}>Irys Testnet</div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div title="Wrong network" style={pillBad}>Wrong Chain</div>
              <button onClick={switchToIrys} style={miniSwitchBtn} className="ctaBtn">Switch</button>
            </div>
          )}

          <a href="https://irys.xyz/faucet" target="_blank" rel="noreferrer" style={pillLink} className="pillLink">Faucet</a>
          {address ? (
            <>
              <div style={pillMuted}>{balance} IRYS</div>
              <div style={pill}>{fmtAddr(address)}</div>
            </>
          ) : (
            <button onClick={connect} style={ctaBtn} className="ctaBtn">Connect</button>
          )}
        </div>
      </header>

      {/* Hero */}
      <section style={{ ...heroWrap, zIndex: 1 }}>
        <h1 style={heroTitle}>HIRYS</h1>
        <p style={heroSub}>Submit your <b>Hirys</b> on-chain. Keep your streak alive.</p>
      </section>

      {/* Main Card */}
      <main style={{ ...mainWrap, zIndex: 1 }}>
        <div style={card} className="cardAnimated">
          <div style={cardHeader}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={appIcon}>H</div>
              <div>
                <div style={{ fontWeight: 700 }}>Hirys</div>
                <div style={{ opacity: 0.75, fontSize: 12 }}>Submit your Hirys on-chain</div>
              </div>
            </div>
          </div>

          <div style={previewBox}>
            <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 6 }}>Today</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{todayISO()}</div>
            <div style={{ marginTop: 12, fontSize: 14, opacity: 0.9 }}>Message</div>
            <input
              value={hirysMsg}
              onChange={(e) => setHirysMsg(e.target.value)}
              placeholder="Hirys Datapunks"
              style={input}
              className="input"
            />
          </div>

          <button
            onClick={submitHirys}
            disabled={!address || busy || !hirysMsg.trim()}
            style={primaryBtn}
            className="primaryBtn"
          >
            {busy ? "Submitting…" : "Submit Hirys"}
          </button>

          {txHash && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              Tx: {" "}
              <a href={`${IRYS_EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" style={link} className="link">
                {txHash.slice(0, 12)}…
              </a>
            </div>
          )}

          <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Stat label="Streak" value={`${streak} day${streak === 1 ? "" : "s"}`} />
            <Stat label="Last Day (UTC)" value={lastDay !== null ? lastDay : "—"} />
          </div>
        </div>

        {/* Day Streak + Next Hirys */}
        <section style={{ ...streakWrap, zIndex: 1 }}>
          <div style={streakHeaderRow}>
            <div style={streakTitle}>Day Streak</div>
            <div style={nextWrap}>
              <span style={{ opacity: 0.75, marginRight: 8 }}>Next Hirys in:</span>
              {nextLeft > 0 ? (
                <span style={timerPill}>{formatHMS(nextLeft)}</span>
              ) : (
                <span style={timerReady}>Available now</span>
              )}
            </div>
          </div>

          {/* Flames row: cap to 10 for display */}
          <div style={flamesRow}>
            {(() => {
              const nowD = todayDay();
              const cap = 10;
              const litCount = lastDay === null
                ? 0
                : (lastDay === nowD ? Math.min(streak, cap) : Math.min(Math.max(streak - 1, 0), cap));
              const arr = Array.from({ length: cap }, (_, i) => i < litCount);
              return arr.map((lit, i) => (
                <span key={i} style={lit ? fireIconLit : fireIconDim}>🔥</span>
              ));
            })()}
          </div>

          {/* Break notice if user missed 2+ days */}
          {lastDay !== null && todayDay() - lastDay >= 2 && (
            <div style={breakNote}>Streak might be broken — submit a new Hirys to start again.</div>
          )}
        </section>
      </main>

      {err && <div style={errorBox}><b>Error:</b> {err}</div>}

      <footer style={{ padding: "20px 16px", textAlign: "center", opacity: 0.6, fontSize: 14, fontFamily: "'Mona Sans', sans-serif", zIndex: 1, position: "relative" }}>
        <p>
          Made with love for Irys Community, by {" "}
          <a href="https://x.com/oxkagee" target="_blank" rel="noreferrer" style={link} className="link">oxkage</a>
        </p>
      </footer>
    </div>
  );
}

/* ========= Small components ========= */
function Stat({ label, value }) {
  return (
    <div style={statBox}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function BrandLogo() {
  return (
    <div style={{ width: 28, height: 28 }}>
      {/* inline SVG provided */}
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="-100 -100 717 721" style={{ width: "100%", height: "100%" }}>
        <defs>
          <filter id="lightGlow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="35" result="blur1"></feGaussianBlur>
            <feFlood floodColor="#51FFD6" floodOpacity="1.0" result="glow1"></feFlood>
            <feComposite in="glow1" in2="blur1" operator="in" result="glowLayer1"></feComposite>
            <feGaussianBlur stdDeviation="25" result="blur2"></feGaussianBlur>
            <feFlood floodColor="#00D4AA" floodOpacity="0.8" result="glow2"></feFlood>
            <feComposite in="glow2" in2="blur2" operator="in" result="glowLayer2"></feComposite>
            <feMerge>
              <feMergeNode in="glowLayer1"></feMergeNode>
              <feMergeNode in="glowLayer2"></feMergeNode>
              <feMergeNode in="glowLayer3"></feMergeNode>
              <feMergeNode in="glowLayer4"></feMergeNode>
              <feMergeNode in="glowLayer5"></feMergeNode>
              <feMergeNode in="SourceGraphic"></feMergeNode>
            </feMerge>
          </filter>
        </defs>
        <path fill="#fff" stroke="#51FFD6" strokeWidth="10" strokeLinejoin="round" strokeLinecap="round" filter="url(#lightGlow)" d="m459.427 105.86 50.22-2.25 7.22-.32-3.56 6.29-41.59 73.49-20.79 36.75-10.4 18.37-5.03 8.89-2.31 4.08-1.15 2.04-.58 1.02-.29.51c-.09.17-.24.33-.14.53.7 2.92 1.33 5.87 1.89 8.82l.42 2.29.44 2.55c.27 1.71.54 3.41.78 5.12.97 6.84 1.59 13.73 1.89 20.63.14 3.45.23 6.9.18 10.36l-.27 10.36-.79 10.33c-.38 3.43-.86 6.85-1.29 10.28a214.6 214.6 0 0 1-27.59 77.62c-14.06 23.79-32.71 44.82-54.6 61.67-21.87 16.87-46.97 29.54-73.55 37.08-26.57 7.56-54.56 10.03-82.04 7.34-27.49-2.73-54.45-10.69-78.98-23.4a219 219 0 0 1-64.71-50.95c-18.11-20.86-32.2-45.2-41.16-71.35-9-26.13-12.79-54.01-11.35-81.59 1.45-27.6 8.35-54.89 20.13-79.89 11.76-25.01 28.39-47.68 48.63-66.49 20.22-18.82 44.03-33.76 69.79-43.74 12.88-5 26.23-8.76 39.81-11.23 3.4-.6 6.79-1.25 10.23-1.62 3.43-.4 6.84-.95 10.29-1.14l5.16-.39 2.58-.19 2.59-.07 4.88-.12 2.26-.06h.56c.19-.01.38-.01.55-.1l1.06-.39 75.91-27.89L455.617 0l-42.65 114.89-4.04-5.38 50.35-3.64.58 7.98-50.35 3.64-6.2.45 2.16-5.83 36.61-98.61-144.58 53.11-76.82 28.22-1.33.49c-.22.11-.45.11-.69.11l-.71.02-2.83.07-5.29.13-2.49.07-2.49.19-4.98.38c-3.33.17-6.61.71-9.92 1.09-3.31.35-6.58.98-9.86 1.56a210 210 0 0 0-38.35 10.82c-24.81 9.61-47.76 24-67.24 42.14-19.49 18.11-35.51 39.96-46.84 64.04-11.34 24.06-17.98 50.33-19.38 76.91-1.39 26.58 2.27 53.41 10.93 78.57 8.62 25.16 22.19 48.61 39.64 68.7 17.43 20.11 38.71 36.87 62.34 49.09 23.63 12.25 49.6 19.92 76.09 22.55 26.5 2.59 53.48.21 79.07-7.07 25.6-7.26 49.78-19.46 70.85-35.72 21.08-16.24 39.06-36.5 52.6-59.41 13.56-22.89 22.64-48.41 26.56-74.73.41-3.3.87-6.59 1.24-9.9l.76-9.95.26-9.98c.04-3.33-.04-6.65-.18-9.98-.3-6.65-.89-13.28-1.82-19.86-.22-1.65-.49-3.29-.75-4.93l-.42-2.46-.24-1.32-.26-1.39c-.72-3.7-1.53-7.4-2.41-11.07-.08-.24.1-.45.21-.66l.36-.64.72-1.28 1.45-2.56 2.89-5.11 5.37-9.49 10.4-18.37 20.79-36.75 41.59-73.49 3.66 5.97-50.22 2.25-.36-7.99z" />
      </svg>
    </div>
  );
}

/* ========== styles ========== */
const topbar = { height: 64, padding: "0 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.06)", fontFamily: "'Mona Sans', sans-serif" };
const heroWrap = { display: "grid", placeItems: "center", padding: "42px 16px 32px" };
const heroTitle = { margin: 0, textAlign: "center", lineHeight: 1.0, fontSize: 60, fontWeight: 900, letterSpacing: 2, color: "white", textShadow: "0 8px 40px rgba(0,0,0,0.6)", fontFamily: "'NB International Pro', sans-serif" };
const heroSub = { marginTop: 8, textAlign: "center", opacity: 0.8, fontFamily: "'Mona Sans', sans-serif" };
const mainWrap = { display: "grid", placeItems: "center", padding: "16px 16px 60px" };
const card = { width: "min(560px, 92vw)", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: 20, boxShadow: "0 16px 40px rgba(0,0,0,0.4)", fontFamily: "'Mona Sans', sans-serif" };
const cardHeader = { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 };
const appIcon = { width: 38, height: 38, borderRadius: 14, display: "grid", placeItems: "center", fontWeight: 900, background: "linear-gradient(135deg, rgba(28,242,200,0.25), rgba(23,194,166,0.25))", border: "1px solid rgba(28,242,200,0.35)" };
const previewBox = { borderRadius: 14, padding: 16, background: "rgba(9,14,30,0.65)", border: "1px solid rgba(255,255,255,0.08)", minHeight: 120 };
const input = { width: "95%", marginTop: 6, padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.06)", color: "white", outline: "none", fontSize: 14, transition: "border-color 0.2s ease" };
const primaryBtn = { marginTop: 12, width: "100%", padding: "14px 16px", borderRadius: 14, border: "1px solid rgba(133,255,229,0.30)", background: "linear-gradient(180deg, rgba(133,255,229,0.18), rgba(133,255,229,0.10))", color: "white", fontWeight: 800, cursor: "pointer", letterSpacing: 0.3, textTransform: "uppercase", transition: "all 0.2s ease" };
const statBox = { borderRadius: 14, padding: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" };
const ctaBtn = { padding: "8px 12px", borderRadius: 999, border: "1px solid rgba(133,255,229,0.30)", background: "linear-gradient(180deg, rgba(133,255,229,0.18), rgba(133,255,229,0.10))", color: "white", fontWeight: 700, cursor: "pointer", transition: "all 0.2s ease" };
const miniSwitchBtn = { padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(255,200,200,0.35)", background: "rgba(255,200,200,0.12)", color: "#ffd9d9", fontWeight: 700, cursor: "pointer" };
const pill = { padding: "6px 10px", borderRadius: 999, background: "rgba(133,255,229,0.14)", border: "1px solid rgba(133,255,229,0.35)", color: "#cffff4", fontWeight: 700, fontSize: 12 };
const pillOk = { ...pill, background: "rgba(64,255,210,0.16)", border: "1px solid rgba(64,255,210,0.38)", color: "#d7fff5" };
const pillBad = { padding: "6px 10px", borderRadius: 999, background: "rgba(255,90,90,0.14)", border: "1px solid rgba(255,90,90,0.35)", color: "#ffd9d9", fontWeight: 800, fontSize: 12 };
const pillMuted = { ...pill, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.18)", color: "white", opacity: 0.9 };
const pillLink = { ...pill, textDecoration: "none", display: "inline-block", transition: "all 0.2s ease" };
const link = { color: "#9cc8ff", textDecoration: "underline", transition: "color 0.2s ease" };
const errorBox = { position: "fixed", left: 16, bottom: 16, maxWidth: 560, padding: 12, borderRadius: 12, background: "rgba(255,0,0,0.16)", border: "1px solid rgba(255,0,0,0.34)" };

/* ====== Streak styles ====== */
const streakWrap = { width: "min(567px, 92vw)", margin: "36px auto 40px", padding: 16, borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.05)", boxShadow: "0 10px 30px rgba(0,0,0,0.35)", fontFamily: "'Mona Sans', sans-serif" };
const streakHeaderRow = { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 };
const streakTitle = { fontWeight: 800 };
const nextWrap = { display: "flex", alignItems: "center" };
const flamesRow = { display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 8, fontSize: 22 };
const fireIconLit = { filter: "grayscale(0)", textShadow: "0 0 14px rgba(133,255,229,0.55), 0 0 24px rgba(133,255,229,0.35)", transform: "translateY(0)", transition: "all .2s ease" };
const fireIconDim = { filter: "grayscale(100%)", opacity: 0.35, transform: "translateY(0)" };
const timerPill = { padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(133,255,229,0.35)", background: "rgba(133,255,229,0.14)" };
const timerReady = { padding: "6px 10px", borderRadius: 999, border: "1px solid rgba(180,255,160,0.35)", background: "rgba(180,255,160,0.14)" };
const breakNote = { marginTop: 10, fontSize: 12, opacity: 0.7 };
