# -*- coding: utf-8 -*-
import os
import sys

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
import time
import socket
import subprocess
import traceback
import json
import urllib.request
import hashlib

PORT = 8900

if getattr(sys, "frozen", False):
    ROOT_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

def read_app_version():
    version_file = os.path.join(ROOT_DIR, "VERSION.json")
    try:
        with open(version_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        version = str(data.get("version", "未知版本")).strip()
        return version or "未知版本"
    except Exception:
        return "未知版本"

APP_VERSION = read_app_version()


def get_instance_id():
    """为当前项目目录生成稳定标识，避免连接到其他副本的服务。"""
    normalized_root = os.path.normcase(os.path.abspath(ROOT_DIR))
    return hashlib.sha256(normalized_root.encode("utf-8")).hexdigest()[:16]


APP_INSTANCE_ID = get_instance_id()

_instance_mutex = None

def acquire_single_instance():
    """使用 Windows 命名互斥体防止重复启动，如果已在运行则将现有窗口置顶激活。"""
    global _instance_mutex
    if sys.platform != 'win32':
        return True
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        user32 = ctypes.windll.user32
        ERROR_ALREADY_EXISTS = 183

        mutex_name = f"Global\\XXPD_SingleInstance_{APP_INSTANCE_ID}"
        _instance_mutex = kernel32.CreateMutexW(None, False, mutex_name)
        last_error = kernel32.GetLastError()

        if last_error == ERROR_ALREADY_EXISTS:
            # 已有实例在运行，查找小小办公窗口并置顶激活
            def enum_windows_callback(hwnd, extra):
                if user32.IsWindowVisible(hwnd):
                    length = user32.GetWindowTextLengthW(hwnd)
                    if length > 0:
                        buff = ctypes.create_unicode_buffer(length + 1)
                        user32.GetWindowTextW(hwnd, buff, length + 1)
                        title = buff.value
                        if "小小办公" in title:
                            # 还原并激活置顶
                            SW_RESTORE = 9
                            user32.ShowWindow(hwnd, SW_RESTORE)
                            user32.SetForegroundWindow(hwnd)
                            return False
                return True

            EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
            user32.EnumWindows(EnumWindowsProc(enum_windows_callback), 0)
            return False
        return True
    except Exception:
        return True

def is_port_open(port=PORT):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.2)
            return s.connect_ex(('127.0.0.1', port)) == 0
    except Exception:
        return False

def verify_xxpd_service(port=PORT, timeout=0.8):
    try:
        url = f"http://127.0.0.1:{port}/api/health"
        req = urllib.request.Request(url, headers={"User-Agent": "XXPD-Launcher"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if getattr(resp, "status", None) == 200 or resp.getcode() == 200:
                data = json.loads(resp.read().decode("utf-8"))
                return (
                    isinstance(data, dict)
                    and data.get("app") == "xxpd"
                    and data.get("instance_id") == APP_INSTANCE_ID
                )
    except Exception:
        return False
    return False

def find_python():
    # 1. 优先使用随附的便携 Python
    local_py = os.path.join(ROOT_DIR, "python", "python.exe")
    if os.path.exists(local_py):
        return local_py

    # 2. 如果未打包且由 Python/Pythonw 脚本启动，尝试推断同目录下的 python.exe
    if not getattr(sys, "frozen", False):
        py_exe = sys.executable
        if py_exe and py_exe.lower().endswith("pythonw.exe"):
            py = py_exe[:-11] + "python.exe"
            if os.path.exists(py):
                return py
        if py_exe and os.path.exists(py_exe):
            return py_exe

    # 3. 回退查找系统 PATH 中的 python.exe
    import shutil
    w = shutil.which("python")
    if w:
        return w

    return local_py

def start_backend():
    if is_port_open(PORT):
        if verify_xxpd_service(PORT):
            return True
        raise RuntimeError(f"端口 {PORT} 已被其他应用占用，且未通过小小办公服务身份校验，请先关闭占用进程")

    py = find_python()
    server_py = os.path.join(ROOT_DIR, "server.py")

    if os.path.exists(py) and os.path.exists(server_py):
        backend_cmd = [py, server_py]
        backend_desc = f"Python: {py}\nScript: {server_py}"
    else:
        raise RuntimeError("未找到可用后端运行环境，请确保根目录包含便携 Python 环境与 server.py")

    # DETACHED_PROCESS (0x8) + CREATE_NEW_PROCESS_GROUP (0x200) + CREATE_NO_WINDOW (0x08000000)
    flags = 0x08000000 | 0x00000008 | 0x00000200 if sys.platform == 'win32' else 0

    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"

    runtime_dir = os.path.join(ROOT_DIR, "data", "runtime")
    os.makedirs(runtime_dir, exist_ok=True)
    log_file = os.path.join(runtime_dir, "server_stdout.log")
    try:
        with open(log_file, "a", encoding="utf-8") as out:
            out.write(f"\n{'='*60}\n")
            out.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] 启动后端服务，版本：{APP_VERSION}\n")
            out.write(f"{backend_desc}\n")
            out.write(f"{'='*60}\n")
            out.flush()

            subprocess.Popen(
                backend_cmd,
                cwd=ROOT_DIR,
                env=env,
                creationflags=flags,
                stdout=out,
                stderr=subprocess.STDOUT,
                close_fds=True
            )
    except Exception as e:
        raise RuntimeError(f"启动后端进程失败：{str(e)}\n\n日志：{log_file}")

    # 轮询等待后端与探针端点完全就绪 (最多等待 60 秒)
    for i in range(120):
        time.sleep(0.5)
        if is_port_open(PORT):
            # 端口已打开，再等待 2 秒让服务完全初始化
            time.sleep(2)
            if verify_xxpd_service(PORT):
                return True
        # 每 10 秒检查一次日志，查看是否有明显错误
        if i > 0 and i % 20 == 0:
            try:
                with open(log_file, "r", encoding="utf-8", errors="replace") as f:
                    lines = f.readlines()
                    last_lines = lines[-10:] if len(lines) > 10 else lines
                    for line in last_lines:
                        if "error" in line.lower() or "exception" in line.lower():
                            raise RuntimeError(f"后端服务启动出错，请查看日志：{log_file}")
            except FileNotFoundError:
                pass
    return False

def launch_desktop_window():
    app_url = f"http://127.0.0.1:{PORT}"
    electron = os.path.join(ROOT_DIR, "desktop-shell", "electron", "electron.exe")
    desktop_shell = os.path.join(ROOT_DIR, "desktop-shell")
    if os.path.exists(electron) and os.path.exists(os.path.join(desktop_shell, "main.js")):
        flags = 0x00000008 | 0x00000200 if sys.platform == 'win32' else 0
        subprocess.Popen(
            [electron, desktop_shell],
            cwd=desktop_shell,
            creationflags=flags,
            close_fds=True,
        )
        return

    try:
        import webview
    except ImportError:
        try:
            import webbrowser
            webbrowser.open(app_url)
        except Exception:
            if sys.platform == 'win32':
                os.startfile(app_url)
        return

    webview.create_window(
        "小小办公",
        app_url,
        width=1440,
        height=960,
        min_size=(1024, 680),
        resizable=True,
        text_select=True,
        zoomable=True,
        background_color="#181818",
    )
    webview.start(debug=False, private_mode=False)

if __name__ == '__main__':
    try:
        # 单实例防多开检查：若已运行则置顶前台窗口并优雅退出
        if not acquire_single_instance():
            sys.exit(0)

        if not start_backend():
            raise RuntimeError(f"后端服务启动超时，端口 {PORT} 未就绪")
        launch_desktop_window()
    except Exception as e:
        runtime_dir = os.path.join(ROOT_DIR, "data", "runtime")
        os.makedirs(runtime_dir, exist_ok=True)
        log_path = os.path.join(runtime_dir, "launcher_error.log")
        with open(log_path, "a", encoding="utf-8") as log_file:
            log_file.write(time.strftime("\n[%Y-%m-%d %H:%M:%S]\n"))
            traceback.print_exc(file=log_file)
        if sys.platform == 'win32':
            import ctypes
            err_msg = str(e).strip()
            msg = f"小小办公启动失败：{err_msg}\n\n错误日志：{log_path}" if err_msg else f"小小办公启动失败。\n错误日志：{log_path}"
            ctypes.windll.user32.MessageBoxW(0, msg, f"小小办公 v{APP_VERSION}", 0x10)
