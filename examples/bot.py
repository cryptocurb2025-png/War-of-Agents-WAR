"""
War of Agents — Python Agent Bot Example
Connects to the game server, registers a hero, and plays autonomously.

Usage:
    pip install requests websocket-client
    python bot.py
"""

import requests
import json
import time
import random
import websocket
import threading

SERVER = "http://localhost:3001"
WS_SERVER = "ws://localhost:3001"

# ─── Configuration ───────────────────────────────────────────
AGENT_ID = f"py-bot-{random.randint(1000,9999)}"
AGENT_NAME = "PythonBot"
FACTION = random.choice(["alliance", "horde"])
HERO_CLASS = random.choice(["knight", "ranger", "mage", "priest", "siegemaster"])

game_state = None
hero_id = None


def register():
    """Register agent with the server."""
    global hero_id
    res = requests.post(f"{SERVER}/api/agents/register", json={
        "agentId": AGENT_ID,
        "name": AGENT_NAME,
        "faction": FACTION,
        "heroClass": HERO_CLASS,
    })
    data = res.json()
    if data.get("success"):
        hero_id = data["heroId"]
        print(f"Registered: {AGENT_NAME} ({FACTION} {HERO_CLASS}) -> {hero_id}")
    else:
        print(f"Registration failed: {data}")
        exit(1)


def get_my_hero():
    """Find our hero in the game state."""
    if not game_state:
        return None
    for h in game_state.get("heroes", []):
        if h.get("agentId") == AGENT_ID:
            return h
    return None


def deploy(action, **kwargs):
    """Send a strategy deployment command."""
    payload = {"agentId": AGENT_ID, "action": action, **kwargs}
    try:
        res = requests.post(f"{SERVER}/api/strategy/deployment", json=payload)
        return res.json()
    except Exception as e:
        print(f"Deploy error: {e}")
        return {}


def find_nearest_enemy(hero):
    """Find the closest enemy unit or hero."""
    hx, hy = hero["x"], hero["y"]
    best = None
    best_dist = float("inf")

    for u in game_state.get("units", []):
        if u["faction"] != FACTION and u.get("alive", True):
            dx, dy = u["x"] - hx, u["y"] - hy
            d = (dx*dx + dy*dy) ** 0.5
            if d < best_dist:
                best_dist = d
                best = u

    for h in game_state.get("heroes", []):
        if h["faction"] != FACTION and h.get("alive", True):
            dx, dy = h["x"] - hx, h["y"] - hy
            d = (dx*dx + dy*dy) ** 0.5
            if d < best_dist:
                best_dist = d
                best = h

    return best, best_dist


def think():
    """Main AI loop — called every second."""
    hero = get_my_hero()
    if not hero or not hero.get("alive"):
        return

    # Retreat if low HP
    if hero["hp"] < hero["maxHp"] * 0.25:
        base_x = 150 if FACTION == "alliance" else 4650
        deploy("move", targetX=base_x, targetY=1200)
        print(f"[{AGENT_NAME}] Retreating! HP: {hero['hp']}/{hero['maxHp']}")
        return

    # Find nearest enemy
    enemy, dist = find_nearest_enemy(hero)

    if enemy:
        # Move toward enemy
        deploy("move", targetX=enemy["x"], targetY=enemy["y"])

        # Use abilities if in range
        for ab in hero.get("abilities", []):
            if ab["cd"] == 0:
                deploy("ability", abilityId=ab["id"])
                print(f"[{AGENT_NAME}] Cast {ab['name']}!")
                break

    # Buy items if we have gold
    if hero["gold"] >= 300:
        for item_id in ["boots", "sword", "shield", "cloak", "relic"]:
            res = deploy("buy", itemId=item_id)
            if res.get("success"):
                print(f"[{AGENT_NAME}] Bought {res.get('item', item_id)}!")
                break


def on_ws_message(ws, message):
    """Handle WebSocket state updates."""
    global game_state
    msg = json.loads(message)
    if msg.get("type") == "state":
        game_state = msg["data"]


def on_ws_error(ws, error):
    print(f"WS Error: {error}")


def on_ws_close(ws, code, msg):
    print("WS Disconnected")


def on_ws_open(ws):
    print(f"Connected to {WS_SERVER}")


def main():
    print(f"=== War of Agents — Python Bot ===")
    print(f"Server: {SERVER}")

    # Register
    register()

    # Connect WebSocket for state updates
    ws = websocket.WebSocketApp(
        WS_SERVER,
        on_message=on_ws_message,
        on_error=on_ws_error,
        on_close=on_ws_close,
        on_open=on_ws_open,
    )
    ws_thread = threading.Thread(target=ws.run_forever, daemon=True)
    ws_thread.start()

    time.sleep(1)

    # Main loop
    print(f"Bot running as {FACTION} {HERO_CLASS}...")
    while True:
        try:
            think()
        except Exception as e:
            print(f"Error: {e}")
        time.sleep(1)


if __name__ == "__main__":
    main()
