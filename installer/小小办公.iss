; 小小办公正式 Windows 安装程序
; 使用 Inno Setup 编译。用户数据不随安装包覆盖。

#define AppName "小小办公"
#define AppVersion "1.0.0"
#define AppPublisher "小小办公"
#define AppExeName "小小办公.exe"
#define AppRoot "D:\小小办公"
#ifndef AppSource
#define AppSource "D:\小小办公"
#endif

[Setup]
AppId={{5A27B2AA-4C9E-4C5D-9D1A-202609170001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\{#AppName}
DisableProgramGroupPage=no
DefaultGroupName={#AppName}
UninstallDisplayIcon={app}\{#AppExeName}
OutputDir={#AppRoot}\release
OutputBaseFilename={#AppName}-安装程序-v{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
VersionInfoVersion={#AppVersion}.0
VersionInfoProductVersion={#AppVersion}.0
VersionInfoDescription={#AppName}安装程序
VersionInfoProductName={#AppName}
VersionInfoCompany={#AppPublisher}
Uninstallable=yes

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："; Flags: unchecked

[Files]
; 程序文件全部安装到用户选择的目录。
; data/assets/output/workflows 是用户数据目录，不能从发布包覆盖。
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "data\*;assets\*;output\*;workflows\*;__pycache__\*;.git\*;.pytest_cache\*;data\build_exe\*;release\*;installer\*;*.log;*.pyc;*.pyo"

[Dirs]
; 这些目录由程序使用，但安装时保持为空，首次运行时继续沿用现有路径约定。
Name: "{app}\data"
Name: "{app}\data\canvases"
Name: "{app}\data\media_previews"
Name: "{app}\data\runtime"
Name: "{app}\assets"
Name: "{app}\assets\input"
Name: "{app}\assets\library"
Name: "{app}\assets\output"
Name: "{app}\assets\uploads"
Name: "{app}\output"
Name: "{app}\workflows"

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\卸载{#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "启动{#AppName}"; Flags: nowait postinstall skipifsilent
