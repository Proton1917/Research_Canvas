# Research Canvas 安装与使用

Research Canvas 0.1.1 提供 macOS Apple Silicon 与 Intel 发行包，Windows 和 Linux 当前发行包为 0.1.0。发行包包含后端程序与编译后的界面，使用浏览器访问本机服务。工作区、文稿、PDF、讨论和历史版本保存在解压目录中。

## 下载与选择

打开 [GitHub Releases](https://github.com/Proton1917/Research_Canvas/releases)，下载适合当前系统和处理器的文件。

| 系统 | 发行文件 | 启动入口 |
| --- | --- | --- |
| Windows 10/11，x64 | `research-canvas-0.1.0-windows-x64.zip` | `start.cmd` |
| macOS 13 及以上，Apple Silicon | `research-canvas-0.1.1-macos-arm64.zip` | `Start.command` 或 `bash start.sh` |
| macOS 13 及以上，Intel | `research-canvas-0.1.1-macos-x64.zip` | `Start.command` 或 `bash start.sh` |
| Linux x64，glibc 2.35 及以上 | `research-canvas-0.1.0-linux-x64.tar.gz` | `bash start.sh` |

macOS 的处理器信息位于“苹果菜单 → 关于本机”；显示 Apple M 系列时选 arm64，显示 Intel 时选 x64。Windows 可在“设置 → 系统 → 系统信息”查看系统类型。Linux 可运行 `uname -m` 查看，`x86_64` 对应 x64。

macOS 安装包位于 [0.1.1 发行页](https://github.com/Proton1917/Research_Canvas/releases/tag/v0.1.1)，Windows 与 Linux 安装包位于 [0.1.0 发行页](https://github.com/Proton1917/Research_Canvas/releases/tag/v0.1.0)。

GitHub 页面附带的 `Source code` 是开发源码压缩包。直接使用应用时，下载上表对应的发行文件。

## Windows

1. 在资源管理器中对 ZIP 选择“全部解压”，将整个目录放到可写位置，例如用户的“文档”目录。
2. 打开解压后的目录，双击 `start.cmd`。首次启动会建立 `config/server.toml` 和数据目录。
3. 保持服务窗口运行，在 Edge、Chrome 或 Firefox 中打开 **http://127.0.0.1:8787**。
4. 停止时回到服务窗口按 `Ctrl+C`；若命令提示符询问是否终止批处理，输入 `Y`。

也可以在该目录打开 PowerShell 后运行：

```powershell
.\start.cmd
```

发行包采用便携式目录，程序及数据放在当前目录。系统若提示发布者未知，请核对下载仓库与版本，再按系统提供的运行选项处理。

### Windows PDF 导入

在终端中安装 Poppler：

```powershell
winget install --id oschwartz10612.Poppler -e --source winget
```

安装完成后重新打开终端，确认命令可用：

```powershell
pdftotext -v
```

随后重新启动 Research Canvas。WinGet 会处理该软件声明的运行库依赖。手动安装时，从 [Poppler Windows 发行页](https://github.com/oschwartz10612/poppler-windows/releases) 下载并解压，将包含 `pdftotext.exe` 的 `Library\bin` 目录加入用户 `Path`，再重新打开终端。

## macOS

1. 下载适合处理器的 ZIP，双击完整解压。
2. 将目录放到可写位置，打开 `Start.command`。也可以在终端进入该目录后运行 `bash start.sh`。
3. 保持终端窗口运行，在浏览器打开 **http://127.0.0.1:8787**。
4. 停止时在终端按 `Ctrl+C`。

本版本的便携程序未做 Apple 公证。首次运行被系统拦截时，确认文件来自本仓库后，在“系统设置 → 隐私与安全性”中按提示允许该程序运行。

PDF 导入需要 Poppler。已有 Homebrew 时执行：

```bash
brew install poppler
pdftotext -v
```

Homebrew 的安装入口为 [brew.sh](https://brew.sh/)。安装 Poppler 后重新启动 Research Canvas。

## Linux

以 Ubuntu 22.04 及以上为例：

```bash
tar -xzf research-canvas-0.1.0-linux-x64.tar.gz
cd research-canvas-0.1.0-linux-x64
bash start.sh
```

在浏览器打开 **http://127.0.0.1:8787**，停止时在终端按 `Ctrl+C`。程序运行目录需要可写权限。

PDF 导入工具在 Ubuntu/Debian 上通过以下命令安装：

```bash
sudo apt-get update
sudo apt-get install poppler-utils
pdftotext -v
```

Fedora 可使用 `sudo dnf install poppler-utils`。其他发行版从系统软件源安装提供 `pdftotext` 的 Poppler 工具包。

## 首次使用与模型连接

进入页面后，新建工作区，导入 Markdown、文本、图片或 PDF，将文稿和片段放入画布。模型服务尚未接通时，文稿编辑、画布组织、保存和导出仍可使用。PDF 导入依赖前述 Poppler。

发行包默认配置连接本机 Router OAuth 服务：

| 配置项 | 默认值 |
| --- | --- |
| `provider.protocol` | `anthropic_messages` |
| `provider.base_url` | `http://127.0.0.1:43177/v1` |
| `provider.default_model` | `cc/gemini-3.8-flash-high` |
| `provider.allowed_models` | 包含上述模型标识 |

使用这组配置时，先启动自己的 Router 服务并完成相应 OAuth 登录，再启动 Research Canvas。Router 是独立的模型服务，发行包中的客户端标记用于本机请求匹配；OAuth 登录由 Router 管理。

使用其他已有的模型服务时，停止 Research Canvas，用文本编辑器打开 `config/server.toml`，按照该服务提供的接口地址和模型目录修改配置：

1. Anthropic Messages 协议使用 `anthropic_messages`；Chat Completions 协议使用 `chat_completions`。
2. `base_url` 填入该服务提供的 API 基础地址；`default_model` 和 `allowed_models` 使用其模型目录中的准确标识。
3. API Key 认证可设置 `api_key_environment = "RESEARCH_CANVAS_API_KEY"`。此时根据所用服务调整 `headers`，并在启动服务的终端设置同名环境变量。
4. 保存后重新启动。在界面读取到模型目录后，选中实际材料发起讨论，查看运行状态及回答。

Windows PowerShell 可交互输入 API Key，再启动程序：

```powershell
$env:RESEARCH_CANVAS_API_KEY = Read-Host '输入模型服务的 API Key'
.\start.cmd
```

macOS/Linux 可在 Bash 中交互输入：

```bash
read -r -s -p '输入模型服务的 API Key: ' RESEARCH_CANVAS_API_KEY
export RESEARCH_CANVAS_API_KEY
bash start.sh
```

模型调用的实测通道为本机 Router OAuth Gemini 3.8 Flash。其他服务需具备所配置协议；画布生成还需要支持工具调用与结构化工具参数。

## 数据位置与升级

| 内容 | 位置 |
| --- | --- |
| 本机服务配置 | `config/server.toml` |
| 工作区、文稿、PDF、版本及讨论 | `.runtime/data/research-canvas.sqlite3` |
| 临时 PDF 提取目录 | `tmp/backend/` |
| 模型提示词 | `config/prompts/` |

升级前保存一份当前工作区的 JSON 或 ZIP 可恢复归档；已有适用归档时可复用。停止旧版服务，将新版完整解压到新目录，再复制旧目录的 `config/server.toml` 和 `.runtime/data/`。数据目录中的 SQLite 文件应在服务停止后整体复制。新版本启动时执行数据库迁移，确认工作区和文稿可读取后，再处理旧目录。

从 0.1.0 升级并使用图像输入时，将新版 `config/server.example.toml` 中的输入设置补入旧配置的 `[provider]`。本机 Router 示例为：

```toml
max_input_characters = 240000
vision_models = ["cc/gemini-3.8-flash-high"]
max_input_image_bytes = 20971520
```

`vision_models` 填写服务实际支持图像输入的模型标识；两个上限分别按文本字符数和图像字节数计算。已有配置中的地址、凭据环境变量和模型选择继续沿用。

归档恢复保留工作区标识。目标后端已存在同一标识时会返回 409；需要在空缺该工作区的后端实例中恢复。

## 常见问题

| 现象 | 处理方式 |
| --- | --- |
| 页面无法连接 | 确认启动窗口仍在运行，查看其中的启动地址及错误信息。 |
| 提示端口被占用 | 停止占用 8787 的旧实例；或修改 `config/server.toml` 的 `port`，并同步修改 `allowed_origins` 中对应的页面地址。 |
| 找不到配置或界面 | 保留完整解压目录并通过其中的启动脚本运行；程序需要同目录的 `config/` 与 `dist/`。 |
| PDF 导入提示缺少工具 | 安装 Poppler，确认 `pdftotext -v` 可执行，然后重启服务。 |
| 扫描 PDF 没有文本 | 当前导入提取已有文字层；扫描件需先通过 OCR 获得文字层。 |
| 模型目录或生成失败 | 检查模型服务是否启动、OAuth 是否有效、接口协议、模型允许列表及所需环境变量。 |
| 保存或提案返回版本冲突 | 保留本地编辑，读取当前服务端版本后按界面提示处理冲突。 |

## 从源码构建

源码构建需要 Rust 1.96、Node 22.23.4，以及 PDF 工具 Poppler。依赖按仓库锁文件安装。

macOS/Linux 在安装 Rust、Node/npm 和 Poppler 后执行：

```bash
git clone https://github.com/Proton1917/Research_Canvas.git
cd Research_Canvas
cp -n config/server.example.toml config/server.toml
npm install --prefix .runtime/toolchain --cache .runtime/npm-cache --no-save --package-lock=false --no-audit --no-fund node@22.23.4
bash scripts/web.sh install
bash scripts/build.sh
bash scripts/backend.sh start
```

Windows 源码构建使用 Rust 的 MSVC 工具链和 Visual Studio C++ Build Tools。可通过 [Rust 安装页](https://www.rust-lang.org/tools/install)、[Node 22.23.4 安装程序](https://nodejs.org/dist/v22.23.4/node-v22.23.4-x64.msi) 和 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 安装，并在 Build Tools 中选择 C++ 桌面开发工具。随后在 PowerShell 中执行：

```powershell
git clone https://github.com/Proton1917/Research_Canvas.git
cd Research_Canvas
Copy-Item config/server.example.toml config/server.toml
node .yarn/releases/yarn-4.7.0.cjs install --immutable
node .yarn/releases/yarn-4.7.0.cjs build
cargo build --release --locked
.\target\release\research-canvas.exe
```

同一版本的发行包由同一源码提交构建。发行构建工作流会从解压后的目录启动应用，验证页面资源、文稿与 PDF 导入、JSON/ZIP 导出及停止服务。项目自有代码采用 MPL-2.0，发行包内的依赖版权与许可告知位于 `licenses/`。
