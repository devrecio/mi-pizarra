from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import uvicorn
import json

app = FastAPI()

# Lista de conexiones activas
connections = []

# Historial de acciones (para nuevos clientes)
history = []
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
async def get():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(f.read())

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connections.append(websocket)

    # Enviar historial existente al nuevo cliente
    for action in history:
        await websocket.send_json(action)

    try:
        while True:
            data = await websocket.receive_text()
            action = json.loads(data)

            # Guardar en historial (excepto movimientos de mano)
            if action["type"] in ("draw", "clear"):
                history.append(action)

            # Limpiar historial si es clear
            if action["type"] == "clear":
                history.clear()

            # Enviar a todos los clientes conectados
            await broadcast(action, websocket)

    except WebSocketDisconnect:
        connections.remove(websocket)


async def broadcast(message: dict, sender: WebSocket = None):
    """Enviar un mensaje a todos los clientes conectados excepto al emisor"""
    disconnected = []
    for conn in connections:
        if conn == sender:
            continue
        try:
            await conn.send_json(message)
        except Exception:
            disconnected.append(conn)

    # Limpiar conexiones muertas
    for d in disconnected:
        connections.remove(d)


if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8001, reload=True)



