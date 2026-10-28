# 项目目录与文件导入

一个 Research Canvas 工作区可以包含多个项目。项目保存目录快照、原始文件、相对路径及对应研究文稿。各项目使用独立标识，同名文件通过项目与相对路径共同确定身份。编辑在工作区中形成文稿版本；源目录由用户继续管理，再次导入同一项目时更新所选文件。

## 文件读取

| 格式 | 导入内容 |
| --- | --- |
| Markdown、`.note` | Markdown 正文，保留标题、列表、表格、公式等结构的来源文本 |
| JSON、JSONL、YAML、TOML、CSV、TSV、源码、普通文本 | 原始文本和对应代码表示；JSON 材料通过文件导入入口读取 |
| `.ipynb` | Markdown 与代码单元格，原始 Notebook 完整保留 |
| `.docx` | Word 正文、段落和表格单元格文字 |
| `.xlsx`、`.xls`、`.xlsm`、`.xlsb`、`.ods` | 每张工作表的名称、坐标、单元格值和公式；公式结果采用文件中保存的值 |
| `.pptx`、`.pptm`、`.ppsx` | 各页标题、正文、表格、图表数据、备注和批注，转换为 Markdown |
| PowerPoint 97–2003 `.ppt` | 各页可提取的标题、正文和备注，保留原始演示文稿 |
| PDF | 内置 `pdf-extract` 逐页提取文字，保留页码和原文件 |
| 图片 | 图像原件，可沿用图像读取接口 |
| 其他二进制格式 | 原始附件，可下载后交给对应应用打开 |

普通文本支持 UTF-8，以及带 BOM 的 UTF-16。Excel 使用 `calamine`，演示文稿使用 `pptxboss-core`；导入读取保存的数据和文本。演示文稿以内容和页次组织研究材料，原始版式、动画、嵌入图片等保留于原文件。

正文与 Markdown 使用既有 `Content` 字段。Office 材料转换为单块 Markdown 文稿，标题表达工作表或幻灯片身份；后续由编辑器建立相应内容块。文稿 metadata 附带：

| 字段 | 含义 |
| --- | --- |
| `source_asset_id`、`source_filename` | 当前导入原件及文件名 |
| `file_format`、`media_type`、`byte_length` | 文件格式、媒体类型和原始字节数 |
| `project_id`、`relative_path` | 项目文件归属；普通单文件导入采用原有工作区归属 |
| `text_status`、`import_message` | 正文读取状态及说明 |
| `import_details.sheets` | 工作表名称、已用行列范围、起始坐标和公式数量 |
| `import_details.slides` | 幻灯片页次及标题 |
| `source_versions` | 项目导入形成的文稿版本与原件资产对应关系 |

`ready` 表示正文已读取，`partial` 表示部分内容已读取且附有解析说明，`image` 表示图像材料，`empty` 表示 PDF 文字层为空，`attachment` 表示原件保存，`error` 表示正文提取失败且原件保留。解析说明进入文件条目及文稿 metadata，其他文件继续处理。

## 项目与目录接口

先以 `POST /workspaces/{workspace_id}/projects` 提交 `{name}` 创建项目。返回 `Project`：

```typescript
type Project = {
  id: string; workspace_id: string; name: string;
  created_at: string; updated_at: string;
};
```

文件夹选择时，由客户端取得 `webkitRelativePath` 或目录拖放条目。顶层目录作为项目名称，其下路径作为相对路径。多个顶层文件夹分别创建项目；再次导入时由用户选择已有项目。

`GET /projects/{id}/entries` 按 `parent` 查询当前目录，根目录使用空字符串。返回元信息和条目，正文通过 `GET /documents/{id}` 按需读取。`after` 使用上页的 `next_cursor`；`limit` 默认取 `project_page_size`，示例为 200。

```typescript
type ProjectEntry = {
  project_id: string; path: string; parent_path: string; name: string;
  kind: 'file' | 'directory';
  document_id: string | null; asset_id: string | null;
  media_type: string | null; byte_length: number;
  imported_version: number | null;
  text_status: string; message: string | null; updated_at: string;
};
```

`GET /workspaces/{id}?project_documents=false` 返回普通文稿和画布直接引用的项目文稿，以及项目列表。前端打开项目时通过目录接口加载条目，打开具体文件时再请求文稿，使用完备的文稿对象更新编辑会话。旧调用省略该参数时返回整个工作区的文稿。

## 分批上传与更新

`POST /projects/{id}/imports` 接收 multipart。第一个字段为 JSON 字符串 `manifest`：

```json
{
  "directories": ["notes", "research-state", "sources/empty"],
  "files": [
    {"field": "0", "path": "notes/review.md"},
    {"field": "1", "path": "research-state/state.json", "expected_version": 3}
  ]
}
```

后续文件字段使用清单中的 `field` 值。`path` 为项目内相对路径，使用 `/` 分隔；服务同时接受 Windows 分隔符并规范化。文件父目录由服务建立，`directories` 可显式保留空目录。每批路径及字段标识唯一。

客户端依据 `GET /imports/capabilities` 的 `max_request_bytes` 拆分批次，并给 multipart 清单与请求头保留空间。示例普通请求上限为 32 MiB，推荐每批约 16 MiB、至多 24 个文件，串行批次显示已处理数量及字节数。单个文件超过配置上限时显示该文件与上限，由用户调整服务配置或文件范围。取消后停止排入新批次，当前已发出的批次按实际响应更新结果，已提交批次保留。

每批在解析完成后使用一次 SQLite 事务保存。结果为 `{project,results}`，每个文件有 path 与状态：

- `imported`：新建文件和文稿，附 `entry`。
- `updated`：同路径的原件变化，沿用文稿标识并生成新版本，附 `entry`。
- `unchanged`：原件字节相同，复用原有文稿和版本，附 `entry`。
- `conflict`：文稿在上次导入后已有编辑，或路径的文件与目录类型冲突；附 `error.code`、`error.message`、`error.details`。其他有效文件继续保存。

同路径更新默认以 `imported_version` 为版本前提。用户检查冲突后，可用 `expected_version` 明确接受覆盖该版本的正文。原始文件变化比较直接使用字节；文件版本和原件通过记录标识关联。

目录快照保存已提交文件。重新选择目录中某些文件或中途取消时，其余已有文件保持原样。导入文件夹的内容继续作为研究材料，实际模型请求按用户选中的文稿或片段形成上下文。

## 归档与恢复

JSON 格式 4 增加 `projects` 和 `project_entries`，并保存文稿全部版本及原件资产。恢复同时支持格式 1、2、3 的工作区。ZIP 中 `projects/{project_id}/{path}` 是导入原件的目录树，`documents/{document_id}.md` 是当前文稿表示，`workspace.json` 是完整可恢复状态。

归档恢复使用独立的 `max_archive_bytes`，示例为 256 MiB；普通导入批次继续使用 `max_request_bytes`。配置可以按工作区资料量调整。恢复操作保留项目、文件路径、空目录及文稿标识。

## 后端验收

2026-10-28 在 macOS Apple Silicon 上通过 Rust 构建、前端类型检查及生产构建。`tests/project_import_acceptance.py` 使用项目现有文稿、文件路径和实际字节数生成 Office 资料，XLS 与 PPT 由同一内容转换得到；原始资料和结果保存在 `.runtime/project-import/`。产品服务的 PATH 指向空目录，使用 8798 独立数据库；恢复验证使用 8799。

| 项目 | 结果 |
| --- | --- |
| Excel | XLSX、XLS 的两张工作表、实际文件字节数、求和公式及文件保存的结果一致 |
| PowerPoint | PPTX 的标题、表格和备注可读取，PPT 的文字与备注可读取，页次保留 |
| 其他文件 | DOCX、Notebook、JSON、Markdown 笔记、UTF-16 文本及二进制原件保存通过 |
| PDF | 空 PATH 下读取七页材料，页码为 1 至 7，正文包含原文标题 |
| 整目录与多项目 | docs 的 82 个文件、27,619,125 字节，以及 config/prompts 的 4 个文件进入两个项目；目录分页与原件字节逐项一致 |
| 按需载入 | 工作区摘要保留普通文稿，项目正文通过文稿接口读取 |
| 重复导入 | 同内容复用；变化文件沿用文稿标识并生成版本；人工编辑造成冲突时，同批其他文件保存成功 |
| 明确覆盖 | 按用户确认的 expected_version 重传，版本递增，导入历史原件对应关系保留 |
| 研究上下文 | 更新后的项目文稿进入冻结上下文，正文与导入来源一致 |
| 归档 | 41,881,421 字节 JSON 在空数据库恢复后读回一致；ZIP 保存原始目录、空目录及完整状态 |

执行阶段依次为 `fixtures`、`formats`、`projects`、`reimport`、`archive`，命令形式为 `conda run --no-capture-output -n base python tests/project_import_acceptance.py <阶段>`。已有成功记录按项目约定复用。Office 验收独立覆盖 XLSX、XLS、PPTX、PPT；其余列出的 Office 扩展名通过解析库对应接口接入。前端文件夹选择与目录树由本地 `docs/frontend-handoff.md` 的本轮任务完成交互验收。
