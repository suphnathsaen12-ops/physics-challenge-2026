// ============================================================================
// GitHub Pages Web Dashboard -> MQTT over WSS (broker.emqx.io)
// ============================================================================
const MQTT_WSS_URL = "wss://broker.emqx.io:8084/mqtt";
const STORAGE_TOPIC_KEY = "unoq_physics_topic";
const STORAGE_LOG_KEY = "unoq_physics_logs";

let topicPrefix = localStorage.getItem(STORAGE_TOPIC_KEY) || "unoq_physics_2026_team01";
let client = null;
let lastState = -1;
let countdownInterval = null;
let countdownSec = 60;
let logs = JSON.parse(localStorage.getItem(STORAGE_LOG_KEY) || "[]");

const el = (id) => document.getElementById(id);

function setConnBadge(text, cls) {
  const b = el("conn-badge");
  b.innerHTML = `<span class="pulse-dot"></span>${text}`;
  b.className = "badge " + cls;
}

function formatBallName(ball) {
  if (ball === "BILLIARD") return "🎱 ลูกบิลเลียด";
  if (ball === "TENNIS") return "🎾 ลูกเทนนิส";
  return "รอวางลูก...";
}

function startCountdown() {
  clearInterval(countdownInterval);
  countdownSec = 60;
  el("timer-val").textContent = "01:00";
  countdownInterval = setInterval(() => {
    countdownSec--;
    if (countdownSec <= 0) {
      clearInterval(countdownInterval);
      el("timer-val").textContent = "00:00 (หมดเวลา)";
    } else {
      const s = String(countdownSec).padStart(2, "0");
      el("timer-val").textContent = `00:${s}`;
    }
  }, 1000);
}

function stopCountdown() {
  clearInterval(countdownInterval);
  el("timer-val").textContent = "01:00";
}

function updateScaleMarker(signedCm) {
  const clamped = Math.max(-20, Math.min(20, signedCm));
  const pct = ((clamped + 20) / 40) * 100; // -20 -> 0%, 0 -> 50%, +20 -> 100%
  el("fulcrum-marker").style.left = pct + "%";
  const sign = clamped > 0 ? "+" : "";
  el("marker-tag").textContent = `${sign}${clamped.toFixed(1)} cm`;
}

function renderLogs() {
  const tbody = el("log-tbody");
  if (logs.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">ยังไม่มีข้อมูลการทดลอง</td></tr>';
    return;
  }
  tbody.innerHTML = logs
    .map(
      (r, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${r.time}</td>
        <td>${r.ball}</td>
        <td>${r.target}</td>
        <td>${r.fulcrum}</td>
        <td>${r.height} cm</td>
        <td>${r.success ? "✅ สำเร็จ" : "❌ ไม่สำเร็จ"}</td>
      </tr>`
    )
    .join("");
}

function addLogEntry(d) {
  const now = new Date().toLocaleTimeString("th-TH");
  const sign = d.fulcrum_signed_cm > 0 ? "+" : "";
  logs.push({
    time: now,
    ball: formatBallName(d.ball_type),
    target: d.target_range,
    fulcrum: `${sign}${Number(d.fulcrum_signed_cm).toFixed(1)}`,
    height: Number(d.golf_height_cm).toFixed(1),
    success: Boolean(d.success),
  });
  localStorage.setItem(STORAGE_LOG_KEY, JSON.stringify(logs));
  renderLogs();
}

function updateUI(d) {
  el("val-ball").textContent = formatBallName(d.ball_type);
  el("val-target").textContent = d.target_range || "-";

  const signedCm = Number(d.fulcrum_signed_cm || 0);
  const absCm = Math.abs(signedCm).toFixed(1);
  const sign = signedCm > 0 ? "+" : signedCm < 0 ? "-" : "";
  el("val-fulcrum").textContent = `${absCm} cm (${sign}${absCm})`;
  el("val-fulcrum-dir").textContent =
    signedCm > 0
      ? "เลื่อนไปทางขวา (แท่นสีเทา)"
      : signedCm < 0
      ? "เลื่อนไปทางซ้าย (แท่นสีเหลือง)"
      : "อยู่จุดกึ่งกลาง (25 cm)";
  updateScaleMarker(signedCm);

  el("val-height").textContent = `${Number(d.golf_height_cm || 0).toFixed(1)} cm`;

  // Highlight selected range button
  [1, 2, 3].forEach((n) => {
    el(`btn-r${n}`).classList.toggle("active", d.selected_range === n);
  });

  // Update 5th Judge Status card
  const card = el("card-status");
  const st = el("val-status");
  card.classList.remove("status-ok", "status-fail");

  if (d.state === 4) {
    if (d.success) {
      st.textContent = "✅ สำเร็จ! อยู่ในระยะที่กำหนด";
      card.classList.add("status-ok");
    } else {
      st.textContent = "❌ ไม่สำเร็จ (อยู่นอกระยะที่กำหนด)";
      card.classList.add("status-fail");
    }
  } else if (d.state === 3) {
    st.textContent = "🚀 กำลังปล่อยลูกและวัดความสูง...";
  } else if (d.state === 2) {
    st.textContent = "⚙️ พร้อมปล่อยลูก — ปรับแท่นแล้วกด START";
  } else {
    st.textContent = "⏳ รอดำเนินการ";
  }

  // Trigger 60s timer when entering STATE_READY_START (2)
  if (d.state === 2 && lastState !== 2) {
    startCountdown();
  } else if (d.state === 0 && lastState !== 0) {
    stopCountdown();
  }

  // Record log once when entering STATE_FINISHED (4)
  if (d.state === 4 && lastState !== 4 && lastState !== -1) {
    clearInterval(countdownInterval);
    addLogEntry(d);
  }
  lastState = d.state;

  // Raw debug
  el("raw-ball").textContent = Number(d.raw_ball_mm || 0).toFixed(1);
  el("raw-height").textContent = Number(d.raw_height_mm || 0).toFixed(1);
  el("raw-state").textContent = d.state;
}

function connectMQTT() {
  if (client) client.end(true);
  setConnBadge("กำลังเชื่อมต่อ MQTT...", "badge-warn");

  client = mqtt.connect(MQTT_WSS_URL, {
    clientId: "web_" + Math.random().toString(16).slice(2, 10),
    clean: true,
    reconnectPeriod: 3000,
  });

  client.on("connect", () => {
    setConnBadge(`เชื่อมต่อแล้ว (${topicPrefix})`, "badge-ok");
    client.subscribe(`${topicPrefix}/status`);
  });

  client.on("message", (_topic, message) => {
    try {
      const data = JSON.parse(message.toString());
      updateUI(data);
    } catch (e) {
      console.error("Invalid JSON:", e);
    }
  });

  client.on("error", () => setConnBadge("เชื่อมต่อ MQTT ล้มเหลว", "badge-err"));
  client.on("offline", () => setConnBadge("ขาดการเชื่อมต่อ (Offline)", "badge-err"));
}

function sendCommand(cmd) {
  if (!client || !client.connected) {
    alert("ยังไม่ได้เชื่อมต่อกับบอร์ด UNO Q ครับ");
    return;
  }
  client.publish(`${topicPrefix}/cmd`, JSON.stringify({ cmd }));
}

// Button listeners
document.querySelectorAll("[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", () => sendCommand(btn.dataset.cmd));
});

// Log actions
el("btn-clear-log").addEventListener("click", () => {
  logs = [];
  localStorage.removeItem(STORAGE_LOG_KEY);
  renderLogs();
});

el("btn-export").addEventListener("click", () => {
  if (logs.length === 0) return alert("ยังไม่มีข้อมูลให้ส่งออกครับ");
  const header = "รอบที่,เวลา,ชนิดลูกบอล,ระยะเป้าหมาย,ระยะแท่น(cm),ความสูง(cm),ผลลัพธ์\n";
  const rows = logs
    .map((r, i) => `${i + 1},${r.time},${r.ball},${r.target},${r.fulcrum},${r.height},${r.success ? "สำเร็จ" : "ไม่สำเร็จ"}`)
    .join("\n");
  const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "physics_challenge_2026_log.csv";
  a.click();
});

// Settings Modal
el("btn-settings").addEventListener("click", () => {
  el("topic-input").value = topicPrefix;
  el("settings-modal").classList.remove("hidden");
});
el("btn-close-settings").addEventListener("click", () => {
  el("settings-modal").classList.add("hidden");
});
el("btn-save-settings").addEventListener("click", () => {
  const val = el("topic-input").value.trim();
  if (val) {
    topicPrefix = val;
    localStorage.setItem(STORAGE_TOPIC_KEY, topicPrefix);
    el("settings-modal").classList.add("hidden");
    connectMQTT();
  }
});

// Theme Toggle (Dark Tech / Light Clean)
const themeBtn = el("btn-theme");
if (localStorage.getItem("unoq_theme") === "light") {
  document.body.classList.add("light-theme");
  themeBtn.textContent = "☀️";
}
themeBtn.addEventListener("click", () => {
  const isLight = document.body.classList.toggle("light-theme");
  themeBtn.textContent = isLight ? "☀️" : "🌙";
  localStorage.setItem("unoq_theme", isLight ? "light" : "dark");
});

// Init
renderLogs();
connectMQTT();
