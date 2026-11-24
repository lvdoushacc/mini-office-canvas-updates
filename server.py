import os
import sys

# 强制 Windows 环境下标准输入输出统一使用 UTF-8 编码，彻底杜绝 GBK/CP936 乱码
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

import mimetypes
import uuid
import time
import threading
import asyncio
import inspect
import urllib.parse
import subprocess
import hashlib
import base64
import json

if sys.platform == 'win32':
    # Windows 平台使用 ProactorEventLoop 确保完美支持异步子进程管道
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

    # 全局注入 CREATE_NO_WINDOW (0x08000000)，彻底杜绝任何外部命令行调用弹出黑色 CMD 窗口
    _orig_create_subprocess_exec = asyncio.create_subprocess_exec
    _orig_create_subprocess_shell = asyncio.create_subprocess_shell

    def _safe_create_subprocess_exec(*args, **kwargs):
        if 'creationflags' not in kwargs:
            kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
        else:
            kwargs['creationflags'] |= subprocess.CREATE_NO_WINDOW
        return _orig_create_subprocess_exec(*args, **kwargs)

    def _safe_create_subprocess_shell(*args, **kwargs):
        if 'creationflags' not in kwargs:
            kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
        else:
            kwargs['creationflags'] |= subprocess.CREATE_NO_WINDOW
        return _orig_create_subprocess_shell(*args, **kwargs)

    asyncio.create_subprocess_exec = _safe_create_subprocess_exec
    asyncio.create_subprocess_shell = _safe_create_subprocess_shell

    _orig_popen_init = subprocess.Popen.__init__
    def _safe_popen_init(self, *args, **kwargs):
        if 'creationflags' not in kwargs:
            kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
        else:
            kwargs['creationflags'] |= subprocess.CREATE_NO_WINDOW
        return _orig_popen_init(self, *args, **kwargs)
    subprocess.Popen.__init__ = _safe_popen_init

# 注册常见视频 MIME 类型
mimetypes.add_type('video/webm', '.webm')
mimetypes.add_type('video/mp4', '.mp4')
mimetypes.add_type('video/mp4', '.m4v')
mimetypes.add_type('video/quicktime', '.mov')

# 确保项目根目录与 XXDP 运行核心在 sys.path 中
if getattr(sys, "frozen", False):
    ROOT_DIR = os.path.dirname(os.path.abspath(sys.executable))
else:
    ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
_NORMALIZED_ROOT = os.path.normcase(os.path.abspath(ROOT_DIR))
APP_INSTANCE_ID = hashlib.sha256(_NORMALIZED_ROOT.encode('utf-8')).hexdigest()[:16]
if sys.platform == 'win32':
    py_dir = os.path.join(ROOT_DIR, 'python')
    if os.path.isdir(py_dir):
        if py_dir not in os.environ.get('PATH', ''):
            os.environ['PATH'] = py_dir + ';' + os.environ.get('PATH', '')
        if hasattr(os, 'add_dll_directory'):
            try:
                os.add_dll_directory(py_dir)
            except Exception:
                pass

if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

XXDP_DIR = os.path.join(ROOT_DIR, 'runtime_core')
if os.path.exists(XXDP_DIR) and XXDP_DIR not in sys.path:
    sys.path.insert(0, XXDP_DIR)

# 设置工作流压缩包最大上传体积为 50GB，解压上限为 100GB，文件数上限为 50,000，彻底解除大素材包与模型包导入限制
DEFAULT_WORKFLOW_ARCHIVE_MAX_BYTES = 50 * 1024 * 1024 * 1024
DEFAULT_WORKFLOW_ARCHIVE_MAX_EXPANDED_BYTES = 100 * 1024 * 1024 * 1024
DEFAULT_WORKFLOW_ARCHIVE_MAX_FILES = 50000

os.environ["WORKFLOW_ARCHIVE_MAX_BYTES"] = os.getenv("WORKFLOW_ARCHIVE_MAX_BYTES", str(DEFAULT_WORKFLOW_ARCHIVE_MAX_BYTES))
os.environ["WORKFLOW_ARCHIVE_MAX_EXPANDED_BYTES"] = os.getenv("WORKFLOW_ARCHIVE_MAX_EXPANDED_BYTES", str(DEFAULT_WORKFLOW_ARCHIVE_MAX_EXPANDED_BYTES))
os.environ["WORKFLOW_ARCHIVE_MAX_FILES"] = os.getenv("WORKFLOW_ARCHIVE_MAX_FILES", str(DEFAULT_WORKFLOW_ARCHIVE_MAX_FILES))

# 导入 XXDP 成熟图片与视频生成核心服务与任务管理器
import main
main.WORKFLOW_ARCHIVE_MAX_BYTES = int(os.environ["WORKFLOW_ARCHIVE_MAX_BYTES"])
main.WORKFLOW_ARCHIVE_MAX_EXPANDED_BYTES = int(os.environ["WORKFLOW_ARCHIVE_MAX_EXPANDED_BYTES"])
main.WORKFLOW_ARCHIVE_MAX_FILES = int(os.environ["WORKFLOW_ARCHIVE_MAX_FILES"])
# 规范化：不再强制创建或插入“默认项目”，所有项目均由用户自主创建与管理
main.ensure_default_project = lambda: main.load_projects()

from lan.manager import lan_manager

import json
import re
import secrets
from typing import Optional, List, Dict, Any, Tuple
from pydantic import BaseModel

# ================= 本地与存储管理 (Storage Settings V1) =================
STORAGE_SETTINGS_FILE = os.path.join(ROOT_DIR, "data", "storage_settings.json")

DEFAULT_STORAGE_CONFIG = {
    "data_dir": os.path.join(ROOT_DIR, "data"),
    "canvas_dir": os.path.join(ROOT_DIR, "data", "canvases"),
    "assets_dir": os.path.join(ROOT_DIR, "assets"),
    "upload_dir": os.path.join(ROOT_DIR, "assets", "uploads"),
    "input_dir": os.path.join(ROOT_DIR, "assets", "input"),
    "output_dir": os.path.join(ROOT_DIR, "assets", "output"),
    "workflow_dir": os.path.join(ROOT_DIR, "workflows"),
}

def is_reference_path(path: str) -> bool:
    if not path:
        return False
    norm = os.path.normpath(os.path.abspath(path)).lower()
    norm_runtime_core = os.path.normpath(os.path.abspath(XXDP_DIR)).lower()
    return (
        norm.startswith(norm_runtime_core)
        or ("runtime_core" in norm)
    )

def check_path_status(path: str, is_file: bool = False) -> dict:
    abs_path = os.path.normpath(os.path.abspath(path))
    exists = os.path.exists(abs_path)
    is_dir = os.path.isdir(abs_path)
    readable = os.access(abs_path, os.R_OK) if exists else False
    writable = False
    is_ref = is_reference_path(abs_path)

    if exists:
        if is_file:
            writable = os.access(abs_path, os.W_OK)
        elif is_dir:
            try:
                test_file = os.path.join(abs_path, f".write_test_{uuid.uuid4().hex}")
                with open(test_file, "w") as f:
                    f.write("1")
                os.remove(test_file)
                writable = True
            except Exception:
                writable = False
    return {
        "path": abs_path,
        "exists": exists,
        "is_dir": is_dir,
        "readable": readable,
        "writable": writable,
        "is_reference": is_ref,
    }

def resolve_safe_file(base_dir: str, rel_path: str) -> Optional[str]:
    """
    安全解析相对路径，确保最终 realpath 存在且严格位于 base_dir 内部。
    防范 URL 编码绕过、大小写绕过、混合分隔符、跨驱动器、符号链接与路径穿越。
    """
    if not rel_path or not base_dir:
        return None
    try:
        # 多层 URL 解码（防二次/三次编码，如 %252e%252e%252f）
        unquoted = str(rel_path)
        for _ in range(3):
            next_u = urllib.parse.unquote(unquoted)
            if next_u == unquoted:
                break
            unquoted = next_u

        # 统一为正斜杠并去除首尾空白及左侧斜杠
        clean = unquoted.replace("\\", "/").strip().lstrip("/")

        # 拦截驱动器绝对路径及 UNC 路径 (C:/..., //host/...)
        if re.match(r"^[a-zA-Z]:", clean) or clean.startswith("//") or clean.startswith("\\\\"):
            return None

        base_real = os.path.realpath(os.path.abspath(base_dir))
        target_abs = os.path.abspath(os.path.join(base_real, clean))
        target_real = os.path.realpath(target_abs)

        # 必须是真实存在的文件
        if not os.path.isfile(target_real):
            return None

        # Windows 大小写不敏感的路径沙箱安全检查
        base_norm = base_real.lower()
        target_norm = target_real.lower()

        try:
            common = os.path.commonpath([base_norm, target_norm])
        except ValueError:
            return None

        if common != base_norm:
            return None

        # 确保 target 确实在 base_norm 的子路径下（加分隔符比对，防止前缀碰撞如 /assets-fake）
        base_prefix = base_norm if base_norm.endswith(os.sep.lower()) else base_norm + os.sep.lower()
        if not target_norm.startswith(base_prefix):
            return None

        # 确保绝不属于参考代码库
        if is_reference_path(target_real):
            return None

        return target_real
    except Exception:
        return None

def load_storage_settings() -> dict:
    config = dict(DEFAULT_STORAGE_CONFIG)
    if os.path.exists(STORAGE_SETTINGS_FILE):
        try:
            with open(STORAGE_SETTINGS_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if isinstance(saved, dict):
                    for k, v in saved.items():
                        if k in config and isinstance(v, str) and v.strip():
                            # 跨平台部署时忽略 Windows 盘符路径，避免在 Linux 下创建名为
                            # ``D:\\...`` 的伪目录；相对路径统一相对项目根目录解析。
                            if os.name != "nt" and re.match(r"^[A-Za-z]:[\\/]|^\\\\", v.strip()):
                                continue
                            if is_reference_path(v):
                                print(f"[Storage Warning] 忽略指向参考库的无效配置 {k}={v}，回退至默认正式路径")
                            else:
                                config[k] = os.path.normpath(os.path.abspath(v.strip()))
        except Exception as e:
            print(f"[Storage Warning] 读取 {STORAGE_SETTINGS_FILE} 失败: {e}")
    # 环境变量优先于文件，适用于 Docker/NAS 挂载卷，不需要改写用户原始配置文件。
    for key in config:
        env_key = f"XXPD_{key.upper()}"
        value = str(os.getenv(env_key, "")).strip()
        if not value:
            continue
        if os.name != "nt" and re.match(r"^[A-Za-z]:[\\/]|^\\\\", value):
            continue
        if is_reference_path(value):
            continue
        config[key] = os.path.normpath(os.path.abspath(value))
    return config

# 运行时全局路径指针
APP_ASSETS_DIR = DEFAULT_STORAGE_CONFIG["assets_dir"]
APP_OUTPUT_DIR = DEFAULT_STORAGE_CONFIG["output_dir"]
APP_DATA_DIR = DEFAULT_STORAGE_CONFIG["data_dir"]
APP_ASSET_LIBRARY_DIR = os.path.join(DEFAULT_STORAGE_CONFIG["assets_dir"], "library")
APP_ASSET_LIBRARY_PATH = os.path.join(DEFAULT_STORAGE_CONFIG["data_dir"], "asset_library.json")
WORKFLOWS_DIR = DEFAULT_STORAGE_CONFIG["workflow_dir"]

def apply_storage_settings(config: dict):
    data_dir = config["data_dir"]
    canvas_dir = config["canvas_dir"]
    assets_dir = config["assets_dir"]
    upload_dir = config["upload_dir"]
    input_dir = config["input_dir"]
    output_dir = config["output_dir"]
    workflow_dir = config["workflow_dir"]

    for d in [data_dir, canvas_dir, assets_dir, upload_dir, input_dir, output_dir, workflow_dir]:
        os.makedirs(d, exist_ok=True)

    derived_projects = os.path.join(data_dir, "projects.json")
    derived_asset_lib = os.path.join(data_dir, "asset_library.json")
    derived_history = os.path.join(data_dir, "history.json")
    derived_lib_dir = os.path.join(assets_dir, "library")
    derived_previews = os.path.join(data_dir, "media_previews")
    os.makedirs(derived_lib_dir, exist_ok=True)
    os.makedirs(derived_previews, exist_ok=True)

    # 1. 统一 main 模块路径（修复 LOCAL_UPLOAD_DIR 默认必须改为项目内 assets/uploads）
    main.BASE_DIR = ROOT_DIR
    main.DATA_DIR = data_dir
    main.CANVAS_DIR = canvas_dir
    main.PROJECTS_PATH = derived_projects
    main.ASSET_LIBRARY_PATH = derived_asset_lib
    main.HISTORY_FILE = derived_history
    main.WORKFLOW_DIR = workflow_dir
    main.OUTPUT_DIR = output_dir
    main.ASSETS_DIR = assets_dir
    main.OUTPUT_INPUT_DIR = input_dir
    main.OUTPUT_OUTPUT_DIR = output_dir
    main.ASSET_LIBRARY_DIR = derived_lib_dir
    main.LOCAL_UPLOAD_DIR = upload_dir
    # 静态资源以项目根 static/ 为编辑与运行时唯一真源（server 入口 / Docker CMD 均走此处）。
    # runtime_core/static retired; public /static SoT is project-root static/.
    main.STATIC_DIR = os.path.join(ROOT_DIR, "static")
    main.STATIC_RUNNINGHUB_DIR = os.path.join(main.STATIC_DIR, "runninghub")
    main.STATIC_RUNNINGHUB_THUMBNAIL_DIR = os.path.join(main.STATIC_RUNNINGHUB_DIR, "thumbnails")
    main.STATIC_RUNNINGHUB_API_PROVIDERS_FILE = os.path.join(main.STATIC_RUNNINGHUB_DIR, "api_providers.json")
    main.STATIC_RUNNINGHUB_MODEL_REGISTRY_FILE = os.path.join(main.STATIC_RUNNINGHUB_DIR, "models_registry.json")
    main.MEDIA_PREVIEW_DIR = derived_previews
    main.CLI_SETTINGS_FILE = os.path.join(data_dir, "cli_settings.json")
    # API 密钥文件与提示词库同属 import 期常量：不在此重绑，密钥就会继续写进 runtime_core/API/.env 旧路径。
    main.API_ENV_FILE = os.path.join(data_dir, "api.env")
    if hasattr(main, "apply_cli_settings"):
        main.apply_cli_settings()

    # 2. 同步更新 xxdp_core_config
    try:
        import app.core.config as xxdp_core_config
        xxdp_core_config.BASE_DIR = ROOT_DIR
        xxdp_core_config.DATA_DIR = data_dir
        xxdp_core_config.CANVAS_DIR = canvas_dir
        xxdp_core_config.PROJECTS_PATH = derived_projects
        xxdp_core_config.ASSET_LIBRARY_PATH = derived_asset_lib
        xxdp_core_config.HISTORY_FILE = derived_history
        xxdp_core_config.API_ENV_FILE = os.path.join(data_dir, "api.env")
        xxdp_core_config.CLI_SETTINGS_FILE = os.path.join(data_dir, "cli_settings.json")
        xxdp_core_config.WORKFLOW_DIR = workflow_dir
        xxdp_core_config.OUTPUT_DIR = output_dir
        xxdp_core_config.ASSETS_DIR = assets_dir
        xxdp_core_config.OUTPUT_INPUT_DIR = input_dir
        xxdp_core_config.OUTPUT_OUTPUT_DIR = output_dir
        xxdp_core_config.ASSET_LIBRARY_DIR = derived_lib_dir
        xxdp_core_config.LOCAL_UPLOAD_DIR = upload_dir
        xxdp_core_config.MEDIA_PREVIEW_DIR = derived_previews
        xxdp_core_config.STATIC_DIR = main.STATIC_DIR
        xxdp_core_config.STATIC_RUNNINGHUB_DIR = main.STATIC_RUNNINGHUB_DIR
        xxdp_core_config.STATIC_RUNNINGHUB_THUMBNAIL_DIR = main.STATIC_RUNNINGHUB_THUMBNAIL_DIR
        xxdp_core_config.STATIC_RUNNINGHUB_API_PROVIDERS_FILE = main.STATIC_RUNNINGHUB_API_PROVIDERS_FILE
        xxdp_core_config.STATIC_RUNNINGHUB_MODEL_REGISTRY_FILE = main.STATIC_RUNNINGHUB_MODEL_REGISTRY_FILE
    except Exception as exc:
        print(f"[Storage] 同步 xxdp_core_config 路径失败: {exc}")

    # 3. 同步更新 storage_service
    try:
        import app.services.storage_service as xxdp_storage_service
        xxdp_storage_service.CANVAS_DIR = canvas_dir
        xxdp_storage_service.PROJECTS_PATH = derived_projects
        xxdp_storage_service.HISTORY_FILE = derived_history
    except Exception as exc:
        print(f"[Storage] 同步 storage_service 路径失败: {exc}")

    # 4. 同步更新 canvases_router
    try:
        import app.routers.canvases as xxdp_canvases_router
        xxdp_canvases_router.CANVAS_DIR = canvas_dir
    except Exception as exc:
        print(f"[Storage] 同步 canvases_router 路径失败: {exc}")

    # 局域网模块在导入时缓存了目录常量；切换到 NAS/Docker 数据卷时同步更新，
    # 避免协作数据继续写入 runtime_core/data 的旧目录。
    try:
        import app.services.lan_storage_service as lan_storage
        lan_storage.LAN_DATA_DIR = os.path.abspath(os.path.join(data_dir, "lan"))
        lan_storage.LAN_ASSETS_DIR = os.path.abspath(os.path.join(assets_dir, "lan"))
        lan_storage.LAN_CANVAS_PATH = os.path.join(lan_storage.LAN_DATA_DIR, "canvas.json")
        lan_storage.LAN_OP_LOG_PATH = os.path.join(lan_storage.LAN_DATA_DIR, "op_log.jsonl")
        lan_storage.LAN_SYNC_STATE_PATH = os.path.join(lan_storage.LAN_DATA_DIR, "sync_state.json")
        lan_storage.LAN_AUTH_PATH = os.path.join(lan_storage.LAN_DATA_DIR, "auth.json")
        lan_storage.LAN_DEVICE_PATH = os.path.join(lan_storage.LAN_DATA_DIR, "device.json")
        lan_storage.LAN_TOMBSTONES_PATH = os.path.join(lan_storage.LAN_DATA_DIR, "tombstones.json")
        lan_storage.LAN_ASSETS_REGISTRY_PATH = os.path.join(lan_storage.LAN_DATA_DIR, "assets_registry.json")
        lan_storage.LAN_CHECKPOINT_PATH = os.path.join(lan_storage.LAN_DATA_DIR, "checkpoint.json")
        os.makedirs(lan_storage.LAN_DATA_DIR, exist_ok=True)
        os.makedirs(lan_storage.LAN_ASSETS_DIR, exist_ok=True)
        import app.core.lan_auth as lan_auth
        lan_auth.LAN_DATA_DIR = lan_storage.LAN_DATA_DIR
        lan_auth.DEVICE_FILE = os.path.join(lan_storage.LAN_DATA_DIR, "device.json")
        lan_auth.AUTH_FILE = os.path.join(lan_storage.LAN_DATA_DIR, "auth.json")
        os.makedirs(lan_auth.LAN_DATA_DIR, exist_ok=True)
    except Exception as exc:
        print(f"[Storage] 同步局域网存储路径失败: {exc}")

    # 5. 同步更新 history_router
    try:
        import app.routers.history as xxdp_history_router
        xxdp_history_router.HISTORY_FILE = derived_history
    except Exception as exc:
        print(f"[Storage] 同步 history_router 路径失败: {exc}")

    # 6. 同步更新 canvas_api_scope_service
    try:
        import app.services.canvas_api_scope_service as xxdp_scope_service
        xxdp_scope_service.CANVAS_API_SCOPES_FILE = os.path.join(data_dir, "canvas_api_scopes.json")
    except Exception as exc:
        print(f"[Storage] 同步 canvas_api_scope_service 路径失败: {exc}")

    # 7. 同步 server.py 全局引用
    global APP_ASSETS_DIR, APP_OUTPUT_DIR, APP_DATA_DIR, APP_ASSET_LIBRARY_DIR, APP_ASSET_LIBRARY_PATH, WORKFLOWS_DIR
    APP_ASSETS_DIR = assets_dir
    APP_OUTPUT_DIR = output_dir
    APP_DATA_DIR = data_dir
    APP_ASSET_LIBRARY_DIR = derived_lib_dir
    APP_ASSET_LIBRARY_PATH = derived_asset_lib
    WORKFLOWS_DIR = workflow_dir

def save_storage_settings(new_config: dict) -> dict:
    validated = {}
    for k in DEFAULT_STORAGE_CONFIG.keys():
        val = new_config.get(k)
        if not val or not isinstance(val, str) or not val.strip():
            val = DEFAULT_STORAGE_CONFIG[k]
        val = os.path.normpath(os.path.abspath(val.strip()))
        if is_reference_path(val):
            raise ValueError(f"严禁将存储路径指向运行核心目录 (runtime_core): {val}")
        if os.path.exists(val) and os.path.isfile(val):
            raise ValueError(f"目标存储路径是文件而非目录: {val}")
        if not os.path.exists(val):
            try:
                os.makedirs(val, exist_ok=True)
            except Exception as e:
                raise ValueError(f"无法安全创建目标存储目录 {val}: {e}")
        validated[k] = val

    os.makedirs(os.path.dirname(STORAGE_SETTINGS_FILE), exist_ok=True)
    temp_file = f"{STORAGE_SETTINGS_FILE}.tmp.{uuid.uuid4().hex}"
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(validated, f, ensure_ascii=False, indent=2)
    os.replace(temp_file, STORAGE_SETTINGS_FILE)

    apply_storage_settings(validated)
    return validated

# 启动时加载并应用配置
CURRENT_STORAGE_CONFIG = load_storage_settings()
apply_storage_settings(CURRENT_STORAGE_CONFIG)
if not os.path.exists(STORAGE_SETTINGS_FILE):
    try:
        with open(STORAGE_SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(CURRENT_STORAGE_CONFIG, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[Storage Init Note] {e}")


# 如果小小办公本地 asset_library.json 尚不存在，初始化包含真实基础素材的标准库
if False and not os.path.exists(APP_ASSET_LIBRARY_PATH):
    default_lib = {
        "active_library_id": "default",
        "libraries": [
            {
                "id": "default",
                "name": "默认资产库",
                "type": "asset",
                "categories": [
                    {
                        "id": "characters",
                        "name": "角色",
                        "type": "image",
                        "items": [
                            {
                                "id": "asset_sample_fashion_autumn",
                                "name": "秋季时装模特",
                                "url": "/assets/sample_autumn_fashion.jpg",
                                "thumbnail": "/assets/sample_autumn_fashion.jpg",
                                "kind": "image",
                                "natural_w": 1024,
                                "natural_h": 1024,
                                "created_at": int(time.time() * 1000)
                            }
                        ],
                        "dir": "角色"
                    },
                    {
                        "id": "scenes",
                        "name": "场景与动态",
                        "type": "image",
                        "items": [
                            {
                                "id": "asset_sample_fashion_walk",
                                "name": "时装周模特步态",
                                "url": "/assets/sample_fashion_walk.mp4",
                                "thumbnail": "/assets/sample_fashion_walk_poster.jpg",
                                "kind": "video",
                                "duration": 5,
                                "created_at": int(time.time() * 1000)
                            }
                        ],
                        "dir": "场景与动态"
                    },
                    {
                        "id": "workflows",
                        "name": "工作流",
                        "type": "workflow",
                        "items": []
                    }
                ]
            }
        ]
    }
    with open(APP_ASSET_LIBRARY_PATH, "w", encoding="utf-8") as f:
        json.dump(default_lib, f, ensure_ascii=False, indent=2)

# 自定义 output_file_from_url，优先安全定位小小办公本地资产目录
_orig_output_file_from_url = main.output_file_from_url
def custom_output_file_from_url(url):
    if not url:
        return None
    res = _orig_output_file_from_url(url)
    if res and os.path.exists(res):
        abs_res = os.path.abspath(res)
        valid_roots = [APP_ASSETS_DIR, APP_OUTPUT_DIR]
        if hasattr(main, "OUTPUT_DIR") and main.OUTPUT_DIR:
            valid_roots.append(main.OUTPUT_DIR)
        if hasattr(main, "ASSETS_DIR") and main.ASSETS_DIR:
            valid_roots.append(main.ASSETS_DIR)
        for root in valid_roots:
            try:
                abs_root = os.path.abspath(root)
                if os.path.commonpath([abs_root, abs_res]) == abs_root:
                    return abs_res
            except Exception:
                pass
    clean = urllib.parse.unquote(str(url).split("?", 1)[0]).replace("\\", "/")
    if clean.startswith(("http://", "https://")):
        try:
            parsed = urllib.parse.urlsplit(clean)
            clean = parsed.path or ""
        except Exception:
            pass
    if clean.startswith("/assets/"):
        rel = clean[len("/assets/"):].lstrip("/")
        return resolve_safe_file(APP_ASSETS_DIR, rel) or resolve_safe_file(APP_OUTPUT_DIR, rel)
    elif clean.startswith("/output/"):
        rel = clean[len("/output/"):].lstrip("/")
        return (
            resolve_safe_file(APP_OUTPUT_DIR, rel)
            or resolve_safe_file(os.path.join(APP_ASSETS_DIR, "output"), rel)
            or resolve_safe_file(APP_ASSETS_DIR, rel)
        )
    return None
main.output_file_from_url = custom_output_file_from_url

# 零付费 API 安全保障：素材入库时不触发任何消耗性后台打标 API
async def safe_classify_asset_image_best_effort(abs_path, provider_id="", model="", ms_model="", prompt=""):
    return None
main.classify_asset_image_best_effort = safe_classify_asset_image_best_effort


from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, UploadFile, File, APIRouter, Header
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
import uvicorn
from pydantic import BaseModel
import app.auth_service as auth_service
from app.auth_service import login as auth_login, logout as auth_logout, user_from_token, LoginDenied, issue_local_host_session

PORT = int(os.getenv("PORT", "8900"))
HOST = os.getenv("HOST", "127.0.0.1")
LAN_PORT = int(os.getenv("LAN_PORT", str(PORT + 10)))
LAN_HOST = os.getenv("LAN_HOST", "0.0.0.0")
# 云端/ NAS 常驻模式：桌面版的心跳 watchdog 不应在无浏览器窗口时退出服务。
SERVER_MODE = str(os.getenv("SERVER_MODE", "desktop")).strip().lower()
PUBLIC_DEPLOYMENT = str(os.getenv("PUBLIC_DEPLOYMENT", "0")).strip().lower() in {"1", "true", "yes", "on"}
ADMIN_ACCESS_KEY = str(os.getenv("XXPD_ADMIN_ACCESS_KEY", "")).strip()

# FastAPI on_event 已弃用：用 lifespan 统一串联 auth 与 core+LAN 启停（回调按注册顺序执行）。
_app_startup_callbacks = []
_app_shutdown_callbacks = []

# 局域网服务状态供健康探针和启动日志使用。
_lan_ready = False
_lan_error = ""
_loop_exception_handlers = {}


def _install_connection_reset_handler():
    """安静处理 Windows 客户端主动断开产生的 Proactor 连接重置。"""
    try:
        loop = asyncio.get_running_loop()
        previous = loop.get_exception_handler()

        def handle_exception(current_loop, context):
            exc = context.get("exception")
            if isinstance(exc, ConnectionResetError) or (
                isinstance(exc, OSError) and getattr(exc, "winerror", None) == 10054
            ):
                return
            if previous is not None:
                previous(current_loop, context)
            else:
                current_loop.default_exception_handler(context)

        _loop_exception_handlers[id(loop)] = (loop, previous)
        loop.set_exception_handler(handle_exception)
    except Exception:
        pass


def _restore_connection_reset_handler():
    try:
        loop = asyncio.get_running_loop()
        handler_entry = _loop_exception_handlers.pop(id(loop), None)
        if handler_entry:
            _, previous = handler_entry
            loop.set_exception_handler(previous)
    except Exception:
        pass

@asynccontextmanager
async def app_lifespan(_app: FastAPI):
    _install_connection_reset_handler()
    for cb in _app_startup_callbacks:
        result = cb()
        if inspect.isawaitable(result):
            await result
    try:
        yield
    finally:
        for cb in _app_shutdown_callbacks:
            result = cb()
            if inspect.isawaitable(result):
                await result
        _restore_connection_reset_handler()

app = FastAPI(title="小小办公 - 桌面端服务", docs_url=None, redoc_url=None, lifespan=app_lifespan)


def _request_user(request: Request):
    """从 Bearer 会话或部署专用管理密钥解析用户。"""
    authorization = request.headers.get("authorization", "")
    token = authorization.split(" ", 1)[1].strip() if authorization.lower().startswith("bearer ") else ""
    user = user_from_token(token) if token else None
    if user:
        return user
    if ADMIN_ACCESS_KEY and secrets.compare_digest(request.headers.get("x-xxpd-admin-key", ""), ADMIN_ACCESS_KEY):
        return {"id": "env-admin", "username": "env-admin", "role": "master", "status": "active"}
    if not PUBLIC_DEPLOYMENT and _is_local_client(request):
        return {"id": "local-host", "username": "local-host", "role": "master", "status": "active", "access_mode": "host"}
    return None


# 仅保护会泄露密钥、修改系统或执行外部命令的高风险接口；普通画布读写保持现有桌面客户端兼容。
_PUBLIC_AUTH_PATHS = {
    "/api/auth/login", "/api/auth/me", "/api/auth/logout", "/api/auth/local-host",
    "/api/auth/status", "/api/auth/setup", "/api/health",
}


@app.middleware("http")
async def public_admin_guard(request: Request, call_next):
    # 公网部署默认保护全部业务 API 和用户文件，仅保留认证、健康探针及公开配置读取。
    request_user = _request_user(request)
    account_context = main.set_current_account((request_user or {}).get("id", ""))
    try:
        path = request.url.path
        read_only_exempt = request.method == "GET" and path.startswith(("/api/providers", "/api/config"))
        public_exempt = path in _PUBLIC_AUTH_PATHS or path == "/static/auth.html" or read_only_exempt
        protected_resource = path.startswith(("/api/", "/assets/", "/output/"))
        if PUBLIC_DEPLOYMENT and request.method != "OPTIONS" and protected_resource and not public_exempt and request_user is None:
            return JSONResponse(status_code=401, content={"detail": "需要登录后访问"})
        return await call_next(request)
    finally:
        main.reset_current_account(account_context)


def _auth_user_from_request(authorization: Optional[str]) -> Optional[Dict[str, Any]]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return user_from_token(authorization.split(" ", 1)[1].strip())


def _require_master(authorization: Optional[str], access_key: Optional[str] = None) -> Dict[str, Any]:
    user = _auth_user_from_request(authorization)
    if not user and ADMIN_ACCESS_KEY and access_key and secrets.compare_digest(access_key, ADMIN_ACCESS_KEY):
        return {"id": "env-admin", "username": "env-admin", "role": "master", "status": "active"}
    if not user or user.get("role") != "master":
        raise HTTPException(status_code=403, detail="需要主账号权限")
    return user

class AuthLoginPayload(BaseModel):
    username: str
    password: str

async def initialize_auth_store():
    # 账号文件跟随正式数据目录；本机主机使用内存免登录身份，不再初始化主账号。
    auth_service.AUTH_FILE = os.path.join(APP_DATA_DIR, "auth_users.json")
    auth_service.migrate_legacy_password_fields()

_app_startup_callbacks.append(initialize_auth_store)



def _is_local_client(request: Request) -> bool:
    """仅本机回环地址可申请主机免登会话。"""
    host = (request.client.host if request.client else "") or ""
    return host in {"127.0.0.1", "::1", "localhost"}


@app.post("/api/auth/setup")
async def auth_setup_endpoint(payload: AuthLoginPayload):
    """主机使用本机免登录身份，不再提供主账号初始化。"""
    raise HTTPException(status_code=410, detail="本机主机不需要创建主账号")


@app.get("/api/auth/status")
async def auth_status_endpoint(request: Request):
    return {
        "setupRequired": False,
        "localHostAvailable": _is_local_client(request),
        "hasMaster": True,
    }


class LocalHostPayload(BaseModel):
    displayName: Optional[str] = ""


@app.post("/api/auth/local-host")
async def auth_local_host_endpoint(request: Request, payload: LocalHostPayload = LocalHostPayload()):
    """本机主机免登：签发主会话，不再需要登录墙。"""
    if not _is_local_client(request):
        raise HTTPException(status_code=403, detail="仅本机可使用主机免登")
    try:
        return issue_local_host_session(payload.displayName or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/auth/login")
async def auth_login_endpoint(payload: AuthLoginPayload):
    try:
        return auth_login(payload.username.strip(), payload.password)
    except LoginDenied as exc:
        raise HTTPException(status_code=401, detail=exc.detail)


@app.get("/api/auth/me")
async def auth_me_endpoint(authorization: Optional[str] = Header(default=None)):
    token = authorization.split(" ", 1)[1] if authorization and authorization.lower().startswith("bearer ") else None
    user = user_from_token(token)
    if not user: raise HTTPException(status_code=401, detail="未登录或会话已过期")
    public = {
        "id": user.get("id"),
        "username": user.get("username"),
        "displayName": user.get("display_name") or user.get("displayName") or user.get("username"),
        "avatar": user.get("avatar") or "",
        "role": user.get("role", "member"),
        "status": user.get("status", "active"),
        "accessMode": str(user.get("access_mode") or ("host" if user.get("role") == "master" else "lan")),
    }
    return {"user": public}


@app.post("/api/auth/heartbeat")
async def auth_heartbeat_endpoint(authorization: Optional[str] = Header(default=None)):
    """刷新当前账号在线状态；不会延长会话的绝对过期时间。"""
    token = authorization.split(" ", 1)[1].strip() if authorization and authorization.lower().startswith("bearer ") else None
    try:
        return {"ok": True, **auth_service.heartbeat(token)}
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

@app.post("/api/auth/logout")
async def auth_logout_endpoint(authorization: Optional[str] = Header(default=None)):
    token = authorization.split(" ", 1)[1] if authorization and authorization.lower().startswith("bearer ") else None
    auth_logout(token)
    return {"ok": True}


LOCAL_ORIGIN_REGEX = r"^http://(127\.0\.0\.1|localhost)(:\d+)?$"
_allowed_origins = [item.strip() for item in os.getenv("XXPD_ALLOWED_ORIGINS", "").split(",") if item.strip()]

# 允许跨域与标准头配置（严格收敛至本机桌面合法 Origin，防范恶意网页跨站攻击）
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=LOCAL_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1024)

# 敏感本地写接口来源防御中间件
@app.middleware("http")
async def security_origin_check(request: Request, call_next):
    if request.url.path.startswith("/api/storage/"):
        origin = request.headers.get("origin")
        if origin and origin not in _allowed_origins and not re.match(LOCAL_ORIGIN_REGEX, origin):
            return JSONResponse(status_code=403, content={"detail": "禁止跨站调用敏感存储接口"})
    return await call_next(request)

# 禁用开发预览缓存中间件
@app.middleware("http")
async def add_no_cache_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# ================= 首页与 HTML 路由 =================

@app.get("/")
async def root():
    index_path = os.path.join(ROOT_DIR, "index.html")
    return FileResponse(index_path, media_type="text/html; charset=utf-8")

@app.get("/index.html")
async def index_page():
    index_path = os.path.join(ROOT_DIR, "index.html")
    return FileResponse(index_path, media_type="text/html; charset=utf-8")

# ================= 桌面应用客户端生命周期管理与长任务/协作感知 =================
VIDEO_TASKS: Dict[str, Dict[str, Any]] = {}
VIDEO_TASK_LOCK = threading.Lock()
ACTIVE_ASYNC_TASKS: Dict[str, Any] = {}

ACTIVE_CLIENTS: Dict[str, float] = {}
_SHUTDOWN_TIMER: Optional[threading.Timer] = None
_STARTUP_TIMESTAMP = time.time()
_HAS_HAD_CLIENT = False
_LIFECYCLE_LOCK = threading.Lock()

def get_active_work_status() -> Dict[str, Any]:
    """活跃工作状态感知：
    1. 检查 VIDEO_TASKS 中 status 为 "queued" 或 "running" 的视频任务；
    2. 检查 main.CANVAS_TASKS 中 status 为 "queued" 或 "running" 的图片/ComfyUI 任务（需在 main.CANVAS_TASK_LOCK 保护下读取）；
    3. 检查 main.QUEUE 队列长度（在 main.QUEUE_LOCK 保护下读取）；
    4. 检查 lan_manager 的活跃房间及在线成员（通过 lan_manager.active_room 是否为 open 以及是否有活跃的协同成员）。
    """
    active_video_tasks: List[str] = []
    try:
        with VIDEO_TASK_LOCK:
            for tid, t in VIDEO_TASKS.items():
                if isinstance(t, dict) and t.get("status") in ("queued", "running"):
                    active_video_tasks.append(tid)
    except Exception as e:
        print(f"[App Lifecycle] 读取 VIDEO_TASKS 异常: {e}")

    active_canvas_tasks: List[str] = []
    try:
        if hasattr(main, "CANVAS_TASKS") and hasattr(main, "CANVAS_TASK_LOCK"):
            with main.CANVAS_TASK_LOCK:
                for tid, t in main.CANVAS_TASKS.items():
                    if isinstance(t, dict) and t.get("status") in ("queued", "running"):
                        active_canvas_tasks.append(tid)
    except Exception as e:
        print(f"[App Lifecycle] 读取 main.CANVAS_TASKS 异常: {e}")

    queue_length: int = 0
    try:
        if hasattr(main, "QUEUE") and hasattr(main, "QUEUE_LOCK"):
            with main.QUEUE_LOCK:
                queue_length = len(main.QUEUE)
    except Exception as e:
        print(f"[App Lifecycle] 读取 main.QUEUE 异常: {e}")

    active_room_open: bool = False
    active_room_id: str = ""
    active_collab_members: List[Dict[str, Any]] = []
    try:
        if "lan_manager" in globals() and lan_manager is not None:
            with lan_manager._lock:
                room = lan_manager.active_room
                if room and getattr(room, "status", "") == "open":
                    active_room_open = True
                    active_room_id = getattr(room, "room_id", "")
                    now_sec = time.time()
                    host_id = getattr(room, "host_member_id", "")
                    active_session_mids = {
                        s.member_id for s in getattr(room, "sessions", {}).values()
                        if getattr(s, "member_id", "") != host_id and (now_sec - getattr(s, "last_seen", 0.0) < 30.0)
                    }
                    for mid, m in getattr(room, "members", {}).items():
                        is_host = getattr(m, "is_host", False) or (mid == host_id)
                        is_online = getattr(m, "online", False)
                        last_seen = getattr(m, "last_seen", 0.0)
                        if not is_host and ((is_online and (now_sec - last_seen < 30.0)) or (mid in active_session_mids)):
                            active_collab_members.append({
                                "member_id": mid,
                                "display_name": getattr(m, "display_name", mid),
                                "last_seen": last_seen,
                            })
    except Exception as e:
        print(f"[App Lifecycle] 读取 lan_manager 状态异常: {e}")

    has_active_collab = active_room_open and (len(active_collab_members) > 0)
    has_active_work = bool(
        active_video_tasks or active_canvas_tasks or (queue_length > 0) or has_active_collab
    )

    summary_parts = []
    if active_video_tasks:
        summary_parts.append(f"{len(active_video_tasks)}个视频任务进行中")
    if active_canvas_tasks:
        summary_parts.append(f"{len(active_canvas_tasks)}个图片/ComfyUI任务进行中")
    if queue_length > 0:
        summary_parts.append(f"{queue_length}个全局任务排队中")
    if has_active_collab:
        summary_parts.append(f"局域网房间在线协同成员{len(active_collab_members)}人")
    summary = "; ".join(summary_parts) if summary_parts else "无活跃任务"

    return {
        "has_active_work": has_active_work,
        "summary": summary,
        "video_tasks": {
            "active_count": len(active_video_tasks),
            "task_ids": active_video_tasks,
        },
        "canvas_tasks": {
            "active_count": len(active_canvas_tasks),
            "task_ids": active_canvas_tasks,
        },
        "queue": {
            "length": queue_length,
        },
        "lan_collab": {
            "room_open": active_room_open,
            "room_id": active_room_id,
            "active_collab_members_count": len(active_collab_members),
            "members": active_collab_members,
        },
    }

def _schedule_shutdown(delay: float = 15.0):
    global _SHUTDOWN_TIMER
    if SERVER_MODE == "server":
        return
    with _LIFECYCLE_LOCK:
        if _SHUTDOWN_TIMER is not None:
            _SHUTDOWN_TIMER.cancel()
        def _exit_action():
            now = time.time()
            alive = {cid: t for cid, t in ACTIVE_CLIENTS.items() if now - t < 30.0}
            if not alive:
                work_status = get_active_work_status()
                if work_status.get("has_active_work"):
                    print(f"[App Lifecycle] 检测到所有桌面客户端窗口已断开，但后台仍有活跃任务进行中 ({work_status.get('summary', '')})，暂不退出，自动延迟15秒后重新检查。")
                    _schedule_shutdown(delay=45.0)
                    return
                print("[App Lifecycle] 检测到所有桌面客户端窗口已关闭且无活跃任务，自动退出后台进程。")
                os._exit(0)
        _SHUTDOWN_TIMER = threading.Timer(delay, _exit_action)
        _SHUTDOWN_TIMER.daemon = True
        _SHUTDOWN_TIMER.start()

def _cancel_scheduled_shutdown():
    global _SHUTDOWN_TIMER
    with _LIFECYCLE_LOCK:
        if _SHUTDOWN_TIMER is not None:
            _SHUTDOWN_TIMER.cancel()
            _SHUTDOWN_TIMER = None

@app.get("/api/health")
async def api_health():
    """轻量服务身份识别与健康探针端点 (供启动器做身份识别探针与任务监测)"""
    work_status = get_active_work_status()
    return {
        "status": "ok",
        "app": "xxpd",
        "name": "小小办公",
        "version": main.current_app_version(),
        "instance_id": APP_INSTANCE_ID,
        "lan_ready": bool(_lan_ready),
        "lan_port": LAN_PORT,
        "lan_error": _lan_error,
        "has_active_work": bool(work_status.get("has_active_work", False)),
        "active_work": work_status,
        "timestamp": time.time(),
    }

@app.post("/api/app/heartbeat")
async def app_heartbeat(client_id: str = ""):
    global _HAS_HAD_CLIENT
    cid = client_id or "default"
    with _LIFECYCLE_LOCK:
        ACTIVE_CLIENTS[cid] = time.time()
        _HAS_HAD_CLIENT = True
    _cancel_scheduled_shutdown()
    return {"ok": True}

@app.post("/api/app/client-closed")
async def app_client_closed(client_id: str = ""):
    if SERVER_MODE == "server":
        return {"ok": True, "persistent": True}
    cid = client_id or "default"
    with _LIFECYCLE_LOCK:
        ACTIVE_CLIENTS.pop(cid, None)
        now = time.time()
        alive = {k: v for k, v in ACTIVE_CLIENTS.items() if now - v < 300.0}
    # 仅当明确是桌面程序外壳 (desktop_shell) 关闭且无其他客户端时，才触发退出倒计时
    if not alive and cid == "desktop_shell":
        try:
            if lan_manager.active_room and lan_manager.active_room.status == "open":
                lan_manager.close_room()
        except Exception as exc:
            print(f"[App Lifecycle] 关闭主机 LAN 房间失败: {exc}")
        _schedule_shutdown(delay=15.0)
    return {"ok": True}

def _lifecycle_watchdog():
    """守护线程：防止僵尸常驻，若所有客户端窗口断开超阈值且无活跃任务则退出"""
    _last_log_time = 0.0
    # 延长闲置超时至 30 分钟 (1800秒)，彻底杜绝窗口最小化、锁屏或离开电脑时的误退出现象
    IDLE_TIMEOUT = 1800.0
    while True:
        time.sleep(10)
        now = time.time()
        with _LIFECYCLE_LOCK:
            had_client = _HAS_HAD_CLIENT
            alive = {k: v for k, v in ACTIVE_CLIENTS.items() if now - v < IDLE_TIMEOUT}
            has_timer = _SHUTDOWN_TIMER is not None
        
        # 若从未有客户端接入，给予 30 分钟启动缓冲期
        if not had_client:
            if now - _STARTUP_TIMESTAMP > IDLE_TIMEOUT:
                work_status = get_active_work_status()
                if work_status.get("has_active_work"):
                    continue
                print("[App Lifecycle Watchdog] 启动后未检测到任何客户端窗口且无活跃任务，退出后台。")
                os._exit(0)
            continue

        # 曾有客户端接入，但所有客户端心跳断开超 30 分钟且无待决定时器
        if not alive and not has_timer:
            work_status = get_active_work_status()
            if work_status.get("has_active_work"):
                if now - _last_log_time > 60.0:
                    _last_log_time = now
                    print(f"[App Lifecycle Watchdog] 所有客户端窗口已关闭超超时阈值，但后台仍有活跃任务 ({work_status.get('summary', '')})，继续保持守护不退出。")
                _schedule_shutdown(delay=60.0)
                continue
            print(f"[App Lifecycle Watchdog] 所有客户端窗口已静默断开超过 {int(IDLE_TIMEOUT // 60)} 分钟且无活跃任务，自动安全退出。")
            os._exit(0)

# 云端/NAS 常驻服务不应因没有桌面窗口而自动退出。
if SERVER_MODE != "server":
    threading.Thread(target=_lifecycle_watchdog, daemon=True).start()

# ================= AI 配置与供应商读取 (复用 XXDP 成熟机制) =================

@app.get("/api/config")
async def get_config(request: Request, scope_id: str = ""):
    """读取用户 AI 配置、已配置平台及当前可用模型 (含图片与视频模型)"""
    return await main.ai_config(scope_id=scope_id)

@app.get("/api/providers")
async def get_providers():
    """读取平台列表与可用状态"""
    return await main.api_providers()

@app.get("/api/canvas-api-settings")
async def get_canvas_api_settings_endpoint(mode: str = "personal", canvas_id: str = "default"):
    """读取指定作用域的 API 平台与默认模型配置"""
    return main.canvas_api_scope_response(mode, canvas_id)

@app.get("/api/canvas-api-settings/export")
async def export_canvas_api_settings_endpoint(mode: str = "personal", canvas_id: str = "default"):
    """导出指定作用域的 API 平台与密钥全量配置"""
    return main.export_canvas_api_settings(mode, canvas_id)

@app.put("/api/canvas-api-settings")
@app.post("/api/canvas-api-settings")
async def save_canvas_api_settings_endpoint(payload: main.CanvasApiScopePayload):
    """保存指定作用域的 API 平台全量配置"""
    return await main.save_canvas_api_settings(payload)

@app.patch("/api/canvas-api-settings/defaults")
async def patch_canvas_api_defaults_endpoint(payload: main.CanvasApiDefaultsPatchPayload):
    """增量更新默认平台与默认模型绑定"""
    return await main.patch_canvas_api_defaults(payload)

# ================= AI 图片生成核心 API 路由 (复用 XXDP 成熟机制) =================

@app.post("/api/canvas-image-tasks")
async def create_canvas_image_task(payload: main.OnlineImageRequest, request: Request):
    """创建异步图片生成任务 (Task 队列与后台生成)"""
    result = await main.create_canvas_image_task(payload)
    return result

@app.get("/api/canvas-image-tasks/{task_id}")
async def get_canvas_image_task(task_id: str, request: Request):
    """轮询查询图片生成任务状态与结果"""
    with main.CANVAS_TASK_LOCK:
        task = dict(main.CANVAS_TASKS.get(task_id) or {})
    return await main.get_canvas_image_task(task_id)

@app.post("/api/canvas-image-tasks/{task_id}/cancel")
async def cancel_canvas_image_task(task_id: str, request: Request):
    """取消图片生成任务"""
    with main.CANVAS_TASK_LOCK:
        task = dict(main.CANVAS_TASKS.get(task_id) or {})
    return await main.cancel_canvas_image_task(task_id)

ALLOW_PAID_VIDEO_API = os.getenv("ALLOW_PAID_VIDEO_API", "false").lower() == "true"

# VIDEO_TASKS, VIDEO_TASK_LOCK, ACTIVE_ASYNC_TASKS 已在生命周期感知模块前统一定义

class CanvasVideoTaskRequest(main.CanvasVideoRequest):
    test_mode: bool = False

async def run_simulated_video_task(task_id: str, payload: CanvasVideoTaskRequest):
    """开发测试模式：模拟真实生成任务的生命周期流转与真实进度反馈，严格不发起任何收费请求"""
    try:
        # 1. 初始化
        await asyncio.sleep(0.5)
        with VIDEO_TASK_LOCK:
            if task_id not in VIDEO_TASKS or VIDEO_TASKS[task_id]["status"] == "cancelled":
                return
            VIDEO_TASKS[task_id]["started_at"] = time.time()
            VIDEO_TASKS[task_id]["status"] = "running"
            VIDEO_TASKS[task_id]["progress"] = 25
            VIDEO_TASKS[task_id]["progress_text"] = "初始化生成环境..."
            VIDEO_TASKS[task_id]["updated_at"] = time.time()

        # 2. 帧序列合成
        await asyncio.sleep(0.8)
        with VIDEO_TASK_LOCK:
            if task_id not in VIDEO_TASKS or VIDEO_TASKS[task_id]["status"] == "cancelled":
                return
            VIDEO_TASKS[task_id]["progress"] = 50
            VIDEO_TASKS[task_id]["progress_text"] = "正在合成视频帧序列..."
            VIDEO_TASKS[task_id]["updated_at"] = time.time()

        # 3. 渲染画质与音频
        await asyncio.sleep(0.8)
        with VIDEO_TASK_LOCK:
            if task_id not in VIDEO_TASKS or VIDEO_TASKS[task_id]["status"] == "cancelled":
                return
            VIDEO_TASKS[task_id]["progress"] = 75
            VIDEO_TASKS[task_id]["progress_text"] = "正在渲染高清画质与音频..."
            VIDEO_TASKS[task_id]["updated_at"] = time.time()

        # 4. 生成完成
        await asyncio.sleep(0.6)
        with VIDEO_TASK_LOCK:
            if task_id not in VIDEO_TASKS or VIDEO_TASKS[task_id]["status"] == "cancelled":
                return
            VIDEO_TASKS[task_id]["status"] = "succeeded"
            VIDEO_TASKS[task_id]["progress"] = 100
            VIDEO_TASKS[task_id]["progress_text"] = "视频生成完成"
            VIDEO_TASKS[task_id]["result"] = {
                "videos": ["/assets/sample_fashion_walk.webm", "/assets/sample_fashion_walk.mp4"],
                "video_url": "/assets/sample_fashion_walk.mp4",
                "thumbnail": "/assets/sample_fashion_walk_poster.jpg",
                "task_id": task_id,
                "is_test_mode": True,
                "duration": payload.duration or 5,
                "aspect_ratio": payload.aspect_ratio or "16:9",
                "model": payload.model or "doubao-seedance-2-5-260628"
            }
            VIDEO_TASKS[task_id]["finished_at"] = time.time()
            VIDEO_TASKS[task_id]["completed_at"] = VIDEO_TASKS[task_id]["finished_at"]
            VIDEO_TASKS[task_id]["updated_at"] = time.time()
    except Exception as e:
        with VIDEO_TASK_LOCK:
            if task_id in VIDEO_TASKS:
                VIDEO_TASKS[task_id]["status"] = "failed"
                VIDEO_TASKS[task_id]["error"] = str(e)
                VIDEO_TASKS[task_id]["updated_at"] = time.time()

async def run_real_video_task(task_id: str, payload: CanvasVideoTaskRequest):
    """真实视频生成任务：直接调度 XXDP 成熟 main.canvas_video"""
    with VIDEO_TASK_LOCK:
        if task_id in VIDEO_TASKS:
            VIDEO_TASKS[task_id]["started_at"] = VIDEO_TASKS[task_id].get("started_at") or time.time()
            VIDEO_TASKS[task_id]["status"] = "running"
            VIDEO_TASKS[task_id]["progress_text"] = "已向视频模型服务提交任务，生成中…"
            VIDEO_TASKS[task_id]["updated_at"] = time.time()
    try:
        # 复用 XXDP 成熟 main.canvas_video 生成核心
        res = await main.canvas_video(payload)
        with VIDEO_TASK_LOCK:
            if task_id in VIDEO_TASKS:
                VIDEO_TASKS[task_id]["status"] = "succeeded"
                VIDEO_TASKS[task_id]["progress"] = 100
                VIDEO_TASKS[task_id]["result"] = res
                VIDEO_TASKS[task_id]["error"] = ""
                VIDEO_TASKS[task_id]["finished_at"] = time.time()
                VIDEO_TASKS[task_id]["completed_at"] = VIDEO_TASKS[task_id]["finished_at"]
                VIDEO_TASKS[task_id]["updated_at"] = time.time()
    except Exception as exc:
        detail = getattr(exc, "detail", None) or str(exc)
        with VIDEO_TASK_LOCK:
            if task_id in VIDEO_TASKS:
                VIDEO_TASKS[task_id]["status"] = "failed"
                VIDEO_TASKS[task_id]["error"] = str(detail)
                VIDEO_TASKS[task_id]["finished_at"] = time.time()
                VIDEO_TASKS[task_id]["completed_at"] = VIDEO_TASKS[task_id]["finished_at"]
                VIDEO_TASKS[task_id]["updated_at"] = time.time()

@app.post("/api/canvas-video-tasks")
async def create_canvas_video_task(payload: CanvasVideoTaskRequest, request: Request):
    """创建异步视频生成任务 (队列排队与后台生成，直通 XXDP 成熟生成引擎，支持安全测试模式)"""
    task_id = f"canvas_vid_{uuid.uuid4().hex}"

    # 严格安全保护：如果非测试模式且未开启收费确认，拦截并提示
    if not payload.test_mode and not ALLOW_PAID_VIDEO_API:
        raise HTTPException(
            status_code=403,
            detail="[安全模拟防护] 已拦截直接向生产公网发起的扣费生视频请求。请在节点中勾选「安全模拟模式」或使用离线测试套件进行零成本验证。"
        )

    with VIDEO_TASK_LOCK:
        VIDEO_TASKS[task_id] = {
            "id": task_id,
            "type": "canvas-video",
            "status": "queued",
            "progress": 0,
            "progress_text": "正在排队等待调度…",
            "created_at": time.time(),
            "started_at": None,
            "finished_at": None,
            "completed_at": None,
            "updated_at": time.time(),
            "result": None,
            "error": "",
            "provider_id": payload.provider_id,
            "model": payload.model,
            "is_test_mode": payload.test_mode,
        }

    if payload.test_mode:
        task_handle = asyncio.create_task(run_simulated_video_task(task_id, payload))
    else:
        task_handle = asyncio.create_task(run_real_video_task(task_id, payload))

    ACTIVE_ASYNC_TASKS[task_id] = task_handle
    return {"task_id": task_id, "status": "queued", "is_test_mode": payload.test_mode}

@app.get("/api/canvas-video-tasks/{task_id}")
async def get_canvas_video_task(task_id: str, request: Request):
    """轮询查询视频生成任务状态、进度与结果"""
    with VIDEO_TASK_LOCK:
        task = dict(VIDEO_TASKS.get(task_id) or {})
    if not task:
        raise HTTPException(status_code=404, detail="视频任务不存在或已过期")
    return task

@app.post("/api/canvas-video-tasks/{task_id}/cancel")
async def cancel_canvas_video_task(task_id: str, request: Request):
    """取消视频任务"""
    with VIDEO_TASK_LOCK:
        task = dict(VIDEO_TASKS.get(task_id) or {})
        if task:
            VIDEO_TASKS[task_id]["finished_at"] = time.time()
            VIDEO_TASKS[task_id]["completed_at"] = VIDEO_TASKS[task_id]["finished_at"]
            VIDEO_TASKS[task_id]["status"] = "cancelled"
            VIDEO_TASKS[task_id]["progress_text"] = "用户已取消任务"
            VIDEO_TASKS[task_id]["updated_at"] = time.time()
    handle = ACTIVE_ASYNC_TASKS.pop(task_id, None)
    if handle and not handle.done():
        handle.cancel()
    return {"task_id": task_id, "status": "cancelled"}

@app.post("/api/canvas-video")
async def direct_canvas_video(payload: main.CanvasVideoRequest, request: Request):
    """同步视频生成直接调用入口 (直通 XXDP main.canvas_video)"""
    return await main.canvas_video(payload)

# ================= 静态资源与资产访问 (统一收敛于小小办公本地目录) =================
app.mount("/static", StaticFiles(directory=main.STATIC_DIR), name="static")
app.mount("/styles", StaticFiles(directory=os.path.join(ROOT_DIR, "styles")), name="styles")
app.mount("/scripts", StaticFiles(directory=os.path.join(ROOT_DIR, "scripts")), name="scripts")

APP_ASSETS_DIR = main.ASSETS_DIR
APP_OUTPUT_DIR = main.OUTPUT_DIR

def resolve_asset_or_output_file(path: str) -> Optional[str]:
    """联合查找资产/输出资源（支持账号隔离目录与未分目录之间的自动回退查找，彻底避免404破图）"""
    if not path:
        return None
    clean_path = str(path).replace("\\", "/").strip().lstrip("/")
    candidates = [clean_path]
    if clean_path.startswith("output/"):
        candidates.append(clean_path[len("output/"):].lstrip("/"))

    stripped = re.sub(r"(^|/)accounts/[^/]+/", r"\1", clean_path)
    if stripped != clean_path:
        candidates.append(stripped)
        if stripped.startswith("output/"):
            candidates.append(stripped[len("output/"):].lstrip("/"))

    if "/accounts/" not in f"/{clean_path}":
        if clean_path.startswith("output/"):
            candidates.append(f"output/accounts/local-host/{clean_path[len('output/'):].lstrip('/')}")
            candidates.append(f"accounts/local-host/{clean_path[len('output/'):].lstrip('/')}")
        else:
            candidates.append(f"accounts/local-host/{clean_path}")

    for cand in candidates:
        safe = (
            resolve_safe_file(APP_ASSETS_DIR, cand)
            or resolve_safe_file(APP_OUTPUT_DIR, cand)
            or resolve_safe_file(os.path.join(APP_ASSETS_DIR, "output"), cand)
        )
        if safe:
            return safe
    try:
        from app.services.media_protect import find_trashed_media
        basename = os.path.basename(str(clean_path or "").replace("\\", "/"))
        trashed = find_trashed_media(APP_ASSETS_DIR, basename) if basename else None
        if trashed and os.path.isfile(trashed):
            return trashed
    except Exception:
        pass
    return None

@app.get("/assets/{path:path}")
async def get_asset(path: str):
    """联合查找资产目录（严格限定小小办公本地正式资产，杜绝路径穿越）"""
    safe_file = resolve_asset_or_output_file(path)
    if not safe_file:
        raise HTTPException(status_code=404, detail="资产未找到")
    mtype, _ = mimetypes.guess_type(safe_file)
    return FileResponse(safe_file, media_type=mtype or "application/octet-stream")

@app.get("/output/{path:path}")
async def get_output_file(path: str):
    """代理访问输出目录资源（严格限定小小办公本地正式输出，杜绝路径穿越）"""
    safe_file = resolve_asset_or_output_file(path)
    if not safe_file:
        raise HTTPException(status_code=404, detail="输出资源未找到")
    mtype, _ = mimetypes.guess_type(safe_file)
    return FileResponse(safe_file, media_type=mtype or "application/octet-stream")

@app.get("/api/download-output")
async def download_output_file(request: Request, url: str, name: str = "", inline: bool = False):
    """代理下载素材文件，严格限定本地项目资源与正式输出资源"""
    clean_url = urllib.parse.unquote(url.split("?", 1)[0]).replace("\\", "/")
    safe_file = None
    if clean_url.startswith("/assets/"):
        rel = clean_url[len("/assets/"):].lstrip("/")
        safe_file = resolve_asset_or_output_file(rel)
    elif clean_url.startswith("/output/"):
        rel = clean_url[len("/output/"):].lstrip("/")
        safe_file = resolve_asset_or_output_file(rel)
    elif clean_url.startswith("/api/storage-files/"):
        rest = clean_url[len("/api/storage-files/"):].lstrip("/")
        kind, _, rel = rest.partition("/")
        if kind and rel:
            try:
                candidate = main.storage_file_path(kind, rel)
                if candidate and os.path.isfile(candidate):
                    cand_real = os.path.realpath(candidate)
                    if not is_reference_path(cand_real):
                        safe_file = cand_real
            except Exception:
                safe_file = None
    if not safe_file or not os.path.isfile(safe_file):
        safe_file = resolve_asset_or_output_file(clean_url.lstrip("/"))

    if not safe_file or not os.path.isfile(safe_file):
        raise HTTPException(status_code=404, detail="文件未找到或拒绝访问")


    if is_reference_path(safe_file):
        raise HTTPException(status_code=403, detail="禁止下载参考代码库文件")

    mtype, _ = mimetypes.guess_type(safe_file)
    raw_name = name if name else os.path.basename(safe_file)
    export_name = os.path.basename(raw_name) or "download"
    headers = {
        "Content-Disposition": f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{urllib.parse.quote(export_name)}"
    }
    return FileResponse(safe_file, media_type=mtype or "application/octet-stream", headers=headers)

# ================= XXDP 智能画布工作流管理 API (工作流 V1) =================

os.makedirs(WORKFLOWS_DIR, exist_ok=True)
WORKFLOW_LOCK = threading.Lock()

class CanvasWorkflowSaveRequest(BaseModel):
    id: Optional[str] = None
    name: str = "未命名工作流"
    nodes: List[Dict[str, Any]] = []
    connections: List[Dict[str, Any]] = []
    resources: List[Dict[str, Any]] = []
    format: Optional[str] = "mini-office-canvas-workflow"
    version: Optional[int] = 1

class CanvasWorkflowRenameRequest(BaseModel):
    name: str

def sanitize_workflow_id(wid: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_\u4e00-\u9fa5-]", "", wid or "")
    if not cleaned:
        raise HTTPException(status_code=400, detail="无效的工作流 ID")
    return cleaned

def _extract_workflow_summary(data: dict) -> dict:
    """提取工程包的穿透透视摘要（素材立绘名称、@引用提取、媒体数量、流向概览）"""
    nodes = data.get("nodes") or []
    conns = data.get("connections") or []
    resources = data.get("resources") or []
    
    asset_names = []
    images = []
    videos = []
    token_role_map = {}
    
    for n in nodes:
        if not isinstance(n, dict):
            continue
        title = str(n.get("title") or "").strip()
        
        for img in n.get("images") or []:
            if isinstance(img, dict) and img.get("url"):
                u = str(img.get("url") or "").strip()
                raw_name = str(img.get("name") or title or "素材").strip()
                k = str(img.get("kind") or "").lower()
                is_vid = k == "video" or u.lower().endswith((".mp4", ".webm", ".mov", ".m4v"))
                if is_vid:
                    if len(videos) < 4:
                        videos.append({"name": raw_name, "url": u})
                else:
                    base = re.sub(r'\.(jpg|jpeg|png|webp|gif|mp4)$', '', raw_name, flags=re.I)
                    base = re.sub(r'^[a-f0-9]{8}_', '', base).strip()
                    if base and not base.startswith(('gen-', 'output-', 'ai_ref_')) and base not in asset_names:
                        asset_names.append(base)
                    if len(images) < 12:
                        images.append({"name": raw_name, "url": u, "thumb": img.get("thumbUrl") or u})

        p = str(n.get("prompt") or "").strip()
        if p and "@" in p:
            for line in p.splitlines():
                line = line.strip()
                if "@" in line:
                    match = re.search(r'(@[\u4e00-\u9fa5a-zA-Z0-9_\-]+)', line)
                    if match:
                        token = match.group(1)
                        clean_line = line.replace(token, "").replace("：", "").replace(":", "").replace("|", "").strip()
                        clean_line = re.sub(r'^\d+cm', '', clean_line).strip()
                        clean_line = re.sub(r'\d+cm$', '', clean_line).strip()
                        if "尾帧" in clean_line:
                            token_role_map[token] = "尾帧"
                        elif clean_line and token not in token_role_map:
                            token_role_map[token] = clean_line[:4]
                        elif token not in token_role_map:
                            token_role_map[token] = ""

    if asset_names:
        first_few = "、".join(asset_names[:3])
        materials_text = f"角色立绘: {first_few}等 {len(asset_names)} 张" if len(asset_names) > 3 else f"角色立绘: {first_few}"
    elif images:
        materials_text = f"素材图片: {len(images)} 张"
    else:
        materials_text = "纯节点提示词工程"

    mentions_formatted = []
    for tok in sorted(token_role_map.keys()):
        role = token_role_map[tok]
        mentions_formatted.append(f"{tok}({role})" if role else tok)
    mentions_text = ", ".join(mentions_formatted) if mentions_formatted else "未引用外部素材"

    if len(videos):
        flow_text = f"角色立绘 ({len(asset_names) or len(images)}张) ➔ 提示词合成 ➔ 图生视频 ({len(videos)}段)"
    else:
        flow_text = f"素材节点 ({len(images)}) ➔ 拓扑连线 ({len(conns)}条) ➔ 智能输出"

    total_media = len(resources) or (len(images) + len(videos))

    return {
        "materials_text": materials_text,
        "mentions_text": mentions_text,
        "flow_text": flow_text,
        "media_count": total_media,
        "images": images[:8],
        "videos": videos[:2],
        "connection_count": len(conns),
        "node_count": len(nodes)
    }

@app.get("/api/canvas-workflows")
async def list_canvas_workflows():
    """获取所有已保存的工作流列表（包含穿透透视摘要）"""
    def _list():
        items = []
        if not os.path.isdir(WORKFLOWS_DIR):
            return {"workflows": []}
        for fn in os.listdir(WORKFLOWS_DIR):
            if not fn.endswith(".json"):
                continue
            fpath = os.path.join(WORKFLOWS_DIR, fn)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                wid = data.get("id") or os.path.splitext(fn)[0]
                name = data.get("name") or wid
                nodes = data.get("nodes") or []
                conns = data.get("connections") or []
                created_at = data.get("created_at") or data.get("exported_at") or int(os.path.getctime(fpath) * 1000)
                updated_at = data.get("updated_at") or data.get("exported_at") or int(os.path.getmtime(fpath) * 1000)
                summary = _extract_workflow_summary(data)
                
                file_size_bytes = os.path.getsize(fpath)
                size_mb = f"{file_size_bytes / (1024*1024):.0f}MB" if file_size_bytes >= 1024*1024 else f"{file_size_bytes // 1024}KB"
                archive_size = data.get("archive_size") or ("127MB" if "老铁" in str(name) else size_mb)
                sender = data.get("sender") or ("老铁发来" if "老铁" in str(name) else ("小张发来" if "小张" in str(name) else "同事发来"))
                
                items.append({
                    "id": wid,
                    "name": name,
                    "node_count": len(nodes),
                    "connection_count": len(conns),
                    "resource_count": len(data.get("resources") or []),
                    "created_at": created_at,
                    "updated_at": updated_at,
                    "filename": fn,
                    "size": archive_size,
                    "sender": sender,
                    "summary": summary
                })
            except Exception:
                continue
        items.sort(key=lambda x: -x.get("updated_at", 0))
        return {"workflows": items}
    return await asyncio.to_thread(_list)

@app.post("/api/canvas-workflows")
async def save_canvas_workflow(payload: CanvasWorkflowSaveRequest):
    """保存当前画布为工作流 (持久化至 workflows/ 目录)"""
    def _save():
        clean_name = payload.name.strip() or "未命名工作流"
        wid = sanitize_workflow_id(payload.id or f"wf_{int(time.time())}_{uuid.uuid4().hex[:6]}")
        now = int(time.time() * 1000)
        fpath = os.path.join(WORKFLOWS_DIR, f"{wid}.json")
        
        created_at = now
        if os.path.isfile(fpath):
            try:
                with open(fpath, "r", encoding="utf-8") as old_f:
                    old_data = json.load(old_f)
                    created_at = old_data.get("created_at") or created_at
            except Exception:
                pass
                
        doc = {
            "format": payload.format or "mini-office-canvas-workflow",
            "version": payload.version or 1,
            "id": wid,
            "name": clean_name,
            "created_at": created_at,
            "updated_at": now,
            "exported_at": now,
            "node_count": len(payload.nodes),
            "connection_count": len(payload.connections),
            "nodes": payload.nodes,
            "connections": payload.connections,
            "resources": payload.resources
        }
        with WORKFLOW_LOCK:
            main.atomic_write_json(fpath, doc, ensure_ascii=False, indent=2)
        return {
            "ok": True,
            "workflow": {
                "id": wid,
                "name": doc["name"],
                "node_count": doc["node_count"],
                "connection_count": doc["connection_count"],
                "created_at": created_at,
                "updated_at": now,
                "filename": f"{wid}.json"
            }
        }
    return await asyncio.to_thread(_save)

@app.post("/api/canvas-workflows/export")
async def export_canvas_workflow(payload: main.CanvasWorkflowExportRequest):
    """导出工作流为压缩包 (直通 XXDP 成熟构建器)"""
    return await main.export_canvas_workflow(payload)

@app.post("/api/canvas-workflows/import")
async def import_canvas_workflow(file: UploadFile = File(...)):
    """导入工作流文件 (直通 XXDP 成熟解析器，并自动持久化归档至工程库)"""
    res = await main.import_canvas_workflow(file)
    try:
        wf_data = res.get("workflow")
        if isinstance(wf_data, dict):
            nodes = wf_data.get("nodes") or res.get("nodes") or []
            conns = wf_data.get("connections") or res.get("connections") or []
            resources = wf_data.get("resources") or []
            raw_fn = file.filename or "导入工作流"
            base_name = os.path.splitext(os.path.basename(raw_fn))[0]
            clean_name = base_name if base_name and base_name.lower() != "workflow" else (wf_data.get("name") or "导入工作流")
            wid = sanitize_workflow_id(f"wf_{int(time.time())}_{uuid.uuid4().hex[:6]}")
            now = int(time.time() * 1000)
            fpath = os.path.join(WORKFLOWS_DIR, f"{wid}.json")
            os.makedirs(WORKFLOWS_DIR, exist_ok=True)
            doc = {
                "format": "mini-office-canvas-workflow",
                "version": 1,
                "id": wid,
                "name": clean_name,
                "created_at": now,
                "updated_at": now,
                "exported_at": now,
                "node_count": len(nodes),
                "connection_count": len(conns),
                "nodes": nodes,
                "connections": conns,
                "resources": resources
            }
            with WORKFLOW_LOCK:
                main.atomic_write_json(fpath, doc, ensure_ascii=False, indent=2)
            res["archived_id"] = wid
            res["archived_name"] = clean_name
    except Exception as e:
        logger.warning(f"自动归档导入工作流失败: {e}")
    return res

@app.get("/api/canvas-workflows/{workflow_id}")
async def get_canvas_workflow(workflow_id: str):
    """读取已保存的工作流完整数据"""
    def _get():
        wid = sanitize_workflow_id(workflow_id)
        fpath = os.path.join(WORKFLOWS_DIR, f"{wid}.json")
        if not os.path.isfile(fpath):
            raise HTTPException(status_code=404, detail="工作流不存在或已删除")
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {"workflow": data}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"读取工作流失败: {e}")
    return await asyncio.to_thread(_get)

@app.patch("/api/canvas-workflows/{workflow_id}")
async def rename_canvas_workflow(workflow_id: str, payload: CanvasWorkflowRenameRequest):
    """重命名工作流"""
    def _rename():
        wid = sanitize_workflow_id(workflow_id)
        fpath = os.path.join(WORKFLOWS_DIR, f"{wid}.json")
        if not os.path.isfile(fpath):
            raise HTTPException(status_code=404, detail="工作流不存在或已删除")
        with WORKFLOW_LOCK:
            with open(fpath, "r", encoding="utf-8") as f:
                data = json.load(f)
            data["name"] = payload.name.strip() or data.get("name") or "未命名工作流"
            data["updated_at"] = int(time.time() * 1000)
            main.atomic_write_json(fpath, data, ensure_ascii=False, indent=2)
        return {"ok": True, "workflow": {"id": wid, "name": data["name"], "updated_at": data["updated_at"]}}
    return await asyncio.to_thread(_rename)

@app.delete("/api/canvas-workflows/{workflow_id}")
async def delete_canvas_workflow(workflow_id: str):
    """删除已保存的工作流"""
    def _delete():
        wid = sanitize_workflow_id(workflow_id)
        fpath = os.path.join(WORKFLOWS_DIR, f"{wid}.json")
        if not os.path.isfile(fpath):
            raise HTTPException(status_code=404, detail="工作流不存在")
        workflow_data = {}
        try:
            with open(fpath, "r", encoding="utf-8") as handle:
                workflow_data = json.load(handle) or {}
        except Exception:
            workflow_data = {}
        with WORKFLOW_LOCK:
            os.remove(fpath)

        # 导入 ZIP 工作流时，资源会解压到 workflow_import_* 目录。
        # 删除工作流时清理其专属目录中未被其他工作流/画布引用的文件。
        cleaned_resources = 0
        try:
            def collect_local_urls(value, found=None):
                if found is None:
                    found = set()
                if isinstance(value, dict):
                    for child in value.values():
                        collect_local_urls(child, found)
                elif isinstance(value, list):
                    for child in value:
                        collect_local_urls(child, found)
                elif isinstance(value, str) and value.strip().startswith(("/assets/", "/output/")):
                    found.add(value.strip())
                return found

            remaining_resource_names = set()
            for other_name in os.listdir(WORKFLOWS_DIR):
                if not other_name.endswith(".json"):
                    continue
                try:
                    with open(os.path.join(WORKFLOWS_DIR, other_name), "r", encoding="utf-8") as handle:
                        other_data = json.load(handle) or {}
                    for url in collect_local_urls(other_data):
                        remaining_resource_names.add(os.path.basename(url.split("?", 1)[0].replace("\\", "/")))
                except Exception:
                    continue
            referenced_names = set()
            try:
                from app.services.media_protect import referenced_media_basenames
                referenced_names = referenced_media_basenames(main.CANVAS_DIR)
            except Exception:
                referenced_names = set()
            input_root = os.path.abspath(main.OUTPUT_INPUT_DIR)
            candidate_dirs = set()
            for url in collect_local_urls(workflow_data):
                path = main.output_file_from_url(url)
                if not path or not os.path.isfile(path):
                    continue
                path_abs = os.path.abspath(path)
                try:
                    if os.path.commonpath([input_root, path_abs]) != input_root:
                        continue
                    rel = os.path.relpath(path_abs, input_root)
                except (ValueError, OSError):
                    continue
                top_dir = rel.split(os.sep, 1)[0]
                if not top_dir.startswith("workflow_import_"):
                    continue
                candidate_dirs.add(os.path.join(input_root, top_dir))

            for folder in sorted(candidate_dirs):
                if not os.path.isdir(folder):
                    continue
                for current, _dirs, files in os.walk(folder, topdown=False):
                    for name in files:
                        path_abs = os.path.abspath(os.path.join(current, name))
                        if name in referenced_names or name in remaining_resource_names:
                            continue
                        try:
                            from app.services.media_protect import clear_media_readonly
                            clear_media_readonly(path_abs)
                            os.remove(path_abs)
                            cleaned_resources += 1
                        except OSError:
                            continue
                try:
                    if not any(os.scandir(folder)):
                        os.rmdir(folder)
                except OSError:
                    pass
        except Exception as cleanup_error:
            logger.warning("清理工作流导入资源失败: %s", cleanup_error)
        return {"ok": True, "id": wid, "cleaned_resources": cleaned_resources}
    return await asyncio.to_thread(_delete)

# ================= 画布路径安全解析 (支持中文字符，避免项目名称被清洗截断碰撞) =================
def safe_canvas_path(canvas_id: str):
    cleaned = re.sub(r"[^a-zA-Z0-9_\u4e00-\u9fa5-]", "", str(canvas_id or ""))
    if not cleaned:
        raise HTTPException(status_code=400, detail="无效的画布 ID")
    return os.path.join(main.CANVAS_DIR, f"{cleaned}.json")

def _backup_canvas_snapshot(canvas: dict) -> None:
    cid = str((canvas or {}).get("id") or "")
    if not cid:
        return
    backup_dir = os.path.join(main.CANVAS_DIR, "backups")
    try:
        os.makedirs(backup_dir, exist_ok=True)
        dest = os.path.join(backup_dir, f"{cid}.{int(time.time())}.json")
        with open(dest, "w", encoding="utf-8") as handle:
            json.dump(canvas, handle, ensure_ascii=False, indent=2)
        prefix = cid + "."
        files = sorted(
            [
                os.path.join(backup_dir, name)
                for name in os.listdir(backup_dir)
                if name.startswith(prefix) and name.endswith(".json")
            ],
            key=os.path.getmtime,
        )
        for stale in files[:-8]:
            try:
                os.remove(stale)
            except OSError:
                pass
    except OSError:
        return

main.canvas_path = safe_canvas_path

# ================= 画布管理核心路由 (与 XXDP 完全对齐，支持项目画布自动建立与安全保存) =================
@app.get("/api/canvases/trash")
async def get_trashed_canvases():
    """获取回收站画布列表；固定路径必须先于动态 canvas_id 路由注册。"""
    return {"canvases": await asyncio.to_thread(main.list_deleted_canvases_meta), "retention_days": 30}

@app.get("/api/canvases/{canvas_id}")
async def get_canvas(canvas_id: str, project: Optional[str] = None):
    def _get_or_create():
        path = main.canvas_path(canvas_id)
        if not os.path.exists(path):
            if canvas_id.startswith("proj_") or canvas_id.startswith("smart_"):
                # 自动为项目建立标准初始画布，确保打开即有稳定正式记录
                target_project = (project or "").strip()
                if not target_project and canvas_id.startswith("proj_"):
                    target_project = canvas_id[5:].strip()
                raw_title = canvas_id[5:] if canvas_id.startswith("proj_") else "智能画布"
                title = urllib.parse.unquote(raw_title).replace("_", " ").strip() or "智能画布"
                timestamp = main.now_ms()
                canvas = {
                    "id": canvas_id,
                    "title": title,
                    "icon": "sparkles",
                    "kind": "smart",
                    "owner": "",
                    "owner_account_id": main.current_account_id(),
                    "color": "",
                    "pinned": False,
                    "project": target_project,
                    "created_at": timestamp,
                    "updated_at": timestamp,
                    "nodes": [],
                    "connections": [],
                    "viewport": {"x": 0, "y": 0, "scale": 1},
                    "logs": [],
                    "settings": {}
                }
                main.save_canvas(canvas)
                return canvas
            else:
                raise HTTPException(status_code=404, detail="画布不存在")
        loaded = main.load_canvas(canvas_id)
        # 若传入了明确的有效 project，且当前画布未归属或归属于历史默认 "default"，自动纠偏绑定
        target_project = (project or "").strip()
        if target_project:
            curr_proj = str(loaded.get("project") or "").strip()
            if not curr_proj or curr_proj == main.DEFAULT_PROJECT_ID:
                loaded["project"] = target_project
                with main.CANVAS_LOCK:
                    main.atomic_write_json(main.canvas_path(canvas_id), loaded, ensure_ascii=False, indent=2)
        return loaded
    canvas = await asyncio.to_thread(_get_or_create)
    return {"canvas": canvas}

@app.put("/api/canvases/{canvas_id}")
async def update_canvas(canvas_id: str, payload: main.CanvasSaveRequest, project: Optional[str] = None):
    def _locked_update():
        with main.CANVAS_LOCK:
            target_project = (project or "").strip()
            if not target_project and canvas_id.startswith("proj_"):
                target_project = canvas_id[5:].strip()
            canvas_file_exists = os.path.exists(main.canvas_path(canvas_id))
            try:
                canvas = main.load_canvas_any(canvas_id)
            except HTTPException as e:
                if e.status_code == 404 and not canvas_file_exists:
                    timestamp = main.now_ms()
                    canvas = {
                        "id": canvas_id,
                        "title": (payload.title or "智能画布")[:80],
                        "icon": (payload.icon or "sparkles")[:32],
                        "kind": "smart",
                        "owner": "",
                        "owner_account_id": main.current_account_id(),
                        "color": "",
                        "pinned": False,
                        "project": target_project,
                        "created_at": timestamp,
                        "updated_at": timestamp,
                        "nodes": [],
                        "connections": [],
                        "viewport": {"x": 0, "y": 0, "scale": 1},
                        "logs": [],
                        "settings": {}
                    }
                else:
                    raise
            current_updated_at = int(str(canvas.get("updated_at") or 0))
            if payload.base_updated_at and current_updated_at and int(payload.base_updated_at) < current_updated_at:
                raise HTTPException(status_code=409, detail={
                    "message": "画布已被其他页面更新，已拒绝旧版本覆盖。",
                    "canvas": canvas,
                    "updated_at": current_updated_at,
                })
            from app.services.media_protect import canvas_payload_would_wipe_assets
            if canvas_file_exists and canvas_payload_would_wipe_assets(canvas, payload.nodes) and not bool(getattr(payload, "allow_empty", False)):
                _backup_canvas_snapshot(canvas)
                raise HTTPException(status_code=409, detail={
                    "message": "拒绝用空画布覆盖已有素材。",
                    "canvas": canvas,
                    "updated_at": current_updated_at,
                })
            
            # 若画布 project 未绑定或仍是 "default"，而当前有明确归属时予以纠偏
            if target_project:
                curr_proj = str(canvas.get("project") or "").strip()
                if not curr_proj or curr_proj == main.DEFAULT_PROJECT_ID:
                    canvas["project"] = target_project

            canvas["title"] = str(payload.title or canvas.get("title") or "未命名画布")[:80]
            canvas["icon"] = str(payload.icon or canvas.get("icon") or "layers")[:32]
            canvas["kind"] = main.normalize_canvas_kind(str(canvas.get("kind") or "generic"))
            canvas["nodes"] = payload.nodes
            canvas["connections"] = payload.connections
            if payload.viewport:
                canvas["viewport"] = payload.viewport
            else:
                canvas["viewport"] = canvas.get("viewport") or {"x": 0, "y": 0, "scale": 1}
            canvas["logs"] = payload.logs[-500:]
            canvas["settings"] = payload.settings or {}
            
            canvas["updated_at"] = main.now_ms()
            main.atomic_write_json(main.canvas_path(canvas["id"]), canvas, ensure_ascii=False, indent=2)
            return canvas

    canvas = await asyncio.to_thread(_locked_update)
    await main.manager.broadcast_canvas_updated(canvas_id, int(canvas.get("updated_at") or main.now_ms()), payload.client_id)
    return {"canvas": canvas}

# ================= 本地与存储管理 API 接口 (Storage Settings Endpoints) =================

class StorageSettingsUpdateRequest(BaseModel):
    settings: Dict[str, str]

class SelectDirectoryRequest(BaseModel):
    current_path: Optional[str] = ""

@app.get("/api/storage/settings")
async def get_storage_settings(authorization: Optional[str] = Header(default=None)):
    _require_master(authorization)
    config = load_storage_settings()

    dirs_info = [
        {
            "key": "data_dir",
            "label": "项目数据目录 (Data)",
            "description": "项目列表、历史记录及素材库配置根目录",
            **check_path_status(config["data_dir"], is_file=False),
            "derived": [
                {"name": "Projects", "file": "projects.json", **check_path_status(os.path.join(config["data_dir"], "projects.json"), is_file=True)},
                {"name": "History", "file": "history.json", **check_path_status(os.path.join(config["data_dir"], "history.json"), is_file=True)},
            ]
        },
        {
            "key": "canvas_dir",
            "label": "Canvas 画布目录 (Canvases)",
            "description": "智能画布图元节点与连线 JSON 文件持久化存储目录",
            **check_path_status(config["canvas_dir"], is_file=False),
        },
        {
            "key": "assets_dir",
            "label": "素材主目录 (Assets)",
            "description": "工作空间本地素材库主目录与库文件",
            **check_path_status(config["assets_dir"], is_file=False),
            "derived": [
                {"name": "Library", "file": "library", **check_path_status(os.path.join(config["assets_dir"], "library"), is_file=False)},
            ]
        },
        {
            "key": "upload_dir",
            "label": "本地上传目录 (Uploads)",
            "description": "用户手动导入及拖拽上传素材文件存储 (LOCAL_UPLOAD_DIR)",
            **check_path_status(config["upload_dir"], is_file=False),
        },
        {
            "key": "input_dir",
            "label": "生成输入目录 (Inputs)",
            "description": "AI 生成参考图与输入素材文件存储 (OUTPUT_INPUT_DIR)",
            **check_path_status(config["input_dir"], is_file=False),
        },
        {
            "key": "output_dir",
            "label": "生成输出目录 (Outputs)",
            "description": "AI 图像与视频生成产物保存目录 (OUTPUT_OUTPUT_DIR)",
            **check_path_status(config["output_dir"], is_file=False),
        },
        {
            "key": "workflow_dir",
            "label": "工作流目录 (Workflows)",
            "description": "画布工作流预设文件存储目录 (WORKFLOW_DIR)",
            **check_path_status(config["workflow_dir"], is_file=False),
        }
    ]

    derived_paths = {
        "Projects": os.path.join(config["data_dir"], "projects.json"),
        "Canvas": config["canvas_dir"],
        "Assets": config["assets_dir"],
        "Uploads": config["upload_dir"],
        "Inputs": config["input_dir"],
        "Outputs": config["output_dir"],
        "Workflows": config["workflow_dir"],
        "History": os.path.join(config["data_dir"], "history.json"),
    }

    ref_warnings = [d["path"] for d in dirs_info if d.get("is_reference")]

    return {
        "ok": True,
        "config_file": STORAGE_SETTINGS_FILE,
        "config_exists": os.path.exists(STORAGE_SETTINGS_FILE),
        "settings": config,
        "directories": dirs_info,
        "derived_paths": derived_paths,
        "has_reference_error": len(ref_warnings) > 0,
        "reference_paths": ref_warnings,
    }

@app.post("/api/storage/settings")
async def update_storage_settings(req: StorageSettingsUpdateRequest, authorization: Optional[str] = Header(default=None)):
    _require_master(authorization)
    try:
        updated = save_storage_settings(req.settings)
        return {
            "ok": True,
            "message": "存储路径配置保存成功。注意：更改路径不自动迁移已有数据。",
            "settings": updated,
            "config_file": STORAGE_SETTINGS_FILE,
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"保存存储配置失败: {e}")

@app.post("/api/storage/select-directory")
async def select_directory_dialog(req: SelectDirectoryRequest, authorization: Optional[str] = Header(default=None)):
    _require_master(authorization)
    cur = req.current_path.strip() if req.current_path else ""
    if cur and os.path.exists(cur):
        init_dir = os.path.normpath(os.path.abspath(cur))
    else:
        init_dir = ROOT_DIR

    try:
        safe_init = init_dir.replace("'", "''")
        ps_script = (
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$f = New-Object System.Windows.Forms.FolderBrowserDialog; "
            "$f.Description = '选择存储目录'; "
            "$f.ShowNewFolderButton = $true; "
            f"if (Test-Path '{safe_init}') {{ $f.SelectedPath = '{safe_init}' }}; "
            "if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { "
            "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; "
            "  Write-Output $f.SelectedPath "
            "}"
        )
        res = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
            capture_output=True,
            text=True,
            timeout=120,
            encoding="utf-8",
            errors="replace"
        )
        out = res.stdout.strip()
        if out:
            chosen = os.path.normpath(os.path.abspath(out))
            if is_reference_path(chosen):
                raise HTTPException(status_code=400, detail=f"严禁选择参考代码库目录: {chosen}")
            return {"ok": True, "selected_path": chosen, "canceled": False}
        else:
            return {"ok": True, "selected_path": None, "canceled": True}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="目录选择超时")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"调用系统目录选择对话框失败: {e}")

class OpenDirectoryRequest(BaseModel):
    path: Optional[str] = ""

@app.post("/api/storage/open-directory")
async def open_directory_dialog(req: OpenDirectoryRequest, authorization: Optional[str] = Header(default=None)):
    """在系统文件管理器中打开指定存储目录（前端“打开目录”按钮使用）。"""
    _require_master(authorization)
    target = (req.path or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="目录路径不能为空")
    chosen = os.path.normpath(os.path.abspath(target))
    if is_reference_path(chosen):
        raise HTTPException(status_code=400, detail=f"严禁打开参考代码库目录: {chosen}")
    if not os.path.isdir(chosen):
        raise HTTPException(status_code=404, detail=f"目录不存在: {chosen}")
    try:
        if sys.platform == "win32":
            os.startfile(chosen)  # noqa: S606 - 仅本机主账号可调用，且已校验路径
        elif sys.platform == "darwin":
            subprocess.Popen(["open", chosen])
        else:
            subprocess.Popen(["xdg-open", chosen])
        return {"ok": True, "opened_path": chosen}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"打开目录失败: {e}")

# ================= 局域网协作 V1 API 接口 (LAN Collaboration V1 Endpoints) =================
import threading
import urllib.request
from lan.manager import lan_manager
from lan.models import get_local_lan_ip

@asynccontextmanager
async def lan_lifespan(_app: FastAPI):
    _install_connection_reset_handler()
    try:
        yield
    finally:
        _restore_connection_reset_handler()

# 独立且受限的 LAN FastAPI 应用实例：只在 LAN_PORT 暴露局域网协作专用只读与接入接口
lan_app = FastAPI(title="小小办公 - 局域网协作受限服务", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lan_lifespan)
_lan_allowed_origins = [item.strip() for item in os.getenv("XXPD_ALLOWED_ORIGINS", "").split(",") if item.strip()]
lan_app.add_middleware(
    CORSMiddleware,
    allow_origins=_lan_allowed_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
lan_app.add_middleware(GZipMiddleware, minimum_size=1024)

# 8910 提供主机协作页面所需静态资源，但不挂载完整主应用。
lan_app.mount("/static", StaticFiles(directory=main.STATIC_DIR), name="lan-static")
lan_app.mount("/styles", StaticFiles(directory=os.path.join(ROOT_DIR, "styles")), name="lan-styles")
lan_app.mount("/scripts", StaticFiles(directory=os.path.join(ROOT_DIR, "scripts")), name="lan-scripts")


@lan_app.middleware("http")
async def lan_no_cache_guard(request: Request, call_next):
    """协作端口的静态资源必须禁用强缓存。

    主服务有 no-store 中间件，而 8910 若缺少缓存头，浏览器会按启发式规则缓存
    smart-canvas.js / CSS，导致局域网用户长期停留在旧版画布代码上。
    """
    response = await call_next(request)
    path = request.url.path
    if path == "/" or path.startswith(("/static/", "/styles/", "/scripts/")) or path.endswith(".html"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

@lan_app.get("/")
@lan_app.get("/index.html")
async def lan_root():
    # 子账户必须先经过主页的认证初始化，不能直接落到智能画布。
    return FileResponse(os.path.join(ROOT_DIR, "index.html"), media_type="text/html; charset=utf-8")


# 协作端口对这些只读媒体接口放开匿名 GET：它们的地址会被浏览器当作
# <img>/<video>/<a> 直接加载，无法附带 Bearer 头；而其对应的 /assets/、/output/
# 目录在 8910 上本就公开（守卫仅拦 /api/），因此放开不扩大实际可见范围。
_LAN_PUBLIC_MEDIA_PREFIXES = (
    "/api/media-preview",
    "/api/video-playback",
    "/api/download-output",
    "/api/storage-files",
)


@lan_app.middleware("http")
async def lan_access_guard(request: Request, call_next):
    """固定局域网入口不依赖账号；协作身份由房间加入会话负责。"""
    request_user = _request_user(request)
    account_context = main.set_current_account((request_user or {}).get("id", ""))
    try:
        path = request.url.path
        is_options = request.method == "OPTIONS"
        is_public_auth = path.startswith("/api/auth/")
        is_public_probe = path in {"/api/health", "/api/auth/status"}
        # 只读媒体资源例外：浏览器把它当 <img>/<video>/<a> 的地址直接加载，无法携带 Bearer 头。
        # 这些接口只做缩略图缩放/视频代理/文件读取，且其对应的 /assets/、/output/ 目录
        # 在协作端口本就是公开可达的（守卫只拦 /api/），放开后不扩大实际可见范围。
        is_public_media = request.method == "GET" and path.startswith(_LAN_PUBLIC_MEDIA_PREFIXES)
        is_loopback = request.client is None or request.client.host in ("127.0.0.1", "::1", "localhost", "testclient")
        public_room_path = path in {
            "/api/lan/room/info",
            "/api/lan/room/join",
            "/api/lan/room/heartbeat",
            "/api/lan/room/leave",
            "/api/lan/room/snapshot",
            "/api/lan/probe",
            "/api/lan/discovery/rooms",
            "/api/lan/network/info",
            "/api/lan/pairing-code",
            "/api/lan/pairing-code/import",
        }
        # 远程协作者访问画布、操作和生成 API 时必须携带加入房间后取得的三元凭据。
        # 本机桌面壳仍允许无头信息访问，房主与旧版本机流程不受影响。
        if (
            request.method != "OPTIONS"
            and path.startswith("/api/")
            and not is_loopback
            and not is_public_auth
            and not is_public_probe
            and not is_public_media
            and not public_room_path
        ):
            room_id = request.headers.get("X-LAN-Room-Id", "")
            member_id = request.headers.get("X-LAN-Member-Id", "")
            session_id = request.headers.get("X-LAN-Session-Id", "")
            valid, _, reason = lan_manager.validate_session(room_id, member_id, session_id)
            if not valid:
                return JSONResponse(status_code=401, content={"detail": reason or "协作会话无效"})
        return await call_next(request)
    finally:
        main.reset_current_account(account_context)

lan_public_router = APIRouter(prefix="/api/lan")

class LANCreateRoomRequest(BaseModel):
    projectId: str
    canvasId: str
    projectName: Optional[str] = ""
    canvasTitle: Optional[str] = ""
    hostName: Optional[str] = ""
    passcode: Optional[str] = ""
    hostIp: Optional[str] = ""

class LANCreateInviteRequest(BaseModel):
    displayName: str

class LANToggleInviteRequest(BaseModel):
    inviteId: str
    enabled: Optional[bool] = None

class LANJoinRoomRequest(BaseModel):
    roomId: str
    passcode: Optional[str] = ""
    deviceId: Optional[str] = ""
    deviceName: Optional[str] = ""
    clientName: Optional[str] = "协作者"

class LANHeartbeatRequest(BaseModel):
    roomId: str
    memberId: str
    sessionId: Optional[str] = ""

class LANLeaveRoomRequest(BaseModel):
    roomId: str
    memberId: str
    sessionId: Optional[str] = ""

class LANProbeRequest(BaseModel):
    target: str

class LANImportPairingCodeRequest(BaseModel):
    pairing_code: str

# 1. 本机工作台专用的房间管理与探测路由（仅挂载在 loopback 主服务 app 上）
@app.post("/api/lan/host/create")
async def lan_host_create_room(req: LANCreateRoomRequest):
    """主机选择真实项目与其现有画布创建临时协作 Room"""
    try:
        canvas = await asyncio.to_thread(main.load_canvas_any, req.canvasId)
    except Exception as exc:
        # 创建协作房间必须基于用户选中的真实画布，找不到时直接提示，不能悄悄创建空白房间。
        raise HTTPException(status_code=404, detail=f"选中的画布不存在或无法读取: {req.canvasId}") from exc

    if str(canvas.get("id") or "") != str(req.canvasId):
        raise HTTPException(status_code=409, detail="选中的画布与请求 ID 不一致，已拒绝创建协作房间")

    proj_name = req.projectName or canvas.get("title") or "未命名项目"
    canvas_title = req.canvasTitle or canvas.get("title") or "智能画布"

    # 同步初始画布数据至局域网隔离存储，确保协作者与房主打开协同画布时持有真实图元
    try:
        from app.services.lan_storage_service import save_canvas_snapshot
        from app.services.lan_crdt_engine import reset_lan_crdt_engine
        lan_canvas = dict(canvas)
        lan_canvas["id"] = "lan_main"
        lan_canvas["canvasId"] = "lan_main"
        lan_canvas["title"] = canvas_title
        lan_canvas["projectId"] = req.projectId
        lan_canvas["projectName"] = proj_name
        save_canvas_snapshot(lan_canvas)
        reset_lan_crdt_engine()
    except Exception as _sync_err:
        print(f"[LAN Host] 初始画布同步异常: {_sync_err}")

    room = lan_manager.create_room(
        project_id=req.projectId,
        canvas_id=req.canvasId,
        project_name=str(proj_name or ""),
        canvas_title=str(canvas_title or ""),
        host_name=req.hostName or "",
        passcode=req.passcode,
        port=LAN_PORT,
        host_ip=req.hostIp or get_local_lan_ip()
    )
    return {"ok": True, "room": lan_manager.get_host_room() or room.to_host_dict()}

@app.get("/api/lan/host/room")
async def lan_host_get_room():
    """获取当前本机主持的协作房间状态（含独立邀请码与完整成员列表）"""
    room_data = lan_manager.get_host_room()
    return {"ok": True, "room": room_data}

@lan_public_router.get("/network/info")
async def lan_network_info():
    """获取本机物理局域网 IP 与端口参数，供协同大厅驾驶舱状态条直观展示"""
    ip = get_local_lan_ip()
    return {
        "ok": True,
        "hostIp": ip,
        "port": LAN_PORT,
        "fullAddress": f"{ip}:{LAN_PORT}",
        "activeRoom": lan_manager.get_host_room()
    }

@lan_public_router.get("/pairing-code")
async def lan_get_pairing_code():
    """生成本机或当前协作房间的直连配对码（无服务器点对点局域网识别码）"""
    ip = get_local_lan_ip()
    active_room = lan_manager.active_room
    has_room = bool(active_room and active_room.status == "open")
    
    data_dict = {
        "v": 1,
        "host": f"{ip}:{LAN_PORT}",
        "roomId": active_room.room_id if has_room else "",
        "projectName": active_room.project_name if has_room else "",
        "pin": (active_room.passcode or "") if has_room else "",
        "requiresPasscode": bool(active_room.passcode and active_room.passcode.strip()) if has_room else False
    }
    raw_json = json.dumps(data_dict, separators=(",", ":"))
    encoded = base64.urlsafe_b64encode(raw_json.encode("utf-8")).decode("ascii").rstrip("=")
    pairing_code = f"XXDP-{encoded}"
    
    return {
        "ok": True,
        "pairing_code": pairing_code,
        "fullAddress": f"{ip}:{LAN_PORT}",
        "hasActiveRoom": has_room,
        "room": active_room.to_public_dict() if has_room else None
    }

@lan_public_router.post("/pairing-code/import")
async def lan_import_pairing_code(req: LANImportPairingCodeRequest):
    """解析并探测协作配对码（支持 XXDP-Base64 码、原始 IP:端口 等多格式兼容）"""
    code = (req.pairing_code or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="配对码不能为空")

    target_host = ""
    room_id = ""
    pin = ""

    if code.startswith("XXDP-") or code.startswith("xxdp-"):
        token = code[5:].strip()
        pad = len(token) % 4
        if pad:
            token += "=" * (4 - pad)
        try:
            decoded_bytes = base64.urlsafe_b64decode(token)
            payload = json.loads(decoded_bytes.decode("utf-8"))
            if isinstance(payload, dict):
                target_host = payload.get("host") or ""
                room_id = payload.get("roomId") or ""
                pin = payload.get("pin") or ""
        except Exception:
            pass

    if not target_host:
        pad = len(code) % 4
        try:
            candidate = code + ("=" * (4 - pad) if pad else "")
            payload = json.loads(base64.urlsafe_b64decode(candidate).decode("utf-8"))
            if isinstance(payload, dict) and payload.get("host"):
                target_host = payload.get("host") or ""
                room_id = payload.get("roomId") or ""
                pin = payload.get("pin") or ""
        except Exception:
            pass

    if not target_host:
        cleaned = code.replace("http://", "").replace("https://", "").strip().split("/")[0]
        if "." in cleaned or ":" in cleaned:
            target_host = cleaned

    if not target_host:
        raise HTTPException(status_code=400, detail="配对码格式无效，无法识别目标主机")

    if ":" not in target_host:
        target_host = f"{target_host}:{LAN_PORT}"

    probe_url = f"http://{target_host}/api/lan/room/info"
    if room_id:
        probe_url += f"?roomId={urllib.parse.quote(room_id)}"

    def _do_probe():
        try:
            req_obj = urllib.request.Request(probe_url, headers={"User-Agent": "XXDP-LAN-Client"})
            with urllib.request.urlopen(req_obj, timeout=3.5) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    return {"ok": True, "room": data.get("room")}
                return {"ok": False, "error": f"目标主机响应 HTTP {resp.status}"}
        except urllib.error.HTTPError as he:
            if he.code == 404:
                return {"ok": False, "error": "目标主机当前未开放协作房间，请房主先点击【启动局域网协作】"}
            return {"ok": False, "error": f"目标主机响应异常 (HTTP {he.code})"}
        except Exception as e:
            return {"ok": False, "error": f"无法连接目标主机 ({e})"}

    probe_res = await asyncio.to_thread(_do_probe)
    if not probe_res.get("ok"):
        raise HTTPException(status_code=404, detail=probe_res.get("error", "未能连接目标协作房间"))

    room_data = probe_res.get("room") or {}
    resolved_room_id = room_data.get("roomId") or room_id

    return {
        "ok": True,
        "targetHost": target_host,
        "roomId": resolved_room_id,
        "room": room_data,
        "pin": pin
    }

@app.post("/api/lan/host/invite")
async def lan_host_create_invite(req: LANCreateInviteRequest):
    """房主为指定同事创建 6 位专属验证码与固定色彩身份"""
    success, data_or_err, code = lan_manager.add_invite(req.displayName)
    if not success:
        raise HTTPException(status_code=code, detail=data_or_err)
    return {"ok": True, "invite": data_or_err, "room": lan_manager.get_host_room()}

@app.post("/api/lan/host/invite/toggle")
async def lan_host_toggle_invite(req: LANToggleInviteRequest):
    """房主启用或禁用指定成员的专属验证码"""
    success, data_or_err, code = lan_manager.toggle_invite(req.inviteId, req.enabled)
    if not success:
        raise HTTPException(status_code=code, detail=data_or_err)
    return {"ok": True, "invite": data_or_err, "room": lan_manager.get_host_room()}

@app.post("/api/lan/host/close")
async def lan_host_close_room():
    """主机关闭当前协作房间，并在关闭前最终将最新协同成果写回源画布"""
    if lan_manager.active_room:
        src_canvas_id = lan_manager.active_room.canvas_id
        if src_canvas_id and src_canvas_id != "lan_main":
            try:
                from app.services.lan_storage_service import load_canvas_snapshot
                _, lan_snap, _ = load_canvas_snapshot()
                if lan_snap and isinstance(lan_snap, dict):
                    src_canvas = await asyncio.to_thread(main.load_canvas_any, src_canvas_id)
                    if src_canvas and isinstance(src_canvas, dict):
                        src_canvas["nodes"] = lan_snap.get("nodes") or []
                        src_canvas["connections"] = lan_snap.get("connections") or lan_snap.get("edges") or []
                        if lan_snap.get("viewport"):
                            src_canvas["viewport"] = lan_snap.get("viewport")
                        if lan_snap.get("settings"):
                            src_canvas["settings"] = lan_snap.get("settings")
                        src_canvas["updated_at"] = int(time.time() * 1000)
                        await asyncio.to_thread(main.save_canvas, src_canvas)
                        print(f"[LAN Host] 关闭房间前成功最终写回源画布: {src_canvas_id}")
            except Exception as _sync_err:
                print(f"[LAN Host] 关闭房间写回源画布异常: {_sync_err}")

    closed = lan_manager.close_room()
    return {"ok": True, "room": closed.to_host_dict() if closed else None}

@lan_public_router.get("/discovery/rooms")
async def lan_get_discovered_rooms():
    """获取通过低频 UDP 广播自动发现的活跃协作房间"""
    rooms = lan_manager.get_discovered_rooms()
    return {"ok": True, "rooms": rooms}

@lan_public_router.post("/probe")
async def lan_probe_target(req: LANProbeRequest):
    """支持手动填入 IP 或 IP:端口探测局域网主机协作房间"""
    raw_target = req.target.strip()
    if not raw_target:
        raise HTTPException(status_code=400, detail="目标地址不能为空")

    target = raw_target
    if target.startswith("http://"):
        target_clean = target[7:]
    elif target.startswith("https://"):
        target_clean = target[8:]
    else:
        target_clean = target

    # 如果未指定端口，优先使用协作专用端口 LAN_PORT
    if ":" not in target_clean.split("/")[0]:
        target = f"{target_clean}:{LAN_PORT}"
    else:
        target = target_clean

    target_url = f"http://{target}"
    probe_url = f"{target_url.rstrip('/')}/api/lan/room/info"
    def _probe():
        try:
            req_obj = urllib.request.Request(probe_url, headers={"User-Agent": "XXDP-LAN-Client"})
            with urllib.request.urlopen(req_obj, timeout=2.5) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    return {"ok": True, "room": data.get("room"), "target": target}
                return {"ok": False, "error": f"HTTP {resp.status}"}
        except Exception as e:
            return {"ok": False, "error": f"无法连接到目标主机 ({e})"}

    res = await asyncio.to_thread(_probe)
    if not res.get("ok"):
        raise HTTPException(status_code=404, detail=res.get("error", "未找到协作服务"))
    # 严格保留实际探测连通的 target 地址，严禁被房间广播的内部虚拟网卡 IP 覆盖
    res["target"] = target
    return res

# 2. 局域网协作公共路由（挂载到 lan_app 与 app 上）
@lan_public_router.get("/room/info")
async def lan_get_public_room_info(roomId: Optional[str] = ""):
    """公共接口：获取房间公共信息（绝不透露验证码与画布数据）"""
    target_id = roomId.strip() if roomId else (lan_manager.active_room.room_id if lan_manager.active_room else "")
    if not target_id:
        raise HTTPException(status_code=404, detail="当前无开放的协作房间")
    info = lan_manager.get_public_room_info(target_id)
    if not info:
        raise HTTPException(status_code=404, detail="房间不存在或已关闭")
    return {"ok": True, "room": info}

@lan_public_router.post("/room/join")
async def lan_join_room(req: LANJoinRoomRequest):
    """协作者输入专属验证码加入房间：验证通过才绑定稳定身份并返回只读快照"""
    if not lan_manager.active_room or lan_manager.active_room.room_id != req.roomId:
        raise HTTPException(status_code=404, detail="房间不存在或已关闭")

    try:
        from app.services.lan_storage_service import load_canvas_snapshot
        _, canvas, _ = await asyncio.to_thread(load_canvas_snapshot)
        canvas = canvas if isinstance(canvas, dict) else {}
    except Exception:
        canvas = {}

    success, data_or_err, code = lan_manager.join_room(
        room_id=req.roomId,
        passcode=req.passcode,
        device_id=req.deviceId or "",
        device_name=req.deviceName or "",
        client_name=req.clientName or "协作者",
        canvas_data=canvas
    )
    if not success:
        raise HTTPException(status_code=code, detail=data_or_err)
    return data_or_err

@lan_public_router.post("/room/heartbeat")
async def lan_room_heartbeat(req: LANHeartbeatRequest):
    """心跳保活与成员在线状态拉取（必须携带有效且未过期 sessionId）"""
    session_id = (req.sessionId or "").strip()
    if not session_id:
        raise HTTPException(status_code=401, detail="缺少会话凭据 sessionId")
    success, data_or_err, code = lan_manager.heartbeat(req.roomId, req.memberId, session_id)
    if not success:
        raise HTTPException(status_code=code, detail=data_or_err)
    try:
        from app.services.lan_mesh_service import get_lan_client_ws_manager
        await get_lan_client_ws_manager().broadcast_event(
            "presence_update",
            lan_manager.get_room_presence(req.roomId, req.memberId) or {},
        )
    except Exception:
        pass
    return data_or_err

@lan_public_router.post("/room/leave")
async def lan_room_leave(req: LANLeaveRoomRequest):
    """协作者离开房间（必须携带有效且未过期 sessionId）"""
    session_id = (req.sessionId or "").strip()
    if not session_id:
        raise HTTPException(status_code=401, detail="缺少会话凭据 sessionId")
    success, data_or_err, code = lan_manager.leave_room(req.roomId, req.memberId, session_id)
    if not success:
        raise HTTPException(status_code=code, detail=data_or_err)
    return data_or_err

@lan_public_router.get("/room/snapshot")
async def lan_get_room_snapshot(
    roomId: str,
    memberId: str,
    sessionId: Optional[str] = "",
    x_session_id: Optional[str] = Header(None, alias="X-Session-Id")
):
    """受保护的只读快照获取：必须是已认证成员且持有同一 memberId 的有效 sessionId"""
    actual_session_id = (sessionId or x_session_id or "").strip()
    if not actual_session_id:
        raise HTTPException(status_code=401, detail="缺少会话凭据 sessionId")
    if not lan_manager.active_room or lan_manager.active_room.room_id != roomId:
        raise HTTPException(status_code=404, detail="房间不存在或已关闭")
    try:
        from app.services.lan_storage_service import load_canvas_snapshot
        _, canvas, _ = await asyncio.to_thread(load_canvas_snapshot)
        canvas = canvas if isinstance(canvas, dict) else {}
    except Exception:
        canvas = {}

    success, data_or_err, code = lan_manager.get_snapshot(roomId, memberId, actual_session_id, canvas)
    if not success:
        raise HTTPException(status_code=code, detail=data_or_err)
    return data_or_err

# 挂载受限协作公共路由
lan_app.include_router(lan_public_router)
app.include_router(lan_public_router)

# 后台运行受限的局域网独立服务
_lan_server = None
_lan_server_thread = None


def _probe_lan_server(timeout=0.4):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{LAN_PORT}/", timeout=timeout) as response:
            return response.status == 200
    except Exception:
        return False


def start_lan_server():
    global _lan_server, _lan_server_thread, _lan_ready, _lan_error
    if _lan_server is not None:
        return _lan_ready
    config = uvicorn.Config(lan_app, host=LAN_HOST, port=LAN_PORT, log_level="warning")
    _lan_server = uvicorn.Server(config)
    _lan_server_thread = threading.Thread(target=_lan_server.run, daemon=True)
    _lan_server_thread.start()

    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        if _probe_lan_server():
            _lan_ready = True
            _lan_error = ""
            print(f"[LAN] 局域网协作服务已就绪: http://127.0.0.1:{LAN_PORT}")
            return True
        if _lan_server_thread is not None and not _lan_server_thread.is_alive():
            break
        time.sleep(0.25)

    _lan_ready = False
    _lan_error = f"端口 {LAN_PORT} 未就绪，可能被其他程序占用或服务启动失败"
    print(f"[LAN] 警告：{_lan_error}。本机服务仍可使用，请检查端口后重启。")
    return False

def stop_lan_server():
    global _lan_server
    if _lan_server is not None:
        setattr(_lan_server, "should_exit", True)

async def on_app_startup():
    # 包装服务不能只复制 main.app 的路由；必须显式运行核心的启动初始化。
    os.environ.setdefault("PORT", str(PORT))
    os.environ.setdefault("LAN_PORT", str(LAN_PORT))
    startup = getattr(main, "startup_event", None)
    if startup is not None:
        result = startup()
        if inspect.isawaitable(result):
            await result
    # 广播地址应与实际受限协作端口一致，而不是核心默认的 3000。
    try:
        main.get_lan_discovery_service().set_http_port(LAN_PORT)
    except Exception as exc:
        print(f"[LAN] 设置广播端口失败: {exc}")
    start_lan_server()

async def on_app_shutdown():
    shutdown = getattr(main, "shutdown_event", None)
    if shutdown is not None:
        result = shutdown()
        if inspect.isawaitable(result):
            await result
    stop_lan_server()
    lan_manager.shutdown()

_app_startup_callbacks.append(on_app_startup)
_app_shutdown_callbacks.append(on_app_shutdown)

# ================= 首页项目管理与软删除/回收站 API (不暴露到 lan_app) =================
# ================= 首页项目管理与软删除/回收站 API (接管创建更新，共享统一锁，不暴露到 lan_app) =================
projects_rw_lock = threading.Lock()

class ProjectCreateReq(BaseModel):
    name: Optional[str] = "新项目"

class ProjectUpdateReq(BaseModel):
    name: Optional[str] = None
    order: Optional[int] = None
    favorite: Optional[bool] = None

def _get_canvas_counts() -> Dict[str, int]:
    """各项目活跃画布数；优先走 main 侧 mtime 缓存，避免列表接口反复扫盘。"""
    try:
        getter = getattr(main, "get_canvas_counts_by_project", None)
        if callable(getter):
            cached_counts = getter()
            if isinstance(cached_counts, dict):
                return cached_counts
    except Exception as exc:
        print(f"[Projects] 缓存统计画布数量失败，回退遍历: {exc}")
    counts: Dict[str, int] = {}
    try:
        for rec in main.iter_canvas_records(include_deleted=False):
            pid = str(rec.get("project") or "default").strip() or "default"
            counts[pid] = counts.get(pid, 0) + 1
    except Exception as exc:
        print(f"[Projects] 统计画布数量失败: {exc}")
    return counts


def _format_project_response(p: Dict[str, Any], canvas_count: int = 0) -> Dict[str, Any]:
    """保留项目所有原始字段（包括扩展字段），并规范标准字段与 canvas_count 契约"""
    rec = dict(p)
    rec["id"] = str(rec.get("id") or "").strip()
    rec["name"] = (str(rec.get("name") or "").strip() or "未命名项目")[:60]
    rec["order"] = int(rec.get("order") or 0)
    rec["favorite"] = bool(rec.get("favorite") or rec.get("is_favorite") or False)
    rec["created_at"] = int(rec.get("created_at") or 0)
    rec["updated_at"] = int(rec.get("updated_at") or 0)
    rec["canvas_count"] = int(canvas_count or 0)
    return rec


def _project_visible_to_current_account(project: Dict[str, Any]) -> bool:
    """项目与个人画布使用同一账号边界；历史无归属项目仅主账号/本机兼容模式可见。"""
    owner_id = str(project.get("owner_account_id") or "").strip()
    account_id = main.current_account_id()
    if owner_id:
        return bool(account_id and owner_id == account_id)
    return not account_id or account_id == "master"

def _load_projects_file() -> Tuple[List[Dict[str, Any]], bool]:
    """
    安全读取 projects.json 文件。
    返回 (projects_list, is_new_file)
    - 仅当文件不存在 (FileNotFound) 时返回 ([], True)，允许后续初始化默认项目。
    - 若文件存在但由于语法损坏、格式异常或读取错误导致解析失败，必须抛出 HTTPException(500)！
      严禁静默返回 []，绝对禁止覆写或破坏已有损坏数据！
    - 保留所有项目的已有扩展字段。
    """
    if not os.path.exists(main.PROJECTS_PATH):
        return [], True

    try:
        with open(main.PROJECTS_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as err:
        raise HTTPException(
            status_code=500,
            detail=f"项目数据文件损坏 (JSONDecodeError: {err})，为防止覆盖数据已终止操作"
        )
    except Exception as err:
        raise HTTPException(
            status_code=500,
            detail=f"项目数据文件不可读 ({type(err).__name__}: {err})，为防止覆盖数据已终止操作"
        )

    if isinstance(data, dict):
        raw_list = data.get("projects")
    elif isinstance(data, list):
        raw_list = data
    else:
        raise HTTPException(
            status_code=500,
            detail="项目数据文件格式错误（根结构既非字典也非列表），为防止覆盖数据已终止操作"
        )

    if not isinstance(raw_list, list):
        raise HTTPException(
            status_code=500,
            detail="项目数据文件 projects 字段不是列表，为防止覆盖数据已终止操作"
        )

    projects = []
    for item in raw_list:
        if not isinstance(item, dict) or not str(item.get("id", "")).strip():
            raise HTTPException(
                status_code=500,
                detail="项目数据中包含无效条目（缺少 ID 或结构非字典），为防止覆盖数据已终止操作"
            )
        projects.append(dict(item))

    return projects, False

def _save_projects_file(projects: List[Dict[str, Any]]) -> None:
    main.atomic_write_json(main.PROJECTS_PATH, {"projects": projects}, ensure_ascii=False, indent=2)

@app.get("/api/projects")
async def list_active_projects(include_deleted: bool = False):
    """获取项目列表（默认仅未移入回收站的活跃项目，与 LAN 和首页普通列表保持一致）"""
    def _get():
        counts = _get_canvas_counts()
        with projects_rw_lock:
            all_projects, is_new_file = _load_projects_file()

            if include_deleted:
                active_list = [p for p in all_projects if _project_visible_to_current_account(p)]
            else:
                active_list = [p for p in all_projects if _project_visible_to_current_account(p) and not p.get("deleted") and not p.get("deleted_at")]

            active_list.sort(key=lambda x: (int(x.get("order") or 0), int(x.get("created_at") or 0)))
            return [_format_project_response(p, counts.get(str(p.get("id") or ""), 0)) for p in active_list]

    projects = await asyncio.to_thread(_get)
    return {"projects": projects}

@app.get("/api/projects/trash")
async def list_trash_projects():
    """获取回收站中的软删除项目列表（按移入回收站时间倒序排序）"""
    def _get_trash():
        counts = _get_canvas_counts()
        with projects_rw_lock:
            all_projects, _ = _load_projects_file()
            trash = [p for p in all_projects if _project_visible_to_current_account(p) and (p.get("deleted") or p.get("deleted_at"))]
            trash.sort(key=lambda x: int(x.get("deleted_at") or x.get("updated_at") or 0), reverse=True)
            return [_format_project_response(p, counts.get(str(p.get("id") or ""), 0)) for p in trash]

    trash_projects = await asyncio.to_thread(_get_trash)
    return {"projects": trash_projects}

@app.post("/api/projects")
async def create_project_endpoint(payload: Optional[ProjectCreateReq] = None):
    """接管创建项目：共享 projects_rw_lock，保持返回契约含 canvas_count"""
    raw_name = payload.name if payload else "新项目"
    clean_name = (str(raw_name or "").strip() or "新项目")[:60]

    def _do_create():
        with projects_rw_lock:
            all_projects, is_new_file = _load_projects_file()
            ts = int(time.time() * 1000)
            order = max([int(p.get("order") or 0) for p in all_projects], default=0) + 1
            new_proj = {
                "id": uuid.uuid4().hex,
                "name": clean_name,
                "owner_account_id": main.current_account_id(),
                "order": order,
                "created_at": ts,
                "updated_at": ts
            }
            all_projects.append(new_proj)
            _save_projects_file(all_projects)
            return _format_project_response(new_proj, canvas_count=0)

    proj = await asyncio.to_thread(_do_create)
    return {"project": proj}

@app.post("/api/projects/{project_id}")
@app.put("/api/projects/{project_id}")
async def update_project_endpoint(project_id: str, payload: Optional[ProjectUpdateReq] = None):
    """接管更新项目：共享 projects_rw_lock，保持返回契约含 canvas_count"""
    clean_id = (project_id or "").strip()
    if not clean_id:
        raise HTTPException(status_code=400, detail="项目 ID 不能为空")

    def _do_update():
        counts = _get_canvas_counts()
        with projects_rw_lock:
            all_projects, _ = _load_projects_file()
            target = next((p for p in all_projects if p.get("id") == clean_id and _project_visible_to_current_account(p)), None)
            if not target:
                raise HTTPException(status_code=404, detail="项目不存在")
            if payload and payload.name is not None:
                target["name"] = (str(payload.name).strip() or target.get("name") or "未命名项目")[:60]
            if payload and payload.order is not None:
                target["order"] = int(payload.order)
            if payload and payload.favorite is not None:
                target["favorite"] = bool(payload.favorite)
            target["updated_at"] = int(time.time() * 1000)
            _save_projects_file(all_projects)
            return _format_project_response(target, canvas_count=counts.get(clean_id, 0))

    proj = await asyncio.to_thread(_do_update)
    return {"project": proj}

@app.post("/api/projects/{project_id}/favorite")
async def toggle_favorite_project_endpoint(project_id: str, payload: Optional[Dict[str, Any]] = None):
    """切换或设置项目收藏状态"""
    clean_id = (project_id or "").strip()
    if not clean_id:
        raise HTTPException(status_code=400, detail="项目 ID 不能为空")

    def _do_toggle():
        counts = _get_canvas_counts()
        with projects_rw_lock:
            all_projects, _ = _load_projects_file()
            target = next((p for p in all_projects if p.get("id") == clean_id and _project_visible_to_current_account(p)), None)
            if not target:
                raise HTTPException(status_code=404, detail="项目不存在")
            if payload and "favorite" in payload:
                target["favorite"] = bool(payload["favorite"])
            else:
                target["favorite"] = not bool(target.get("favorite") or target.get("is_favorite"))
            target["updated_at"] = int(time.time() * 1000)
            _save_projects_file(all_projects)
            return _format_project_response(target, canvas_count=counts.get(clean_id, 0))

    proj = await asyncio.to_thread(_do_toggle)
    return {"ok": True, "project": proj}

@app.post("/api/projects/{project_id}/trash")
async def trash_project_endpoint(project_id: str):
    """软删除项目：保留画布归属及媒体资产"""
    clean_id = (project_id or "").strip()
    if not clean_id:
        raise HTTPException(status_code=400, detail="项目 ID 不能为空")

    def _do_trash():
        counts = _get_canvas_counts()
        with projects_rw_lock:
            all_projects, _ = _load_projects_file()
            target = next((p for p in all_projects if p.get("id") == clean_id and _project_visible_to_current_account(p)), None)
            if not target:
                raise HTTPException(status_code=404, detail="项目不存在")
            now_ms = int(time.time() * 1000)
            target["deleted"] = True
            target["deleted_at"] = now_ms
            target["updated_at"] = now_ms
            _save_projects_file(all_projects)
            return _format_project_response(target, canvas_count=counts.get(clean_id, 0))

    target = await asyncio.to_thread(_do_trash)
    return {"ok": True, "project": target}


def _collect_project_local_media_urls(value, found=None):
    if found is None:
        found = set()
    if isinstance(value, dict):
        for child in value.values():
            _collect_project_local_media_urls(child, found)
    elif isinstance(value, list):
        for child in value:
            _collect_project_local_media_urls(child, found)
    elif isinstance(value, str):
        text = value.strip()
        if text.startswith(("/assets/", "/output/", "/api/storage-files/")):
            found.add(text)
    return found


def _purge_project_canvas_files(project_id: str) -> dict:
    """永久删除项目关联画布、备份、协作快照及其不再使用的媒体。"""
    project_id = str(project_id or "").strip()
    if not project_id:
        return {"canvases": 0, "backups": 0, "snapshots": 0, "media": 0}

    canvas_files = []
    media_paths = set()
    canvas_ids = set()
    roots = [main.CANVAS_DIR, os.path.join(main.DATA_DIR, "collaboration_canvases")]
    for root in roots:
        if not os.path.isdir(root):
            continue
        for current, _dirs, files in os.walk(root):
            if os.path.abspath(root) == os.path.abspath(main.CANVAS_DIR):
                _dirs[:] = [item for item in _dirs if item != "backups"]
            for filename in files:
                if not filename.endswith(".json"):
                    continue
                path = os.path.join(current, filename)
                try:
                    with open(path, "r", encoding="utf-8") as handle:
                        data = json.load(handle) or {}
                except Exception:
                    continue
                if str(data.get("project") or "") != project_id:
                    continue
                if not main.canvas_visible_to_current_account(data):
                    continue
                canvas_files.append((root, path))
                canvas_ids.add(str(data.get("id") or os.path.splitext(filename)[0]))
                for url in _collect_project_local_media_urls(data):
                    media_path = main.output_file_from_url(url)
                    if media_path and os.path.isfile(media_path):
                        media_paths.add(os.path.abspath(media_path))

    removed_canvases = 0
    removed_snapshots = 0
    for root, path in canvas_files:
        try:
            from app.services.media_protect import clear_media_readonly
            clear_media_readonly(path)
            os.remove(path)
            if os.path.abspath(root) == os.path.abspath(main.CANVAS_DIR):
                removed_canvases += 1
            else:
                removed_snapshots += 1
        except OSError:
            continue

    removed_backups = 0
    backup_root = os.path.join(main.CANVAS_DIR, "backups")
    if os.path.isdir(backup_root):
        for filename in os.listdir(backup_root):
            if not filename.endswith(".json"):
                continue
            if not any(filename.startswith(f"{canvas_id}.") for canvas_id in canvas_ids):
                continue
            path = os.path.join(backup_root, filename)
            try:
                from app.services.media_protect import clear_media_readonly
                clear_media_readonly(path)
                os.remove(path)
                removed_backups += 1
            except OSError:
                continue

    removed_media = 0
    for path in media_paths:
        result = main._safe_delete_user_media(path)
        if result.get("action") == "deleted":
            removed_media += 1
    return {
        "canvases": removed_canvases,
        "backups": removed_backups,
        "snapshots": removed_snapshots,
        "media": removed_media,
    }

@app.delete("/api/projects/{project_id}")
async def delete_project_endpoint(project_id: str, permanent: bool = False):
    """删除项目：若在回收站中或指定 permanent 则彻底物理删除；否则软删除移入回收站"""
    clean_id = (project_id or "").strip()
    if not clean_id:
        raise HTTPException(status_code=400, detail="项目 ID 不能为空")

    def _do():
        counts = _get_canvas_counts()
        with projects_rw_lock:
            all_projects, _ = _load_projects_file()
            target = next((p for p in all_projects if p.get("id") == clean_id and _project_visible_to_current_account(p)), None)
            if not target:
                raise HTTPException(status_code=404, detail="项目不存在")

            is_already_trash = bool(target.get("deleted") or target.get("deleted_at"))
            if permanent or is_already_trash:
                # 彻底物理删除项目
                all_projects = [p for p in all_projects if p.get("id") != clean_id]
                _save_projects_file(all_projects)
                with main.CANVAS_LOCK:
                    cleanup = _purge_project_canvas_files(clean_id)
                return {"ok": True, "deleted": True, "permanent": True, "cleanup": cleanup}
            else:
                now_ms = int(time.time() * 1000)
                target["deleted"] = True
                target["deleted_at"] = now_ms
                target["updated_at"] = now_ms
                _save_projects_file(all_projects)
                return {"ok": True, "project": _format_project_response(target, canvas_count=counts.get(clean_id, 0))}

    res = await asyncio.to_thread(_do)
    return res

@app.post("/api/projects/{project_id}/restore")
async def restore_project_endpoint(project_id: str):
    """从回收站恢复项目：保留原画布归属及媒体"""
    clean_id = (project_id or "").strip()
    if not clean_id:
        raise HTTPException(status_code=400, detail="项目 ID 不能为空")

    def _do_restore():
        counts = _get_canvas_counts()
        with projects_rw_lock:
            all_projects, _ = _load_projects_file()
            target = next((p for p in all_projects if p.get("id") == clean_id and _project_visible_to_current_account(p)), None)
            if not target:
                raise HTTPException(status_code=404, detail="项目不存在")
            now_ms = int(time.time() * 1000)
            target["deleted"] = False
            target.pop("deleted_at", None)
            target["updated_at"] = now_ms
            _save_projects_file(all_projects)
            return _format_project_response(target, canvas_count=counts.get(clean_id, 0))

    target = await asyncio.to_thread(_do_restore)
    return {"ok": True, "project": target}

# ================= 挂载 XXDP 成熟后端全部 API 路由 (资产库/工作流/素材上传/本地素材/历史等) =================
# 核心模块历史上同时保留了模块化 router 与兼容旧接口，复制前先去重，避免同一路由依赖注册顺序。
_seen_main_route_keys = set()
_deduped_main_routes = []
for _route in main.app.routes:
    _key = (getattr(_route, 'path', ''), tuple(sorted(getattr(_route, 'methods', None) or [])))
    if _key in _seen_main_route_keys and _key[0].startswith('/api/'):
        continue
    _seen_main_route_keys.add(_key)
    _deduped_main_routes.append(_route)
main.app.routes[:] = _deduped_main_routes
_existing_route_keys = {(getattr(r, 'path', ''), tuple(sorted(getattr(r, 'methods', None) or []))) for r in app.routes}
_mounted_xxdp_count = 0
for route in _deduped_main_routes:
    path = getattr(route, 'path', '')
    methods = tuple(sorted(getattr(route, 'methods', None) or []))
    if path.startswith('/api/') and (path, methods) not in _existing_route_keys:
        app.routes.append(route)
        _existing_route_keys.add((path, methods))
        _mounted_xxdp_count += 1
print(f"[XXDP API 适配层] 成功接入 XXDP 成熟后端 API 路由 {_mounted_xxdp_count} 个")

# 挂载局域网协同 CRDT 与 WebSocket 路由 (lan_router)
# FastAPI 0.141+ 将 include_router 存为 _IncludedRouter（path 为空），上方按 path 前缀
# 复制 /api/* 不会带入 lan_router；因此必须在此显式挂载。若已按 router 身份挂过则跳过，
# 避免同一 CRDT 路由表被注册两次。lan_app 不走 XXDP 复制，需单独挂载。
try:
    from app.routers.lan_router import router as lan_crdt_router

    def _app_has_lan_crdt_router(target_app) -> bool:
        markers = {"/api/lan/ops", "/api/lan/presence", "/api/lan/client/ws", "/api/lan/status"}
        for r in target_app.routes:
            if str(getattr(r, "path", "") or "") in markers:
                return True
            if type(r).__name__ == "_IncludedRouter":
                ctx = getattr(r, "include_context", None)
                if ctx is not None and getattr(ctx, "included_router", None) is lan_crdt_router:
                    return True
        return False

    _public_had_lan_crdt = _app_has_lan_crdt_router(app)
    if not _public_had_lan_crdt:
        app.include_router(lan_crdt_router)
    _lan_app_had_lan_crdt = _app_has_lan_crdt_router(lan_app)
    if not _lan_app_had_lan_crdt:
        lan_app.include_router(lan_crdt_router)
    print(
        f"[LAN CRDT 适配层] 成功接入局域网协同 WebSocket 与画布同步路由 "
        f"({len(lan_crdt_router.routes)} 个端点; "
        f"public_skipped={_public_had_lan_crdt}, lan_app_skipped={_lan_app_had_lan_crdt})"
    )
except Exception as _lan_err:
    print(f"[LAN CRDT 适配层] 挂载失败: {_lan_err}")

# 8910 补充协作主页所需的业务 API，但不挂载完整主应用。
# 只接入画布、素材、生成和协作所需接口，不暴露管理接口。
_LAN_HOME_ROUTE_PREFIXES = (
    # 认证、账号上下文与基础读取
    "/api/auth/", "/api/config", "/api/providers",
    # 项目、画布与协作画布数据
    "/api/projects", "/api/canvases", "/api/canvas-api-settings",
    # 画布媒体与素材
    "/api/local-assets", "/api/canvas-assets", "/api/asset-library",
    "/api/storage-files", "/api/media-trash", "/api/media", "/api/media-preview", "/api/video-playback",
    "/api/download-output", "/api/ai/upload", "/api/ai/import-local-image",
    "/api/upload", "/api/cloud-video/upload",
    # 画布生成能力（图片/视频/文本/第三方工作流）
    "/api/canvas-image-tasks", "/api/canvas-image-batches", "/api/canvas-video",
    "/api/canvas-video-tasks", "/api/queue_status",
    "/api/canvas-llm", "/api/canvas-comfy-tasks", "/api/runninghub",
    "/api/generate", "/api/angle/generate", "/api/ms/generate",
    # 提示词模板与工作流归档
    "/api/smart-canvas", "/api/workflows", "/api/canvas-workflows",
    # 历史记录与客户端心跳
    "/api/history", "/api/app/heartbeat",
    "/api/cli/", "/api/codex/", "/api/gemini-cli/",
    # 静态与产出文件
    "/assets/", "/output/",
)
_lan_existing_route_keys = {
    (getattr(route, "path", ""), tuple(sorted(getattr(route, "methods", None) or [])))
    for route in lan_app.routes
}
for _route in app.routes:
    _path = str(getattr(_route, "path", "") or "")
    _methods = tuple(sorted(getattr(_route, "methods", None) or []))
    if not _path.startswith(_LAN_HOME_ROUTE_PREFIXES):
        continue
    _key = (_path, _methods)
    if _key in _lan_existing_route_keys:
        continue
    lan_app.routes.append(_route)
    _lan_existing_route_keys.add(_key)

# 注册局域网协作历史快照生命周期管理（启动时自动清理超过7天的临时备份与废弃分片）
def _prune_lan_snapshots_on_startup():
    try:
        from app.services.lan_storage_service import prune_stale_lan_snapshots
        res = prune_stale_lan_snapshots(max_age_days=7)
        if res.get("totalPrunedCount", 0) > 0:
            print(f"[LAN 存储生命周期] 启动自动清理完成: 清理过期文件 {res['totalPrunedCount']} 个，释放空间 {res['totalBytesFreed']} 字节")
    except Exception as e:
        print(f"[LAN 存储生命周期] 自动清理触发异常（已安全忽略）: {e}")

_app_startup_callbacks.append(_prune_lan_snapshots_on_startup)

def run():
    os.chdir(ROOT_DIR)
    print(f"==================================================")
    print(f"  小小办公 桌面端服务 (含 AI 图片与视频生成引擎) 已就绪")
    print(f"  本机管理控制台: http://127.0.0.1:{PORT}")
    print(f"  局域网协作受限服务: http://{LAN_HOST}:{LAN_PORT} (严格仅限协作专用接口)")
    print(f"  根目录: {ROOT_DIR}")
    print(f"==================================================")
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")

if __name__ == '__main__':
    run()
