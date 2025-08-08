// ====== Feature checks ======
const hasSTT = () =>
  "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
const hasTTS = () => "speechSynthesis" in window;

// ====== Web Speech API: Speech-to-Text ======
function getRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.lang = "kn-IN";          // Kannada
  r.interimResults = true;
  r.continuous = true;       // <-- keep listening
  return r;
}

// ====== Translation backends ======
async function translateViaLibre({ q, source, target }) {
  const res = await fetch("https://libretranslate.com/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q, source, target, format: "text" })
  });
  if (!res.ok) throw new Error("LibreTranslate error " + res.status);
  const data = await res.json();
  if (!data || !data.translatedText) throw new Error("Bad LT response");
  return data.translatedText;
}

async function translateViaMyMemory({ q, source, target }) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
    q
  )}&langpair=${encodeURIComponent(source)}|${encodeURIComponent(target)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("MyMemory error " + res.status);
  const data = await res.json();
  const best = data?.responseData?.translatedText;
  if (!best) throw new Error("Bad MM response");
  return best;
}

async function translate({ q, source, target }) {
  try {
    return await translateViaLibre({ q, source, target });
  } catch (e) {
    console.warn("LibreTranslate failed, falling back to MyMemory", e);
    return await translateViaMyMemory({ q, source, target });
  }
}

// ====== Text-to-Speech ======
function pickKannadaVoice() {
  const voices = speechSynthesis.getVoices();
  const byLang = (l) => voices.find((v) => (v.lang || "").toLowerCase() === l);
  return (
    byLang("kn-in") ||
    voices.find((v) => (v.lang || "").toLowerCase().startsWith("kn")) ||
    voices.find((v) => (v.lang || "").toLowerCase().includes("en-in")) ||
    voices[0] ||
    null
  );
}

function speakKannada(text) {
  return new Promise((resolve, reject) => {
    if (!hasTTS()) return reject(new Error("TTS not supported"));
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickKannadaVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang || "kn-IN";
    u.onend = () => resolve();
    u.onerror = (e) => reject(e.error || new Error("TTS error"));
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

// ====== UI elements ======
const el = (id) => document.getElementById(id);
const sttStatus = el("sttStatus");
const ttsStatus = el("ttsStatus");
const statusLine = el("statusLine");
const errorLine = el("errorLine");
const btnStart = el("btnStart");
const btnStop = el("btnStop");
const btnReset = el("btnReset");
const btnTranslateToEn = el("btnTranslateToEn");
const btnTranslateToKn = el("btnTranslateToKn");
const btnSpeakAgain = el("btnSpeakAgain");
const btnCopy = el("btnCopy");
const knHeard = el("knHeard");
const enMeaning = el("enMeaning");
const myReplyEn = el("myReplyEn");
const knReply = el("knReply");
const btnInstall = el("btnInstall");

// ====== Install prompt (PWA) ======
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  btnInstall.style.display = "inline-block";
});
btnInstall.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  btnInstall.style.display = "none";
});

// ====== Initial feature status ======
sttStatus.textContent = "STT: " + (hasSTT() ? "Available" : "Not supported");
ttsStatus.textContent = "TTS: " + (hasTTS() ? "Available" : "Not supported");

// ====== Continuous listening up to N sentences ======
const MAX_SENTENCES = 5; // <-- change this number if you want more/less
const sentenceCount = (t) => (t.match(/[\.!?…]|[।]/g) || []).length;

let listening = false;
let manualStop = false;     // user pressed Stop
let reachedMax = false;     // we captured MAX_SENTENCES
let recognition = null;

if (hasSTT()) recognition = getRecognition();

function setStatus(msg) {
  statusLine.textContent = msg || "";
}
function setError(msg) {
  errorLine.textContent = msg || "";
}
function setListening(on) {
  listening = on;
  btnStart.disabled = on;
  btnStop.disabled = !on;
  setStatus(on ? "Listening for Kannada…" : "");
}

if (recognition) {
  recognition.onresult = (e) => {
    let interim = "", final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t;
      else interim += t + " ";
    }

    // Append new text to existing textarea content
    const existing = knHeard.value ? knHeard.value + " " : "";
    const combined = (existing + (final || interim)).trim();
    knHeard.value = combined;

    // Auto-stop when we reach MAX_SENTENCES
    if (sentenceCount(combined) >= MAX_SENTENCES) {
      reachedMax = true;
      try { recognition.stop(); } catch {}
      setListening(false);
      setStatus(`Captured ${MAX_SENTENCES} sentences. You can translate now.`);
    }
  };

  recognition.onerror = (e) => {
    setError("Speech recognition error: " + e.error);
    setListening(false);
  };

  // Keep the mic alive unless user pressed Stop or we reached max
  recognition.onend = () => {
    if (listening && !manualStop && !reachedMax) {
      try { recognition.start(); } catch {}
    }
  };
}

// ====== Button handlers ======
btnStart.addEventListener("click", () => {
  setError("");
  if (!hasSTT()) {
    setError("Speech recognition not supported. Use Chrome.");
    return;
  }
  // Reset state for a fresh capture
  manualStop = false;
  reachedMax = false;
  knHeard.value = "";
  enMeaning.value = "";
  myReplyEn.value = "";
  knReply.value = "";
  btnSpeakAgain.disabled = true;
  btnCopy.disabled = true;

  try {
    recognition.start();
    setListening(true);
  } catch {
    setError("Could not start mic. Allow mic permission and retry.");
  }
});

btnStop.addEventListener("click", () => {
  manualStop = true;
  try { recognition.stop(); } catch {}
  setListening(false);
  setStatus("Processing…");
});

btnReset.addEventListener("click", () => {
  manualStop = true;
  try { recognition.stop(); } catch {}
  knHeard.value = "";
  enMeaning.value = "";
  myReplyEn.value = "";
  knReply.value = "";
  setStatus("");
  setError("");
  btnSpeakAgain.disabled = true;
  btnCopy.disabled = true;
});

btnTranslateToEn.addEventListener("click", async () => {
  setError("");
  const q = knHeard.value.trim();
  if (!q) {
    setError("No Kannada captured. Try again.");
    return;
  }
  setStatus("Translating Kannada → English…");
  try {
    const en = await translate({ q, source: "kn", target: "en" });
    enMeaning.value = en;
    setStatus("Ready for your English reply.");
  } catch (e) {
    setError("Translation failed. Please retry.");
  }
});

btnTranslateToKn.addEventListener("click", async () => {
  setError("");
  const q = myReplyEn.value.trim();
  if (!q) {
    setError("Type your reply in English first.");
    return;
  }
  setStatus("Translating English → Kannada…");
  try {
    const kn = await translate({ q, source: "en", target: "kn" });
    knReply.value = kn;
    btnSpeakAgain.disabled = false;
    btnCopy.disabled = false;
    setStatus("Speaking Kannada response…");
    try {
      await speakKannada(kn);
    } catch (e) {
      setError("Speech failed. You can still copy the Kannada text.");
    }
    setStatus("Done.");
  } catch (e) {
    setError("Translation failed. Please retry.");
  }
});

btnSpeakAgain.addEventListener("click", () => {
  if (!knReply.value) return;
  speakKannada(knReply.value).catch(() => setError("Speech failed."));
});

btnCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(knReply.value || "");
    setStatus("Copied!");
    setTimeout(() => setStatus(""), 1200);
  } catch {
    setError("Copy failed");
  }
});

// Refresh voices status after they load
if (hasTTS()) {
  speechSynthesis.onvoiceschanged = () => {
    const count = speechSynthesis.getVoices().length;
    ttsStatus.textContent = "TTS: " + (count ? "Available" : "No voices found");
  };
}
