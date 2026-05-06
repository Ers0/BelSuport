"""
Belenergy Support Pro - Launcher
Starts all services and opens the app window.
"""

import sys
import os
import subprocess
import time
import threading
import urllib.request
import webbrowser
import signal 
import atexit

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def base_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


BASE = base_dir()
_procs = []


def p(*parts):
    return os.path.join(BASE, *parts)


def _read_dotenv():
    """Read .env manually - works when frozen (no dotenv lib needed)."""
    env = {}
    for name in [".env", ".env.example"]:
        env_path = p(name)
        if not os.path.exists(env_path):
            continue
        with open(env_path, encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip()
                # Strip surrounding quotes if present
                if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
                    val = val[1:-1]
                if key and val:
                    env[key] = val
        break
    return env


def _hidden(cmd, cwd=None, extra_env=None):
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    kwargs = dict(cwd=cwd or BASE, env=env)
    if sys.platform == "win32":
        kwargs["creationflags"] = (
            subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        )
    proc = subprocess.Popen(cmd, **kwargs)
    _procs.append(proc)
    return proc


def _cleanup():
    """Garante que a arvore inteira de processos seja morta"""
    for proc in _procs:
        try:
            if sys.platform == "win32":
                # 1. Envia sinal de interrupcao para o grupo do processo
                os.kill(proc.pid, signal.CTRL_BREAK_EVENT)
                # 2. taskkill com /T garante a morte de todos os filhos (ex: Tesseract, Uvicorn)
                subprocess.run(
                    ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                    creationflags=subprocess.CREATE_NO_WINDOW,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL
                )
            else:
                proc.terminate()
        except Exception:
            pass

# Registra a limpeza para rodar AUTOMATICAMENTE sempre que o launcher morrer
atexit.register(_cleanup)


def _wait(url, timeout=60):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def _start_ollama(dotenv):
    ollama = p("ollama.exe")
    if not os.path.exists(ollama):
        print("  Ollama not found - Tesseract fallback active")
        return
    models_dir = p("models")
    os.makedirs(models_dir, exist_ok=True)
    _hidden([ollama, "serve"], extra_env={"OLLAMA_MODELS": models_dir})
    print("  Ollama starting...")
    time.sleep(2)


def _start_ocr(dotenv):
    # Pass Tesseract/Poppler paths explicitly so ocr_server.exe finds them
    # even when running as frozen exe without access to .env file
    tess_dir    = dotenv.get("TESSERACT_DIR",       r"C:\Program Files\Tesseract-OCR")
    poppler_bin = dotenv.get("POPPLER_BIN",         r"C:\poppler\Library\bin")
    ollama_url  = dotenv.get("OLLAMA_URL",          "http://localhost:11434")
    ollama_mdl  = dotenv.get("OLLAMA_VISION_MODEL", "moondream")

    extra = {
        "TESSERACT_DIR":       tess_dir,
        "TESSDATA_PREFIX":     os.path.join(tess_dir, "tessdata"),
        "POPPLER_BIN":         poppler_bin,
        "OLLAMA_URL":          ollama_url,
        "OLLAMA_VISION_MODEL": ollama_mdl,
        "OLLAMA_MODELS":       p("models"),
        # Ensure tesseract.exe and pdftoppm.exe are findable via PATH
        "PATH": (tess_dir + os.pathsep
                 + poppler_bin + os.pathsep
                 + os.environ.get("PATH", "")),
    }

    ocr_exe    = p("ocr_server.exe")
    ocr_script = p("ocr-service", "ocr_server.py")

    if os.path.exists(ocr_exe):
        _hidden([ocr_exe], extra_env=extra)
        print("  OCR service (exe) starting...")
    elif os.path.exists(ocr_script):
        _hidden([sys.executable, ocr_script], extra_env=extra)
        print("  OCR service (py) starting...")
    else:
        print("  WARNING: ocr_server not found - VEN/ficha disabled")


def _start_node(dotenv):
    node   = p("node.exe")
    if not os.path.exists(node):
        node = "node"
    server = p("server.js")
    if not os.path.exists(server):
        print("  ERROR: server.js not found")
        return
    _hidden(
        [node, server],
        extra_env={
            "BASE_DIR":               BASE,
            "PORT":                   "3000",
            "TESS_OCR_URL":           "http://localhost:8001",
            "OLLAMA_MODELS":          p("models"),
            "DRIVE_MASTER_FOLDER_ID": dotenv.get("DRIVE_MASTER_FOLDER_ID", ""),
            "GOOGLE_CREDENTIALS_PATH":p("credentials.json"),
            "GOOGLE_TOKEN_PATH":      p("token.json"),
        },
    )
    print("  Node.js backend starting...")


def _open_window():
    """
    Window fallback chain:
    1. pywebview EdgeChromium (WebView2 - best, needs runtime installed)
    2. pywebview MSHTML       (old IE engine, always on Windows 10+)
    3. Default browser        (always works, last resort)
    """
    url = "http://localhost:3000"

    try:
        import webview
        window = webview.create_window(
            title="Belenergy Support Pro",
            url=url,
            width=1440,
            height=900,
            min_size=(1024, 640),
            background_color="#0E1117",
            text_select=True,
        )

        # Persistent user data dir so localStorage/cookies survive restarts
        user_data = p("webview_data")
        os.makedirs(user_data, exist_ok=True)

        backends = ["edgechromium", "mshtml"]
        if sys.platform != "win32":
            backends = ["gtk", "cocoa", "qt"]

        for gui in backends:
            try:
                print("  Trying webview backend: " + gui)
                if gui == "edgechromium":
                    # EdgeChromium supports persistent user data
                    webview.start(gui=gui, debug=False,
                                  user_agent=None,
                                  private_mode=False)
                else:
                    webview.start(gui=gui, debug=False)
                return
            except Exception as e:
                print("  " + gui + " failed: " + str(e))

    except ImportError:
        print("  pywebview not installed")
    except Exception as e:
        print("  webview error: " + str(e))

    # Final fallback - open in system browser
    print("  Opening in default browser...")
    webbrowser.open(url)
    print("  Server running at " + url)
    print("  Keep this window open. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        pass


def main():
    print("")
    print("  Belenergy Support Pro")
    print("  Base: " + BASE)
    print("")

    dotenv = _read_dotenv()
    print("  Config loaded: " + str(list(dotenv.keys())))

    threads = [
        threading.Thread(target=_start_ollama, args=(dotenv,), daemon=True),
        threading.Thread(target=_start_ocr,    args=(dotenv,), daemon=True),
        threading.Thread(target=_start_node,   args=(dotenv,), daemon=True),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    print("  Waiting for server (up to 60s)...")
    if not _wait("http://localhost:3000", timeout=60):
        print("  ERROR: Server did not start in time.")
        print("  Check that node.exe and server.js are in: " + BASE)
        _cleanup()
        return

    print("  Server ready")
    _open_window()
    print("  Shutting down...")
    _cleanup()


if __name__ == "__main__":
    main()
