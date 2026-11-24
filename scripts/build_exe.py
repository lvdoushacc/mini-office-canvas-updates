# -*- coding: utf-8 -*-
import os
import sys
import json
import shutil
import subprocess

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION_FILE = os.path.join(ROOT_DIR, "VERSION.json")
ICON_FILE = os.path.join(ROOT_DIR, "static", "images", "logo.ico")
LAUNCHER_FILE = os.path.join(ROOT_DIR, "launcher.pyw")
BUILD_DIR = os.path.join(ROOT_DIR, "data", "build_exe")

def read_version():
    try:
        with open(VERSION_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return str(data.get("version", "1.0.0")).strip()
    except Exception:
        return "1.0.0"

def create_version_info_file(version_str, target_path):
    parts = version_str.split(".")
    while len(parts) < 4:
        parts.append("0")
    try:
        v_tuple = tuple(int(p) for p in parts[:4])
    except ValueError:
        v_tuple = (1, 0, 0, 0)

    content = f"""# UTF-8
#
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers={v_tuple},
    prodvers={v_tuple},
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo(
      [
        StringTable(
          '080404b0',
          [
            StringStruct('CompanyName', '小小办公'),
            StringStruct('FileDescription', '小小办公桌面客户端'),
            StringStruct('FileVersion', '{version_str}'),
            StringStruct('InternalName', '小小办公'),
            StringStruct('LegalCopyright', 'Copyright (C) 2026 小小办公'),
            StringStruct('OriginalFilename', '小小办公.exe'),
            StringStruct('ProductName', '小小办公'),
            StringStruct('ProductVersion', '{version_str}')
          ]
        )
      ]
    ),
    VarFileInfo([VarStruct('Translation', [2052, 1200])])
  ]
)
"""
    with open(target_path, "w", encoding="utf-8") as f:
        f.write(content)

def build():
    version = read_version()
    print("==================================================")
    print(f"  开始构建 小小办公.exe (v{version})")
    print("==================================================")

    os.makedirs(BUILD_DIR, exist_ok=True)
    version_info_path = os.path.join(BUILD_DIR, "version_info.txt")
    create_version_info_file(version, version_info_path)

    dist_dir = os.path.join(BUILD_DIR, "dist")
    work_dir = os.path.join(BUILD_DIR, "build")
    spec_dir = BUILD_DIR

    # 寻找 PyInstaller 可执行程序
    pyinstaller = shutil.which("pyinstaller")
    if not pyinstaller:
        candidates = [
            os.path.join(sys.prefix, "Scripts", "pyinstaller.exe"),
            r"C:\Users\绿豆鲨\AppData\Local\Programs\Python\Python311\Scripts\pyinstaller.exe"
        ]
        for c in candidates:
            if os.path.exists(c):
                pyinstaller = c
                break

    if not pyinstaller:
        print("[错误] 未找到 pyinstaller，请先安装：pip install pyinstaller")
        sys.exit(1)

    print(f"使用 PyInstaller: {pyinstaller}")

    cmd = [
        pyinstaller,
        "--noconsole",
        "--onefile",
        "--clean",
        "--name=小小办公",
        f"--icon={ICON_FILE}",
        f"--version-file={version_info_path}",
        f"--distpath={dist_dir}",
        f"--workpath={work_dir}",
        f"--specpath={spec_dir}",
        LAUNCHER_FILE
    ]

    print("执行打包命令:")
    print(" ".join(cmd))
    res = subprocess.run(cmd, cwd=ROOT_DIR)
    if res.returncode != 0:
        print(f"[错误] PyInstaller 打包失败，退出码: {res.returncode}")
        sys.exit(res.returncode)

    built_exe = os.path.join(dist_dir, "小小办公.exe")
    target_exe = os.path.join(ROOT_DIR, "小小办公.exe")

    if not os.path.exists(built_exe):
        print(f"[错误] 未在目标目录找到构建成果: {built_exe}")
        sys.exit(1)

    shutil.copy2(built_exe, target_exe)
    size_mb = os.path.getsize(target_exe) / (1024 * 1024)
    print("--------------------------------------------------")
    print("构建成功！")
    print(f"输出路径: {target_exe}")
    print(f"文件大小: {size_mb:.2f} MB")
    print("==================================================")

if __name__ == "__main__":
    build()
