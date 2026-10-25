# Research Canvas

Research Canvas 将科研文稿、公式、来源片段、自由想法和 AI 讨论组织在同一张画布中。这个发行包包含后端程序、编译后的界面和默认配置。

首次使用请阅读 [安装与使用指南](INSTALL.md)。

- Windows：完整解压后双击 `start.cmd`。
- macOS：完整解压后打开 `Start.command`，或在终端运行 `bash start.sh`。
- Linux：完整解压后在终端运行 `bash start.sh`。

打开浏览器访问 **http://127.0.0.1:8787**。服务窗口保持运行，停止时按 `Ctrl+C`。文稿与工作区数据保存在本目录的 `.runtime/data/` 中。

PDF 导入使用系统安装的 Poppler；AI 功能使用 `config/server.toml` 配置的模型服务。安装方法、模型配置、升级和故障处理见安装指南。

版本号见 `VERSION`，源码提交见 `SOURCE_COMMIT`。项目自有代码采用 [MPL-2.0](LICENSE)，随附组件的版权与许可告知位于 `licenses/`。

项目源码与反馈入口：[Proton1917/Research_Canvas](https://github.com/Proton1917/Research_Canvas)。
