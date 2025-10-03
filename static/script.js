const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
let tool = "brush", drawing = false, color = "#2563eb", size = 5;
let startX = 0, startY = 0;
const textInputBox = document.getElementById("textInputBox");
const textValueInput = document.getElementById("textValue");
let history = [], redoHistory = [];
let panX = 0, panY = 0, isPanning = false, startPanX = 0, startPanY = 0;

// WebSocket opcional
const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");

// --- Canvas resize ---
function resizeCanvas() {
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
  redrawFromHistory();
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// --- Herramientas ---
document.querySelectorAll(".tool-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tool-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    tool = btn.dataset.tool || tool;
  });
});

// --- Color y tamaño ---
document.getElementById("colorPicker").addEventListener("change", e => color = e.target.value);
document.getElementById("sizePicker").addEventListener("change", e => size = parseInt(e.target.value));

// --- Undo / Redo ---
document.getElementById("undoBtn").addEventListener("click", () => {
  if (history.length > 0) { redoHistory.push(history.pop()); redrawFromHistory(); }
});
document.getElementById("redoBtn").addEventListener("click", () => {
  if (redoHistory.length > 0) { history.push(redoHistory.pop()); redrawFromHistory(); }
});

// --- Guardar ---
document.getElementById("saveBtn").addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = "pizarra.png";
  link.href = canvas.toDataURL();
  link.click();
});

// --- Limpiar ---
document.getElementById("clearBtn").addEventListener("click", () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  history = []; redoHistory = [];
  ws?.send(JSON.stringify({ type: "clear" }));
});

// --- Expandir canvas dinámicamente ---
function expandCanvasIfNeeded(x, y) {
  let expanded = false;
  if (x + 50 > canvas.width) { canvas.width = x + 200; expanded = true; }
  if (y + 50 > canvas.height) { canvas.height = y + 200; expanded = true; }
  if (expanded) redrawFromHistory();
}

// --- Dibujo ---
function startDraw(x, y) {
  if (tool === "hand") {
    isPanning = true;
    startPanX = x - panX; startPanY = y - panY;
    return;
  }
  drawing = true; startX = x; startY = y;

  if (tool === "text") {
    const rect = canvas.getBoundingClientRect();
    textInputBox.style.display = "block";
    textInputBox.style.left = (x + rect.left) + "px";
    textInputBox.style.top = (y + rect.top) + "px";
    textValueInput.focus();
    drawing = false;
  }
}

function drawMove(x, y) {
  if (tool === "hand" && isPanning) {
    panX = x - startPanX; panY = y - startPanY;
    canvas.style.transform = `translate(${panX}px,${panY}px)`;
    expandCanvasIfNeeded(-panX + canvas.parentElement.clientWidth, -panY + canvas.parentElement.clientHeight);
    return;
  }
  if (!drawing) return;
  expandCanvasIfNeeded(x, y);

  if (tool === "brush" || tool === "eraser") {
    drawLine(startX, startY, x, y, tool === "eraser" ? "eraser" : color, size, true);
    startX = x; startY = y;
  }
}

function endDraw(x, y) {
  if (tool === "hand") { isPanning = false; return; }
  if (!drawing) return;
  drawing = false;
  if (["line", "rect", "circle"].includes(tool)) drawShape(startX, startY, x, y, tool, color, size, true);
}

// --- Eventos mouse/touch ---
function getCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX || e.touches[0].clientX) - rect.left,
    y: (e.clientY || e.touches[0].clientY) - rect.top
  };
}

canvas.addEventListener("mousedown", e => startDraw(e.offsetX, e.offsetY));
canvas.addEventListener("mousemove", e => drawMove(e.offsetX, e.offsetY));
canvas.addEventListener("mouseup", e => endDraw(e.offsetX, e.offsetY));

canvas.addEventListener("touchstart", e => {
  const {x,y} = getCoords(e);
  startDraw(x, y);
});
canvas.addEventListener("touchmove", e => {
  e.preventDefault();
  const {x,y} = getCoords(e);
  drawMove(x, y);
}, { passive: false });
canvas.addEventListener("touchend", e => {
  const {x,y} = getCoords(e.changedTouches[0]);
  endDraw(x, y);
});

// --- Funciones de dibujo ---
function drawLine(x1, y1, x2, y2, c, s, save=false) {
  ctx.lineWidth = s; ctx.lineCap = "round";
  ctx.globalCompositeOperation = (c === "eraser") ? "destination-out" : "source-over";
  ctx.strokeStyle = (c === "eraser") ? "rgba(0,0,0,1)" : c;

  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.globalCompositeOperation = "source-over";

  if (save) saveAction({ type: "line", x1, y1, x2, y2, color: c, size: s });
}

function drawShape(x1, y1, x2, y2, shape, c, s, save=false) {
  ctx.strokeStyle = c; ctx.lineWidth = s; ctx.beginPath();
  if (shape === "line") ctx.moveTo(x1, y1), ctx.lineTo(x2, y2);
  else if (shape === "rect") ctx.rect(x1, y1, x2 - x1, y2 - y1);
  else if (shape === "circle") ctx.arc(x1, y1, Math.hypot(x2 - x1, y2 - y1), 0, 2 * Math.PI);
  ctx.stroke();
  if (save) saveAction({ type: shape, x1, y1, x2, y2, color: c, size: s });
}

// --- Texto ---
function insertText() {
  const rect = canvas.getBoundingClientRect();
  const x = parseInt(textInputBox.style.left) - rect.left;
  const y = parseInt(textInputBox.style.top) - rect.top + size*2;
  const t = textValueInput.value.trim();
  if (!t) return;

  ctx.fillStyle = color;
  ctx.font = `${size*4}px sans-serif`;
  ctx.fillText(t, x, y);
  saveAction({ type: "text", x, y, text: t, color, size });

  textInputBox.style.display = "none";
  textValueInput.value = "";
}

// Atajos Enter/Escape
textValueInput.addEventListener("keydown", e => {
  if(e.key === "Enter") insertText();
  if(e.key === "Escape") { textInputBox.style.display = "none"; textValueInput.value = ""; }
});

// --- Guardar acción en historial + ws ---
function saveAction(item) {
  history.push(item);
  redoHistory = [];
  ws?.send(JSON.stringify(item));
}

// --- Redibujar ---
function redrawFromHistory() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let item of history) {
    if (item.type === "line") drawLine(item.x1, item.y1, item.x2, item.y2, item.color, item.size, false);
    else if (["rect", "circle"].includes(item.type)) drawShape(item.x1, item.y1, item.x2, item.y2, item.type, item.color, item.size, false);
    else if (item.type === "text") {
      ctx.fillStyle = item.color;
      ctx.font = `${item.size*4}px sans-serif`;
      ctx.fillText(item.text, item.x, item.y);
    }
  }
}

// --- WebSocket ---
ws.onmessage = event => {
  const data = JSON.parse(event.data);
  if (data.type === "clear") {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    history = []; redoHistory = [];
  } else if (["line", "rect", "circle"].includes(data.type)) {
    drawShape(data.x1, data.y1, data.x2, data.y2, data.type, data.color, data.size, false);
  } else if (data.type === "text") {
    ctx.fillStyle = data.color;
    ctx.font = `${data.size*4}px sans-serif`;
    ctx.fillText(data.text, data.x, data.y);
  }
};

