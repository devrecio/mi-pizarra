const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let tool = "brush", drawing = false, color = "#2563eb", size = 5;
let startX = 0, startY = 0;
const textInputBox = document.getElementById("textInputBox");
const textValueInput = document.getElementById("textValue");
let history = [], redoHistory = [];

let panX = 0, panY = 0, isPanning = false, startPanX = 0, startPanY = 0;

// WebSocket
const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");

// --- Canvas resize ---
function resizeCanvas() {
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;
  redrawCanvas();
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
  if (history.length > 0) { redoHistory.push(history.pop()); redrawCanvas(); }
});
document.getElementById("redoBtn").addEventListener("click", () => {
  if (redoHistory.length > 0) { history.push(redoHistory.pop()); redrawCanvas(); }
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
  history = [];
  redoHistory = [];
  redrawCanvas();
  ws?.send(JSON.stringify({ type: "clear" }));
});

// --- Expandir canvas dinámicamente ---
function expandCanvasIfNeeded(x, y) {
  let expanded = false;
  if (x + 50 > canvas.width) { canvas.width = x + 200; expanded = true; }
  if (y + 50 > canvas.height) { canvas.height = y + 200; expanded = true; }
  if (expanded) redrawCanvas();
}

// --- Dibujo ---
function startDraw(x, y) {
  if (tool === "hand") {
    isPanning = true;
    startPanX = x - panX;
    startPanY = y - panY;
    return;
  }
  drawing = true;
  startX = x - panX;
  startY = y - panY;

  if (tool === "text") {
    const rect = canvas.getBoundingClientRect();
    textInputBox.style.display = "block";
    textInputBox.style.left = (x + rect.left) + "px";
    textInputBox.style.top = (y + rect.top) + "px";
    textValueInput.focus();
    drawing = false;
  }
}

// --- Obtener coordenadas ---
function getCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX || e.touches[0].clientX) - rect.left,
    y: (e.clientY || e.touches[0].clientY) - rect.top
  };
}

// --- Movimiento en tiempo real ---
function drawMove(x, y) {
  if (tool === "hand" && isPanning) {
    panX = x - startPanX;
    panY = y - startPanY;
    canvas.style.transform = `translate(${panX}px,${panY}px)`;
    ws?.send(JSON.stringify({ type: "pan", panX, panY }));
    return;
  }

  if (!drawing) return;

  const currX = x - panX;
  const currY = y - panY;

  expandCanvasIfNeeded(currX, currY);

  if (tool === "brush" || tool === "eraser") {
    const drawColor = tool === "eraser" ? "eraser" : color;

    // Dibujar suavemente local
    ctx.lineWidth = size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = (drawColor === "eraser") ? "destination-out" : "source-over";
    ctx.strokeStyle = (drawColor === "eraser") ? "rgba(0,0,0,1)" : drawColor;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(currX, currY);
    ctx.stroke();
    ctx.globalCompositeOperation = "source-over";

    // Guardar en historial
    history.push({ type: "line", x1: startX, y1: startY, x2: currX, y2: currY, color: drawColor, size });

    // Enviar segmento al WebSocket
    ws?.send(JSON.stringify({ type: "line", x1: startX, y1: startY, x2: currX, y2: currY, color: drawColor, size }));

    startX = currX;
    startY = currY;
  }
}

function endDraw(x, y) {
  if (tool === "hand") { isPanning = false; return; }
  if (!drawing) return;
  drawing = false;

  if (["line","rect","circle"].includes(tool)) {
    drawShape(startX, startY, x - panX, y - panY, tool, color, size, true);
    ws?.send(JSON.stringify({ type: tool, x1: startX, y1: startY, x2: x - panX, y2: y - panY, color, size }));
  }
}

// --- Dibujar shapes ---
function drawShape(x1, y1, x2, y2, shape, c, s, save=false) {
  ctx.strokeStyle = c;
  ctx.lineWidth = s;
  ctx.beginPath();
  if (shape === "line") ctx.moveTo(x1, y1), ctx.lineTo(x2, y2);
  else if (shape === "rect") ctx.rect(x1, y1, x2 - x1, y2 - y1);
  else if (shape === "circle") ctx.arc(x1, y1, Math.hypot(x2 - x1, y2 - y1), 0, 2*Math.PI);
  ctx.stroke();
  if (save) history.push({ type: shape, x1, y1, x2, y2, color: c, size: s });
}

// --- Insertar texto ---
function insertText() {
  const rect = canvas.getBoundingClientRect();
  const x = parseInt(textInputBox.style.left) - rect.left - panX;
  const y = parseInt(textInputBox.style.top) - rect.top - panY + size*2;
  const t = textValueInput.value.trim();
  if (!t) return;

  ctx.fillStyle = color;
  ctx.font = `${size*4}px sans-serif`;
  ctx.fillText(t, x, y);
  history.push({ type: "text", x, y, text: t, color, size });
  ws?.send(JSON.stringify({ type: "text", x, y, text: t, color, size }));

  textInputBox.style.display = "none";
  textValueInput.value = "";
}

textValueInput.addEventListener("keydown", e => {
  if (e.key === "Enter") insertText();
  if (e.key === "Escape") { textInputBox.style.display = "none"; textValueInput.value = ""; }
});

// --- Redibujar historial ---
function redrawCanvas() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save();
  ctx.translate(panX, panY);

  for (let item of history) {
    if (item.type === "line") {
      ctx.lineWidth = item.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = (item.color === "eraser") ? "rgba(0,0,0,1)" : item.color;
      ctx.globalCompositeOperation = (item.color === "eraser") ? "destination-out" : "source-over";

      ctx.beginPath();
      ctx.moveTo(item.x1, item.y1);
      ctx.lineTo(item.x2, item.y2);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
    else if (["rect","circle"].includes(item.type)) drawShape(item.x1, item.y1, item.x2, item.y2, item.type, item.color, item.size, false);
    else if (item.type === "text") {
      ctx.fillStyle = item.color;
      ctx.font = `${item.size*4}px sans-serif`;
      ctx.fillText(item.text, item.x, item.y);
    }
  }

  ctx.restore();
}

// --- Eventos ---
canvas.addEventListener("mousedown", e => startDraw(e.offsetX, e.offsetY));
canvas.addEventListener("mousemove", e => drawMove(e.offsetX, e.offsetY));
canvas.addEventListener("mouseup", e => endDraw(e.offsetX, e.offsetY));

canvas.addEventListener("touchstart", e => { const {x,y} = getCoords(e); startDraw(x,y); });
canvas.addEventListener("touchmove", e => { e.preventDefault(); const {x,y} = getCoords(e); drawMove(x,y); }, { passive:false });
canvas.addEventListener("touchend", e => { const {x,y} = getCoords(e.changedTouches[0]); endDraw(x,y); });


// --- WebSocket ---
ws.onmessage = event => {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case "clear":
      history = [];
      redoHistory = [];
      redrawCanvas();
      break;

    case "pan":
      panX = data.panX;
      panY = data.panY;
      canvas.style.transform = `translate(${panX}px,${panY}px)`;
      break;

    case "line":
    case "rect":
    case "circle":
    case "text":
      // Guardamos todos los elementos en el historial
      history.push(data);
      // Redibujamos todo desde el historial para mantener consistencia
      redrawCanvas();
      break;

    default:
      console.warn("Tipo de mensaje desconocido:", data.type);
  }
};


