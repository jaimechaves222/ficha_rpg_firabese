// App: Campanhas sincronizadas no Firestore (GitHub Pages + Firebase)
// - Mestre cria campanha com senha
// - Jogador entra com código + senha
// - Tempo real com onSnapshot
// - Permissões simples: ver NPCs / ver outros jogadores
//
// Observação: para simplificar, a "senha" fica salva no documento da campanha.
// Para produção, o ideal seria: Firebase Auth + Cloud Functions / hash de senha.

import { firebaseConfig } from "./firebase-config.js";

// Firebase (modular SDK)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc,
  onSnapshot, collection, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const state = {
  role: null,            // 'master' | 'player'
  nick: null,            // apelido do usuário
  campId: null,          // id da campanha
  camp: null,            // dados da campanha
  unsubscribe: null,     // listener
  myPlayerId: null       // id do player doc (para editar própria ficha)
};

function setNetPill() {
  const pill = $("netStatus");
  const online = navigator.onLine;
  pill.textContent = online ? "online" : "offline";
  pill.style.borderColor = online ? "rgba(80,255,168,.45)" : "rgba(255,90,122,.45)";
}

window.addEventListener("online", setNetPill);
window.addEventListener("offline", setNetPill);
setNetPill();

function showHelp() {
  const box = $("help");
  box.classList.toggle("hidden");
  if (!box.classList.contains("hidden")) {
    box.innerHTML = `
      <ol class="muted small" style="margin:0; padding-left:18px">
        <li>Crie um projeto no <b>Firebase Console</b>.</li>
        <li>Ative <b>Firestore Database</b>.</li>
        <li>Em "Configurações do projeto" → "Seus apps" → crie um app <b>Web</b>.</li>
        <li>Copie o objeto <b>firebaseConfig</b> e cole em <b>firebase-config.js</b>.</li>
        <li>Publique no GitHub Pages e teste. Agora as campanhas ficam na nuvem.</li>
      </ol>
      <div class="divider"></div>
      <div class="muted small">
        Se você quiser, eu também posso te passar regras do Firestore para deixar seguro (modo mestre/jogador).
      </div>
    `;
  }
}

$("btnOpenHelp").addEventListener("click", showHelp);
$("btnConfigOk").addEventListener("click", () => alert("Boa! Agora clique em Criar campanha ou Entrar."));

function ensureConfig() {
  const ok = firebaseConfig && firebaseConfig.projectId;
  if (!ok) {
    alert("Você ainda não colou seu firebaseConfig em firebase-config.js.");
  }
  return ok;
}

// Init Firebase
let db = null;
try {
  if (ensureConfig()) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
} catch (e) {
  console.error(e);
}

function randomId(len = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function setUserPill(text) {
  const pill = $("userPill");
  pill.textContent = text;
  pill.classList.remove("ghost");
}

function resetUI() {
  $("app").classList.add("hidden");
  $("createdInfo").classList.add("hidden");
  $("btnCopyCamp").disabled = true;
  $("playersList").innerHTML = "";
  $("npcsList").innerHTML = "";
  $("joinId").value = "";
  $("joinPass").value = "";
  $("joinNick").value = "";
  $("newPass").value = "";
  $("userPill").textContent = "desconectado";
  $("userPill").classList.add("ghost");

  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }
  state.role = null;
  state.nick = null;
  state.campId = null;
  state.camp = null;
  state.myPlayerId = null;
}

$("btnLeave").addEventListener("click", resetUI);

// Tabs
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const target = btn.dataset.tab;
    document.querySelectorAll(".tabpane").forEach(p => p.classList.add("hidden"));
    document.getElementById(target).classList.remove("hidden");
  });
});

async function createCampaign(name, pass) {
  if (!db) return;
  const id = randomId(8);
  const ref = doc(db, "campaigns", id);
  await setDoc(ref, {
    name,
    pass,
    createdAt: serverTimestamp(),
    permissions: {
      canSeeNPCs: false,
      canSeeAllPlayers: false
    }
  });

  // Create subcollections root markers are not needed, but we add an initial NPC for demo
  await addDoc(collection(db, "campaigns", id, "npcs"), {
    name: "NPC Exemplo",
    notes: "Você pode apagar ou editar.",
    createdAt: serverTimestamp()
  });

  return id;
}

$("btnCreateCamp").addEventListener("click", async () => {
  if (!ensureConfig()) return;
  if (!db) return alert("Firebase não inicializou. Verifique firebase-config.js.");

  const name = $("campName").value.trim();
  const pass = $("campPass").value.trim();
  if (!name || !pass) return alert("Preencha nome e senha.");

  const id = await createCampaign(name, pass);

  $("createdInfo").classList.remove("hidden");
  $("createdInfo").innerHTML = `
    <b>Campanha criada!</b><br/>
    Código: <b>${id}</b><br/>
    Compartilhe o <b>código</b> + a <b>senha</b> com seus jogadores.
  `;
  $("btnCopyCamp").disabled = false;
  $("btnCopyCamp").dataset.id = id;
});

$("btnCopyCamp").addEventListener("click", async () => {
  const id = $("btnCopyCamp").dataset.id;
  try {
    await navigator.clipboard.writeText(id);
    alert("Código copiado: " + id);
  } catch {
    prompt("Copie o código:", id);
  }
});

async function verifyCampaign(id, pass) {
  if (!db) return null;
  const ref = doc(db, "campaigns", id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false, msg: "Campanha não existe." };
  const data = snap.data();
  if (data.pass !== pass) return { ok: false, msg: "Senha incorreta." };
  return { ok: true, data };
}

async function ensurePlayerDoc(campId, nick) {
  // Create a player doc in subcollection, return id
  const playerRef = await addDoc(collection(db, "campaigns", campId, "players"), {
    nick,
    sheet: {
      name: nick,
      class: "",
      notes: "",
      attrs: { forca: 1, agilidade: 1, intelecto: 1, presenca: 1, vigor: 1 }
    },
    createdAt: serverTimestamp()
  });
  return playerRef.id;
}

async function enterCampaign({ id, pass, nick, role }) {
  if (!ensureConfig()) return;
  if (!db) return alert("Firebase não inicializou. Verifique firebase-config.js.");

  const v = await verifyCampaign(id, pass);
  if (!v.ok) return alert(v.msg);

  state.role = role;
  state.nick = nick;
  state.campId = id;
  state.camp = v.data;

  setUserPill(`${role === "master" ? "mestre" : "jogador"} • ${nick || "sem nome"}`);

  // Players: master can see all; player sees own unless permission allows
  if (role === "player") {
    state.myPlayerId = await ensurePlayerDoc(id, nick || "Jogador");
  }

  attachRealtime();
  $("app").classList.remove("hidden");
}

$("btnJoinPlayer").addEventListener("click", async () => {
  const id = $("joinId").value.trim();
  const pass = $("joinPass").value.trim();
  const nick = $("joinNick").value.trim() || "Jogador";
  if (!id || !pass) return alert("Preencha código e senha.");
  await enterCampaign({ id, pass, nick, role: "player" });
});

$("btnJoinMaster").addEventListener("click", async () => {
  const id = $("joinId").value.trim();
  const pass = $("joinPass").value.trim();
  const nick = $("joinNick").value.trim() || "Mestre";
  if (!id || !pass) return alert("Preencha código e senha.");
  await enterCampaign({ id, pass, nick, role: "master" });
});

function renderHeader() {
  $("campTitle").textContent = state.camp?.name ? `Campanha • ${state.camp.name}` : "Campanha";
  $("campMeta").textContent = `Código: ${state.campId} • Modo: ${state.role === "master" ? "mestre" : "jogador"}`;
}

function renderPermissions() {
  const p = state.camp?.permissions || {};
  $("canSeeNPCs").checked = !!p.canSeeNPCs;
  $("canSeeAllPlayers").checked = !!p.canSeeAllPlayers;

  const isMaster = state.role === "master";
  $("canSeeNPCs").disabled = !isMaster;
  $("canSeeAllPlayers").disabled = !isMaster;
  $("newPass").disabled = !isMaster;
  $("btnChangePass").disabled = !isMaster;
}

async function updatePermissions(patch) {
  if (state.role !== "master") return alert("Só o mestre pode alterar permissões.");
  const ref = doc(db, "campaigns", state.campId);
  await updateDoc(ref, { permissions: { ...state.camp.permissions, ...patch } });
}

$("canSeeNPCs").addEventListener("change", (e) => updatePermissions({ canSeeNPCs: e.target.checked }));
$("canSeeAllPlayers").addEventListener("change", (e) => updatePermissions({ canSeeAllPlayers: e.target.checked }));

$("btnChangePass").addEventListener("click", async () => {
  if (state.role !== "master") return;
  const newPass = $("newPass").value.trim();
  if (!newPass) return alert("Digite a nova senha.");
  await updateDoc(doc(db, "campaigns", state.campId), { pass: newPass });
  alert("Senha atualizada!");
  $("newPass").value = "";
});

// Create sheets
$("btnNewPlayerChar").addEventListener("click", async () => {
  if (state.role !== "master") return alert("Só o mestre cria novas fichas de jogadores.");
  const nick = prompt("Nome do jogador / personagem?");
  if (!nick) return;
  await addDoc(collection(db, "campaigns", state.campId, "players"), {
    nick,
    sheet: {
      name: nick,
      class: "",
      notes: "",
      attrs: { forca: 1, agilidade: 1, intelecto: 1, presenca: 1, vigor: 1 }
    },
    createdAt: serverTimestamp()
  });
});

$("btnNewNPC").addEventListener("click", async () => {
  if (state.role !== "master") return alert("Só o mestre cria NPCs.");
  const name = prompt("Nome do NPC?");
  if (!name) return;
  await addDoc(collection(db, "campaigns", state.campId, "npcs"), {
    name,
    notes: "",
    createdAt: serverTimestamp()
  });
});

function canPlayerSeeAllPlayers() {
  return !!(state.camp?.permissions?.canSeeAllPlayers);
}
function canPlayerSeeNPCs() {
  return !!(state.camp?.permissions?.canSeeNPCs);
}

function sheetCard({ type, id, data, isYou, isMasterView }) {
  const sheet = data.sheet || {};
  const attrs = (sheet.attrs || {});

  const locked = (state.role === "player" && !isYou && !canPlayerSeeAllPlayers());
  const allowEdit = (state.role === "master") || (state.role === "player" && isYou);

  const attrRow = (k, label) => `
    <div class="field" style="margin:8px 0">
      <label>${label}</label>
      <input data-attr="${k}" value="${attrs[k] ?? 1}" ${allowEdit && !locked ? "" : "disabled"} />
    </div>
  `;

  return `
    <div class="item" data-type="${type}" data-id="${id}">
      <div class="itemTop">
        <div>
          <div style="font-weight:800">${type === "player" ? (sheet.name || data.nick || "Jogador") : (data.name || "NPC")}</div>
          <div class="muted small">${type === "player" ? (data.nick || "") : "NPC"}</div>
        </div>
        <div class="row">
          ${state.role === "master" ? `<span class="tag master">mestre</span>` : ""}
          ${isYou ? `<span class="tag you">você</span>` : ""}
          ${locked ? `<span class="tag">oculto</span>` : ""}
        </div>
      </div>

      ${locked ? `
        <div class="muted small" style="margin-top:10px">
          O mestre não liberou a visualização completa dessa ficha.
        </div>
      ` : `
        ${type === "player" ? `
          <div class="field">
            <label>Classe / descrição</label>
            <input data-field="class" value="${escapeHtml(sheet.class || "")}" ${allowEdit ? "" : "disabled"} />
          </div>
          <div class="field">
            <label>Anotações</label>
            <input data-field="notes" value="${escapeHtml(sheet.notes || "")}" ${allowEdit ? "" : "disabled"} />
          </div>

          <div class="divider"></div>
          <div class="muted small">Atributos</div>
          <div class="grid" style="grid-template-columns: repeat(2, minmax(0,1fr)); gap:10px">
            ${attrRow("forca","Força")}
            ${attrRow("agilidade","Agilidade")}
            ${attrRow("intelecto","Intelecto")}
            ${attrRow("presenca","Presença")}
            ${attrRow("vigor","Vigor")}
          </div>
        ` : `
          <div class="field">
            <label>Notas</label>
            <input data-field="notes" value="${escapeHtml(data.notes || "")}" ${allowEdit ? "" : "disabled"} />
          </div>
        `}
      `}

      <div class="actions">
        ${state.role === "master" ? `<button class="btn small ghost" data-action="delete">Apagar</button>` : ""}
        ${allowEdit && !locked ? `<button class="btn small" data-action="save">Salvar</button>` : ""}
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}

function bindCardEvents(container, kind) {
  container.querySelectorAll(".item").forEach(card => {
    const id = card.dataset.id;
    card.querySelectorAll('button[data-action="save"]').forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!db) return;
        const ref = doc(db, "campaigns", state.campId, kind === "players" ? "players" : "npcs", id);

        const patch = {};
        if (kind === "players") {
          // read inputs
          const sheet = {};
          sheet.class = card.querySelector('input[data-field="class"]')?.value ?? "";
          sheet.notes = card.querySelector('input[data-field="notes"]')?.value ?? "";
          const attrs = {};
          card.querySelectorAll('input[data-attr]').forEach(inp => {
            const k = inp.dataset.attr;
            let v = parseInt(inp.value, 10);
            if (!Number.isFinite(v)) v = 1;
            if (v < 0) v = 0;
            if (v > 10) v = 10;
            attrs[k] = v;
            inp.value = v;
          });
          sheet.attrs = attrs;

          // keep name as nick by default
          sheet.name = card.querySelector('div[style*="font-weight:800"]')?.textContent ?? "";
          patch.sheet = sheet;
        } else {
          patch.notes = card.querySelector('input[data-field="notes"]')?.value ?? "";
        }

        await updateDoc(ref, patch);
        alert("Salvo!");
      });
    });

    card.querySelectorAll('button[data-action="delete"]').forEach(btn => {
      btn.addEventListener("click", async () => {
        if (state.role !== "master") return;
        if (!confirm("Apagar este item?")) return;
        const ref = doc(db, "campaigns", state.campId, kind === "players" ? "players" : "npcs", id);
        // Firestore modular deleteDoc requires import; to keep small, use updateDoc trick? We'll import deleteDoc properly.
      });
    });
  });
}

// We'll import deleteDoc lazily (keeps initial imports simple).
async function deleteDocument(pathParts) {
  const { deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  await deleteDoc(doc(db, ...pathParts));
}

function attachRealtime() {
  renderHeader();

  // Campaign doc listener
  const campRef = doc(db, "campaigns", state.campId);
  const unsubCamp = onSnapshot(campRef, (snap) => {
    if (!snap.exists()) return;
    state.camp = snap.data();
    renderHeader();
    renderPermissions();
  });

  // Players listener
  const playersRef = collection(db, "campaigns", state.campId, "players");
  const unsubPlayers = onSnapshot(playersRef, (snap) => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));

    // Filter for player role
    let visible = items;
    if (state.role === "player" && !canPlayerSeeAllPlayers()) {
      visible = items.filter(p => p.id === state.myPlayerId);
    }

    const html = visible
      .sort((a,b) => (a.nick||"").localeCompare(b.nick||""))
      .map(p => sheetCard({
        type: "player",
        id: p.id,
        data: p,
        isYou: (state.role === "player" && p.id === state.myPlayerId),
        isMasterView: state.role === "master"
      })).join("");

    $("playersList").innerHTML = html || `<div class="muted small">Sem fichas ainda.</div>`;

    // bind delete/save
    $("playersList").querySelectorAll('button[data-action="delete"]').forEach(btn => {
      const card = btn.closest(".item");
      const id = card.dataset.id;
      btn.addEventListener("click", async () => {
        if (state.role !== "master") return;
        if (!confirm("Apagar esta ficha?")) return;
        await deleteDocument(["campaigns", state.campId, "players", id]);
      });
    });

    $("playersList").querySelectorAll('button[data-action="save"]').forEach(btn => {
      const card = btn.closest(".item");
      btn.addEventListener("click", async () => {
        const id = card.dataset.id;
        const ref = doc(db, "campaigns", state.campId, "players", id);

        const sheet = {};
        sheet.class = card.querySelector('input[data-field="class"]')?.value ?? "";
        sheet.notes = card.querySelector('input[data-field="notes"]')?.value ?? "";
        const attrs = {};
        card.querySelectorAll('input[data-attr]').forEach(inp => {
          const k = inp.dataset.attr;
          let v = parseInt(inp.value, 10);
          if (!Number.isFinite(v)) v = 1;
          if (v < 0) v = 0;
          if (v > 10) v = 10;
          attrs[k] = v;
          inp.value = v;
        });
        sheet.attrs = attrs;

        // keep name = nick unless user changes later
        const title = card.querySelector('div[style*="font-weight:800"]')?.textContent ?? "";
        sheet.name = title;

        // permissions already applied via disabled inputs
        await updateDoc(ref, { sheet });
        alert("Salvo!");
      });
    });
  });

  // NPCs listener
  const npcsRef = collection(db, "campaigns", state.campId, "npcs");
  const unsubNPCs = onSnapshot(npcsRef, (snap) => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));

    let visible = items;
    if (state.role === "player" && !canPlayerSeeNPCs()) {
      visible = [];
    }

    const html = visible
      .sort((a,b) => (a.name||"").localeCompare(b.name||""))
      .map(n => sheetCard({ type: "npc", id: n.id, data: n, isYou:false, isMasterView: state.role==="master" }))
      .join("");

    $("npcsList").innerHTML = html || `<div class="muted small">${state.role==="player" ? "NPCs ocultos pelo mestre." : "Sem NPCs ainda."}</div>`;

    $("npcsList").querySelectorAll('button[data-action="delete"]').forEach(btn => {
      const card = btn.closest(".item");
      const id = card.dataset.id;
      btn.addEventListener("click", async () => {
        if (state.role !== "master") return;
        if (!confirm("Apagar este NPC?")) return;
        await deleteDocument(["campaigns", state.campId, "npcs", id]);
      });
    });

    $("npcsList").querySelectorAll('button[data-action="save"]').forEach(btn => {
      const card = btn.closest(".item");
      btn.addEventListener("click", async () => {
        const id = card.dataset.id;
        const ref = doc(db, "campaigns", state.campId, "npcs", id);
        const notes = card.querySelector('input[data-field="notes"]')?.value ?? "";
        await updateDoc(ref, { notes });
        alert("Salvo!");
      });
    });
  });

  state.unsubscribe = () => { unsubCamp(); unsubPlayers(); unsubNPCs(); };

  renderPermissions();
}
