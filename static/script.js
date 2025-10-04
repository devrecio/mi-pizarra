class Whiteboard {
    constructor() {
        this.canvas = document.getElementById("canvas");
        this.ctx = this.canvas.getContext("2d");
        this.initProperties();
        this.setupEventListeners();
        this.initWebSocket();
        this.resizeCanvas();
    }

    initProperties() {
        this.tool = "brush";
        this.drawing = false;
        this.color = "#2563eb";
        this.size = 5;
        this.startX = 0;
        this.startY = 0;
        this.panX = 0;
        this.panY = 0;
        this.isPanning = false;
        this.startPanX = 0;
        this.startPanY = 0;
        
        this.history = [];
        this.redoHistory = [];
        this.batchOperations = [];
        this.batchTimer = null;
        
        this.textInputBox = document.getElementById("textInputBox");
        this.textValueInput = document.getElementById("textValue");
        
        // Optimización: cache de elementos DOM
        this.toolButtons = document.querySelectorAll(".tool-btn");
        this.colorPicker = document.getElementById("colorPicker");
        this.sizePicker = document.getElementById("sizePicker");
        
        // Configuración de rendimiento
        this.MAX_HISTORY_SIZE = 1000;
        this.BATCH_DELAY = 50; // ms para agrupar operaciones
    }

    setupEventListeners() {
        // Eventos de canvas
        this.canvas.addEventListener("mousedown", this.handleMouseDown.bind(this));
        this.canvas.addEventListener("mousemove", this.throttle(this.handleMouseMove.bind(this), 16));
        this.canvas.addEventListener("mouseup", this.handleMouseUp.bind(this));
        this.canvas.addEventListener("mouseleave", this.handleMouseUp.bind(this));
        
        // Eventos táctiles
        this.canvas.addEventListener("touchstart", this.handleTouchStart.bind(this), { passive: true });
        this.canvas.addEventListener("touchmove", this.throttle(this.handleTouchMove.bind(this), 16), { passive: false });
        this.canvas.addEventListener("touchend", this.handleTouchEnd.bind(this));
        
        // Eventos de interfaz
        this.toolButtons.forEach(btn => {
            btn.addEventListener("click", () => this.setTool(btn.dataset.tool));
        });
        
        this.colorPicker.addEventListener("change", e => this.color = e.target.value);
        this.sizePicker.addEventListener("change", e => this.size = parseInt(e.target.value));
        
        // Eventos de botones
        document.getElementById("undoBtn").addEventListener("click", () => this.undo());
        document.getElementById("redoBtn").addEventListener("click", () => this.redo());
        document.getElementById("saveBtn").addEventListener("click", () => this.save());
        document.getElementById("clearBtn").addEventListener("click", () => this.clear());
        
        // Eventos de texto
        this.textValueInput.addEventListener("keydown", this.handleTextInput.bind(this));
        
        // Eventos de ventana
        window.addEventListener("resize", this.throttle(() => this.resizeCanvas(), 250));
    }

    initWebSocket() {
        try {
            this.ws = new WebSocket(`${location.protocol === "https:" ? "wss://" : "ws://"}${location.host}/ws`);
            this.ws.onmessage = this.handleWebSocketMessage.bind(this);
            this.ws.onerror = (error) => console.error("WebSocket error:", error);
        } catch (error) {
            console.error("WebSocket initialization failed:", error);
        }
    }

    // --- Gestión de herramientas ---
    setTool(tool) {
        this.tool = tool;
        this.toolButtons.forEach(btn => btn.classList.remove("active"));
        const activeBtn = Array.from(this.toolButtons).find(btn => btn.dataset.tool === tool);
        if (activeBtn) activeBtn.classList.add("active");
        
        this.canvas.style.cursor = this.getCursorForTool(tool);
    }

    getCursorForTool(tool) {
        const cursors = {
            brush: "crosshair",
            eraser: "crosshair",
            hand: "grab",
            text: "text",
            line: "crosshair",
            rect: "crosshair",
            circle: "crosshair"
        };
        return cursors[tool] || "default";
    }

    // --- Gestión de canvas ---
    resizeCanvas() {
        const parent = this.canvas.parentElement;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;
        this.redrawCanvas();
    }

    expandCanvasIfNeeded(x, y) {
        const padding = 100;
        let expanded = false;
        
        if (x + padding > this.canvas.width) {
            this.canvas.width = x + padding * 2;
            expanded = true;
        }
        if (y + padding > this.canvas.height) {
            this.canvas.height = y + padding * 2;
            expanded = true;
        }
        
        if (expanded) this.redrawCanvas();
        return expanded;
    }

    // --- Dibujo y formas ---
    startDraw(x, y) {
        if (this.tool === "hand") {
            this.isPanning = true;
            this.startPanX = x - this.panX;
            this.startPanY = y - this.panY;
            this.canvas.style.cursor = "grabbing";
            return;
        }

        if (this.tool === "text") {
            this.showTextInput(x, y);
            return;
        }

        this.drawing = true;
        this.startX = x - this.panX;
        this.startY = y - this.panY;
        this.expandCanvasIfNeeded(this.startX, this.startY);
    }

    drawMove(x, y) {
        if (this.tool === "hand" && this.isPanning) {
            this.panX = x - this.startPanX;
            this.panY = y - this.startPanY;
            this.redrawCanvas();
            this.sendWebSocket({ type: "pan", panX: this.panX, panY: this.panY });
            return;
        }

        if (!this.drawing) return;

        const currX = x - this.panX;
        const currY = y - this.panY;

        if (this.tool === "brush" || this.tool === "eraser") {
            this.drawLine(this.startX, this.startY, currX, currY);
            this.startX = currX;
            this.startY = currY;
        }
    }

    endDraw(x, y) {
        if (this.tool === "hand") {
            this.isPanning = false;
            this.canvas.style.cursor = "grab";
            return;
        }

        if (!this.drawing) return;
        this.drawing = false;

        const endX = x - this.panX;
        const endY = y - this.panY;

        if (["line", "rect", "circle"].includes(this.tool)) {
            this.drawShape(this.startX, this.startY, endX, endY, true);
        }

        // Procesar operaciones en lote
        this.flushBatchOperations();
    }

    drawLine(x1, y1, x2, y2, saveToHistory = true) {
        const isEraser = this.tool === "eraser";
        
        this.ctx.lineWidth = this.size;
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
        this.ctx.strokeStyle = isEraser ? "rgba(0,0,0,1)" : this.color;

        this.ctx.beginPath();
        this.ctx.moveTo(x1, y1);
        this.ctx.lineTo(x2, y2);
        this.ctx.stroke();
        this.ctx.globalCompositeOperation = "source-over";

        if (saveToHistory) {
            const operation = {
                type: "line",
                x1, y1, x2, y2,
                color: isEraser ? "eraser" : this.color,
                size: this.size
            };
            
            this.addToHistory(operation);
            this.sendWebSocket(operation);
        }
    }

    drawShape(x1, y1, x2, y2, saveToHistory = false) {
        this.ctx.strokeStyle = this.color;
        this.ctx.lineWidth = this.size;
        this.ctx.beginPath();

        switch (this.tool) {
            case "line":
                this.ctx.moveTo(x1, y1);
                this.ctx.lineTo(x2, y2);
                break;
            case "rect":
                this.ctx.rect(x1, y1, x2 - x1, y2 - y1);
                break;
            case "circle":
                const radius = Math.hypot(x2 - x1, y2 - y1);
                this.ctx.arc(x1, y1, radius, 0, 2 * Math.PI);
                break;
        }

        this.ctx.stroke();

        if (saveToHistory) {
            const operation = {
                type: this.tool,
                x1, y1, x2, y2,
                color: this.color,
                size: this.size
            };
            
            this.addToHistory(operation);
            this.sendWebSocket(operation);
        }
    }

    // --- Gestión de texto ---
    showTextInput(x, y) {
        const rect = this.canvas.getBoundingClientRect();
        this.textInputBox.style.display = "block";
        this.textInputBox.style.left = (x + rect.left) + "px";
        this.textInputBox.style.top = (y + rect.top) + "px";
        this.textValueInput.focus();
    }

    insertText() {
        const text = this.textValueInput.value.trim();
        if (!text) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = parseInt(this.textInputBox.style.left) - rect.left - this.panX;
        const y = parseInt(this.textInputBox.style.top) - rect.top - this.panY + this.size * 2;

        this.ctx.fillStyle = this.color;
        this.ctx.font = `${this.size * 4}px sans-serif`;
        this.ctx.fillText(text, x, y);

        const operation = {
            type: "text",
            x, y,
            text: text,
            color: this.color,
            size: this.size
        };

        this.addToHistory(operation);
        this.sendWebSocket(operation);

        this.hideTextInput();
    }

    hideTextInput() {
        this.textInputBox.style.display = "none";
        this.textValueInput.value = "";
    }

    handleTextInput(e) {
        if (e.key === "Enter") this.insertText();
        if (e.key === "Escape") this.hideTextInput();
    }

    // --- Historial y deshacer/rehacer ---
    addToHistory(operation) {
        // Limitar tamaño del historial para evitar problemas de memoria
        if (this.history.length >= this.MAX_HISTORY_SIZE) {
            this.history.shift();
        }
        
        this.history.push(operation);
        this.redoHistory = []; // Limpiar redo al hacer nueva operación
    }

    undo() {
        if (this.history.length > 0) {
            this.redoHistory.push(this.history.pop());
            this.redrawCanvas();
            this.sendWebSocket({ type: "undo" });
        }
    }

    redo() {
        if (this.redoHistory.length > 0) {
            this.history.push(this.redoHistory.pop());
            this.redrawCanvas();
            this.sendWebSocket({ type: "redo" });
        }
    }

    // --- Redibujado optimizado ---
    redrawCanvas() {
        // Limpiar canvas eficientemente
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        this.ctx.save();
        this.ctx.translate(this.panX, this.panY);

        // Dibujar todas las operaciones del historial
        this.history.forEach(item => {
            this.drawHistoryItem(item);
        });

        this.ctx.restore();
    }

    drawHistoryItem(item) {
        switch (item.type) {
            case "line":
                this.ctx.lineWidth = item.size;
                this.ctx.lineCap = "round";
                this.ctx.lineJoin = "round";
                this.ctx.strokeStyle = item.color === "eraser" ? "rgba(0,0,0,1)" : item.color;
                this.ctx.globalCompositeOperation = item.color === "eraser" ? "destination-out" : "source-over";

                this.ctx.beginPath();
                this.ctx.moveTo(item.x1, item.y1);
                this.ctx.lineTo(item.x2, item.y2);
                this.ctx.stroke();
                this.ctx.globalCompositeOperation = "source-over";
                break;

            case "rect":
            case "circle":
                this.ctx.strokeStyle = item.color;
                this.ctx.lineWidth = item.size;
                this.ctx.beginPath();

                if (item.type === "rect") {
                    this.ctx.rect(item.x1, item.y1, item.x2 - item.x1, item.y2 - item.y1);
                } else {
                    const radius = Math.hypot(item.x2 - item.x1, item.y2 - item.y1);
                    this.ctx.arc(item.x1, item.y1, radius, 0, 2 * Math.PI);
                }

                this.ctx.stroke();
                break;

            case "text":
                this.ctx.fillStyle = item.color;
                this.ctx.font = `${item.size * 4}px sans-serif`;
                this.ctx.fillText(item.text, item.x, item.y);
                break;
        }
    }

    // --- WebSocket optimizado ---
    sendWebSocket(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    handleWebSocketMessage(event) {
        try {
            const data = JSON.parse(event.data);

            switch (data.type) {
                case "clear":
                    this.history = [];
                    this.redoHistory = [];
                    this.redrawCanvas();
                    break;
                case "pan":
                    this.panX = data.panX;
                    this.panY = data.panY;
                    this.redrawCanvas();
                    break;
                case "undo":
                    if (this.history.length > 0) {
                        this.redoHistory.push(this.history.pop());
                        this.redrawCanvas();
                    }
                    break;
                case "redo":
                    if (this.redoHistory.length > 0) {
                        this.history.push(this.redoHistory.pop());
                        this.redrawCanvas();
                    }
                    break;
                case "line":
                case "rect":
                case "circle":
                case "text":
                    this.addToHistory(data);
                    this.redrawCanvas();
                    break;
            }
        } catch (error) {
            console.error("Error processing WebSocket message:", error);
        }
    }

    // --- Utilidades ---
    throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        }
    }

    flushBatchOperations() {
        if (this.batchOperations.length > 0) {
            this.sendWebSocket({
                type: "batch",
                operations: this.batchOperations
            });
            this.batchOperations = [];
        }
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }
    }

    // --- Control de la pizarra ---
    clear() {
        this.history = [];
        this.redoHistory = [];
        this.redrawCanvas();
        this.sendWebSocket({ type: "clear" });
    }

    save() {
        const link = document.createElement("a");
        link.download = "pizarra.png";
        link.href = this.canvas.toDataURL();
        link.click();
    }

    // --- Handlers de eventos ---
    handleMouseDown(e) {
        this.startDraw(e.offsetX, e.offsetY);
    }

    handleMouseMove(e) {
        this.drawMove(e.offsetX, e.offsetY);
    }

    handleMouseUp(e) {
        this.endDraw(e.offsetX, e.offsetY);
    }

    handleTouchStart(e) {
        e.preventDefault();
        const { x, y } = this.getTouchCoords(e);
        this.startDraw(x, y);
    }

    handleTouchMove(e) {
        e.preventDefault();
        const { x, y } = this.getTouchCoords(e);
        this.drawMove(x, y);
    }

    handleTouchEnd(e) {
        e.preventDefault();
        const { x, y } = this.getTouchCoords(e.changedTouches[0]);
        this.endDraw(x, y);
    }

    getTouchCoords(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }
}

// Inicializar la pizarra cuando el DOM esté listo
document.addEventListener("DOMContentLoaded", () => {
    new Whiteboard();
});
