# Research Canvas 发行与下载镜像

发行目标为 Windows x64、macOS Apple Silicon 与 Linux x64。GitHub Actions 的 `.github/workflows/release.yml` 使用 `platforms=desktop` 构建 Windows 与 macOS ARM64，使用 `platforms=linux` 单独构建 Linux x64。下载镜像提供安装包，Research Canvas 在用户本机运行。

产品网站为 `https://mathana.homes/`，`#download` 提供下载入口，`#ai` 提供模型接入说明。页面源码位于 `site/index.html`，直接发布到 `/var/www/mathana-canvas/index.html`。该页面为独立静态 HTML，沿用内嵌样式与脚本。发行时同步首页、下载文件名、大小、链接、页脚源码提交和与产品版本相关的接入说明，并查看真实渲染及下载结果。

2026-11-04 的 0.1.4 页面验收通过 Safari 查看桌面下载区与接入说明，以及 390 × 844 响应式视口。地址复制操作显示成功，窄屏 API 地址完整换行。页面脚本通过 `node --check`。从 `mathana.homes` 完整下载 Windows 和 macOS 安装包后，大小与传输摘要均与 GitHub 发行资产一致。截图及传输记录保存在 `tmp/mathana-release/`。

## 构建与发行

在仓库根目录更新 Cargo.toml、Cargo.lock、package.json 及安装说明中的发行版本，提交集成代码后，手动触发对应平台的发行工作流。记录构建对应的提交、工作流运行地址和原生平台的验收结果。工作流生成 `release-windows-x64`、`release-macos-arm64` 或 `release-linux-x64` artifacts，下载到项目 `.runtime/releases/<版本>/`。

`scripts/release_smoke.py` 验证解压启动、初始配置、设置接口读写及本地覆盖文件、页面资源、能力、资料导入导出和正常停止。`provider_settings` 检查按原值保存，验证修订号加一、读取结果和覆盖文件，Unix 同时检查 0600 权限。该项在各平台原生 runner 执行，连接测试由实际模型联调承担。

创建对应版本的 GitHub Release，上传 Windows、macOS 的 ZIP 与 Linux 的 tar.gz，发行说明列出平台、启动入口及该版本实际验证结果。各平台包内 SOURCE_COMMIT、VERSION 记录实际构建提交与版本，同一发行补充平台时在发行说明中分别列出构建提交。

## 镜像主机与路径

| 对象 | 位置 |
| --- | --- |
| SSH | `ubuntu@43.134.72.176:22` |
| 本机私钥引用 | `/Users/gordongauerk/Projects/Mathematical-Industry-Agent/.local/m1-server/ssh-key` |
| 上传暂存目录 | `/home/ubuntu/mia-m1-stage/research-canvas-<版本>/` |
| 公网文件目录 | `/var/www/matharc-resolve/downloads/research-canvas/<版本>/` |
| 下载配置 | `/etc/nginx/snippets/research-canvas-downloads.conf` |
| 产品站点配置 | `/etc/nginx/sites-available/mathana-canvas.conf` |
| 兼容下载站点配置 | `/etc/nginx/sites-available/matharc-resolve.conf` |
| 本地操作材料 | `.runtime/releases/server-downloads/` |

连接使用 `IdentitiesOnly=yes`、`BatchMode=yes`、`StrictHostKeyChecking=yes`、`UpdateHostKeys=no`，维护命令使用 `sudo -n`。私钥通过上述路径引用，留在本机。站点还承载 `mia-m1.service`，下载配置只管理 Research Canvas 的静态 URL。

## 上传与启用

1. 读取服务器当前下载片段与站点配置，确认 include 位置和当前公开版本。复用本地或暂存目录中的适用配置原件；确需新副本时，按项目备份约定核对并轮换，最多保留两份有效恢复副本。
2. 使用相同 SSH 选项将本次两个 ZIP 上传到本次暂存目录。跨设备传输核对本地与远端文件的字节数和 SHA-256，摘要范围为本次传输文件。
3. 用 `sudo -n install -d` 建立本次公网版本目录，`sudo -n install -m 0644` 放入两个已核对的 ZIP。相同版本路径对应同一发行内容，修订发行内容使用新版本路径。
4. 根据服务器当前片段，在项目目录用文件编辑工具生成修改件，保留此前公开版本，追加本次两个精确 URL。上传修改件后以 `sudo -n install -m 0644` 安装片段。
5. 执行 `sudo -n nginx -t`，通过后执行 `sudo -n systemctl reload nginx`。核对 `nginx`、`mia-m1.service` 状态及现有网站 `/api/health`。
6. 从公网完整下载两个 URL 至项目目录，与上传文件按字节数和 SHA-256 核对。将 HTTP 响应头、目标 URL 和传输核对结果保存在本地操作材料目录。公布该版本的两个下载链接。

下载片段的现用格式如下，版本与文件名采用本次发行值。

```nginx
location = /downloads/research-canvas/0.1.3/research-canvas-0.1.3-windows-x64.zip {
    root /var/www/matharc-resolve;
    types { }
    default_type application/octet-stream;
    try_files $uri =404;
}

location = /downloads/research-canvas/0.1.3/research-canvas-0.1.3-macos-arm64.zip {
    root /var/www/matharc-resolve;
    types { }
    default_type application/octet-stream;
    try_files $uri =404;
}
```

产品网站的下载地址采用 `https://mathana.homes/downloads/research-canvas/<版本>/<文件名>`。`resolve.matharc.space` 的相同路径继续提供兼容下载。两个站点 include 同一个下载片段并读取同一份安装包。页面内容通过替换静态 HTML 生效，新增版本的下载路径通过片段更新和 Nginx reload 生效。实际传输因本机代理超时且已确认直连可用时，可使用 `curl --noproxy <下载域名> --http1.1` 继续该次下载。

## 发布撤回

`nginx -t` 失败时，恢复本次修改前的片段并重新检查，服务继续使用已加载配置。启用后发现下载故障时，使用适用配置原件恢复片段，检查通过后 reload，核对原有下载 URL 和网站健康接口。发行包内容问题通过撤回本次公开链接、在 Release 说明标明状态处理，后续修复使用新版本。暂存文件在确认传输与公开下载结果后按本项目目录清理，历史有效发行物按用户要求保留。
