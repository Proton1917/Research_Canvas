use std::{collections::{HashMap, HashSet}, io::{Cursor, Write}, time::Duration};

use axum::{Json, body::Body, extract::{Multipart, Path, State}, http::{StatusCode, header}, response::{IntoResponse, Response}};
use base64::{Engine, engine::general_purpose::STANDARD};
use quick_xml::{Writer, events::{BytesEnd, BytesStart, BytesText, Event}};
use rusqlite::params;
use serde_json::{Value, json};
use zip::write::SimpleFileOptions;

use crate::{AppState, db, error::{ApiError, Result}, model::*, research};

pub async fn import_file(State(state): State<AppState>, Path(workspace_id): Path<String>, mut multipart: Multipart) -> Result<(StatusCode, Json<Value>)> {
    let mut upload = None;
    while let Some(field) = multipart.next_field().await.map_err(|error| ApiError::invalid(error.to_string()))? {
        if field.name() != Some("file") { continue; }
        let filename = field.file_name().unwrap_or("document.txt").to_string();
        let media_type = field.content_type().unwrap_or("application/octet-stream").to_string();
        let data = field.bytes().await.map_err(|error| ApiError::invalid(error.to_string()))?;
        if upload.is_some() { return Err(ApiError::invalid("每次导入一个文件")); }
        upload = Some((filename, media_type, data));
    }
    let (filename, mut media_type, data) = upload.ok_or_else(|| ApiError::invalid("缺少 file 字段"))?;
    let extension = std::path::Path::new(&filename).extension().and_then(|extension| extension.to_str()).unwrap_or("").to_lowercase();
    let (kind, content) = if extension == "pdf" || media_type == "application/pdf" {
        let directory = tempfile::Builder::new().prefix("pdf-").tempdir_in(&state.config.temporary_directory)?;
        let path = directory.path().join("source.pdf");
        tokio::fs::write(&path, &data).await?;
        let mut command = tokio::process::Command::new("pdftotext");
        command.args(["-layout", "-enc", "UTF-8"]).arg(path).arg("-").kill_on_drop(true);
        let output = tokio::time::timeout(Duration::from_secs(state.config.pdf_extract_timeout_seconds), command.output()).await
            .map_err(|_| ApiError::new(StatusCode::REQUEST_TIMEOUT, "pdf_timeout", "PDF 文本提取超时"))?
            .map_err(|error| if error.kind() == std::io::ErrorKind::NotFound {
                ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "pdf_tool_missing", "PDF 导入需要 Poppler，请安装 pdftotext 并将其加入 PATH 后重新启动服务")
            } else { ApiError::from(error) })?;
        if !output.status.success() { return Err(ApiError::invalid(format!("PDF 文本提取失败：{}", String::from_utf8_lossy(&output.stderr).chars().take(500).collect::<String>()))); }
        let text = String::from_utf8(output.stdout).map_err(|_| ApiError::invalid("PDF 提取结果不是 UTF-8"))?;
        let mut pages: Vec<_> = text.split('\u{c}').collect();
        if pages.last() == Some(&"") { pages.pop(); }
        let blocks = pages.into_iter().enumerate().map(|(index, text)| TextBlock { id: id(), text: text.trim().to_string(), page: Some((index + 1) as u32) }).collect();
        media_type = "application/pdf".into();
        (DocumentKind::Pdf, Content { blocks, ..Content::default() })
    } else if media_type.starts_with("image/") || matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif" | "svg") {
        if media_type == "application/octet-stream" {
            media_type = match extension.as_str() { "png" => "image/png", "webp" => "image/webp", "gif" => "image/gif", "svg" => "image/svg+xml", _ => "image/jpeg" }.into();
        }
        (DocumentKind::Image, Content::default())
    } else if media_type.starts_with("text/") || matches!(extension.as_str(), "md" | "markdown" | "txt") {
        let text = String::from_utf8(data.to_vec()).map_err(|_| ApiError::invalid("文本文件需要 UTF-8 编码"))?;
        let mut content = Content::text(text.clone());
        if matches!(extension.as_str(), "md" | "markdown") { content.markdown = Some(text); media_type = "text/markdown; charset=utf-8".into(); }
        else { media_type = "text/plain; charset=utf-8".into(); }
        (DocumentKind::Document, content)
    } else { return Err(ApiError::invalid("支持 PDF、Markdown、UTF-8 文本和图片文件")); };
    let size = data.len();
    let asset = Asset { id: id(), workspace_id: workspace_id.clone(), filename: filename.clone(), media_type, data_base64: STANDARD.encode(data), created_at: now() };
    let document = db::new_document(workspace_id, filename, kind, content, json!({"source_asset_id":asset.id,"source_filename":asset.filename}));
    let result = state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        db::workspace(&transaction, &document.workspace_id)?;
        db::insert_asset(&transaction, &asset)?;
        db::insert_document(&transaction, &document, "import")?;
        transaction.commit()?;
        Ok(json!({"document":document,"asset":{"id":asset.id,"filename":asset.filename,"media_type":asset.media_type,"byte_length":size,"url":format!("/api/assets/{}",asset.id)}}))
    }).await?;
    Ok((StatusCode::CREATED, Json(result)))
}

pub async fn get_asset(State(state): State<AppState>, Path(id): Path<String>) -> Result<Response> {
    let asset = state.db.call(move |connection| db::asset(connection, &id)).await?;
    let data = STANDARD.decode(asset.data_base64).map_err(ApiError::internal)?;
    let mut response = Body::from(data).into_response();
    response.headers_mut().insert(header::CONTENT_TYPE, asset.media_type.parse().map_err(|_| ApiError::internal("资产媒体类型无效"))?);
    response.headers_mut().insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().map_err(ApiError::internal)?);
    // SVG 等主动内容使用独立的沙盒源，保持同源应用状态受保护。
    response.headers_mut().insert(header::CONTENT_SECURITY_POLICY, "sandbox; default-src 'none'; style-src 'unsafe-inline'".parse().map_err(ApiError::internal)?);
    Ok(response)
}

pub async fn export_json(State(state): State<AppState>, Path(id): Path<String>) -> Result<Response> {
    let archive = state.db.call(move |connection| db::archive(connection, &id)).await?;
    let filename = format!("research-canvas-{}.json", archive.workspace.id);
    let mut response = Json(archive).into_response();
    response.headers_mut().insert(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\"").parse().map_err(ApiError::internal)?);
    Ok(response)
}

fn graph_svg(archive: &WorkspaceArchive) -> Result<Vec<u8>> {
    let mut nodes = archive.documents.iter().map(|document| (document.id.clone(), document.title.clone(), format!("文稿 · 版本 {}", document.current_version))).collect::<Vec<_>>();
    let mut ids: HashSet<String> = nodes.iter().map(|(id, _, _)| id.clone()).collect();
    for relation in &archive.relations {
        for (id, reference) in [(&relation.source_id, relation.source_ref.as_ref()), (&relation.target_id, relation.target_ref.as_ref())] {
            if ids.insert(id.clone()) {
                let (title, detail) = crate::endpoints::archive_label(archive, id, reference)?;
                nodes.push((id.clone(), title, detail));
            }
        }
    }
    let mut writer = Writer::new(Cursor::new(Vec::new()));
    let width = 900 + archive.relations.len() * 90;
    let height = 140 + nodes.len() * 180;
    let view_box = format!("0 0 {width} {height}");
    let mut root = BytesStart::new("svg");
    root.extend_attributes([("xmlns", "http://www.w3.org/2000/svg"), ("viewBox", view_box.as_str()), ("role", "img")]);
    writer.write_event(Event::Start(root))?;
    let mut background = BytesStart::new("rect");
    background.extend_attributes([("width", "100%"), ("height", "100%"), ("fill", "#fcfcfb")]);
    writer.write_event(Event::Empty(background))?;
    writer.write_event(Event::Start(BytesStart::new("defs")))?;
    let mut marker = BytesStart::new("marker");
    marker.extend_attributes([("id", "arrow"), ("viewBox", "0 0 10 10"), ("refX", "9"), ("refY", "5"), ("markerWidth", "6"), ("markerHeight", "6"), ("orient", "auto-start-reverse")]);
    writer.write_event(Event::Start(marker))?;
    let mut arrow = BytesStart::new("path");
    arrow.extend_attributes([("d", "M 0 0 L 10 5 L 0 10 z"), ("fill", "#718096")]);
    writer.write_event(Event::Empty(arrow))?;
    writer.write_event(Event::End(BytesEnd::new("marker")))?;
    writer.write_event(Event::End(BytesEnd::new("defs")))?;
    let mut positions = HashMap::new();
    for (index, (id, _, _)) in nodes.iter().enumerate() {
        positions.insert(id, (50, 70 + index * 180));
    }
    for (index, relation) in archive.relations.iter().enumerate() {
        if let (Some((x1, y1)), Some((x2, y2))) = (positions.get(&relation.source_id), positions.get(&relation.target_id)) {
            let start_x = x1 + 580;
            let end_x = x2 + 580;
            let start_y = y1 + 35 + index % 6 * 8;
            let end_y = y2 + 35 + index % 6 * 8;
            let lane = 720 + index * 90;
            let route = format!("M {start_x} {start_y} H {lane} V {end_y} H {end_x}");
            let mut line = BytesStart::new("path");
            line.push_attribute(("d", route.as_str()));
            line.extend_attributes([("fill", "none"), ("stroke", if relation.include_in_context { "#bb684c" } else { "#718096" }), ("stroke-width", "2"), ("marker-end", "url(#arrow)")]);
            writer.write_event(Event::Empty(line))?;
            let label = if relation.label.is_empty() {
                match relation.kind.as_str() {
                    "reference" => "引用",
                    "association" => "关联",
                    "context" => "上下文",
                    other => other,
                }
            } else { &relation.label };
            let characters = label.chars().collect::<Vec<_>>();
            for (line, chunk) in characters.chunks(6).enumerate() {
                svg_text(&mut writer, lane + 6, (start_y + end_y) / 2 - 12 + line * 16, &chunk.iter().collect::<String>(), "12")?;
            }
        }
    }
    for (id, title, detail) in &nodes {
        let (x, y) = positions[id];
        let mut rectangle = BytesStart::new("rect");
        let x_text = x.to_string();
        let y_text = y.to_string();
        rectangle.extend_attributes([("x", x_text.as_str()), ("y", y_text.as_str()), ("width", "580"), ("height", "100"), ("rx", "12"), ("fill", "white"), ("stroke", "#c9c8c4")]);
        writer.write_event(Event::Empty(rectangle))?;
        svg_text(&mut writer, x + 18, y + 30, &title.chars().take(28).collect::<String>(), "16")?;
        svg_text(&mut writer, x + 18, y + 54, &title.chars().skip(28).take(28).collect::<String>(), "16")?;
        svg_text(&mut writer, x + 18, y + 81, detail, "12")?;
    }
    writer.write_event(Event::End(BytesEnd::new("svg")))?;
    Ok(writer.into_inner().into_inner())
}

fn svg_text(writer: &mut Writer<Cursor<Vec<u8>>>, x: usize, y: usize, text: &str, size: &str) -> Result<()> {
    let mut element = BytesStart::new("text");
    let x = x.to_string();
    let y = y.to_string();
    element.extend_attributes([("x", x.as_str()), ("y", y.as_str()), ("font-size", size), ("font-family", "system-ui,sans-serif"), ("fill", "#343432")]);
    writer.write_event(Event::Start(element))?;
    writer.write_event(Event::Text(BytesText::new(text)))?;
    writer.write_event(Event::End(BytesEnd::new("text")))?;
    Ok(())
}

fn zip_archive(archive: &WorkspaceArchive) -> Result<Vec<u8>> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("workspace.json", options).map_err(ApiError::internal)?;
    zip.write_all(&serde_json::to_vec_pretty(archive)?)?;
    zip.start_file("relations.json", options).map_err(ApiError::internal)?;
    zip.write_all(&serde_json::to_vec_pretty(&archive.relations)?)?;
    zip.start_file("relations.svg", options).map_err(ApiError::internal)?;
    zip.write_all(&graph_svg(archive)?)?;
    for document in &archive.documents {
        zip.start_file(format!("documents/{}.md", document.id), options).map_err(ApiError::internal)?;
        let mut text = format!("# {}\n\n文稿：{}\n版本：{}\n\n{}\n", document.title, document.id, document.current_version, document.content.markdown.clone().unwrap_or_else(|| document.content.body()));
        if !document.metadata.is_null() && document.metadata != json!({}) {
            text.push_str(&format!("\n## 来源与运行记录\n\n```json\n{}\n```\n", serde_json::to_string_pretty(&document.metadata)?));
        }
        zip.write_all(text.as_bytes())?;
    }
    for asset in &archive.assets {
        zip.start_file(format!("assets/{}", asset.id), options).map_err(ApiError::internal)?;
        zip.write_all(&STANDARD.decode(&asset.data_base64).map_err(ApiError::internal)?)?;
    }
    Ok(zip.finish().map_err(ApiError::internal)?.into_inner())
}

pub async fn export_zip(State(state): State<AppState>, Path(id): Path<String>) -> Result<Response> {
    let archive = state.db.call(move |connection| db::archive(connection, &id)).await?;
    let filename = format!("research-canvas-{}.zip", archive.workspace.id);
    let bytes = tokio::task::spawn_blocking(move || zip_archive(&archive)).await.map_err(ApiError::internal)??;
    let mut response = Body::from(bytes).into_response();
    response.headers_mut().insert(header::CONTENT_TYPE, "application/zip".parse().map_err(ApiError::internal)?);
    response.headers_mut().insert(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\"").parse().map_err(ApiError::internal)?);
    Ok(response)
}

fn validate_archive(archive: &WorkspaceArchive) -> Result<()> {
    if !matches!(archive.format_version, 1 | 2 | 3) { return Err(ApiError::invalid("归档版本不受支持")); }
    let workspace_id = &archive.workspace.id;
    uuid::Uuid::parse_str(workspace_id).map_err(|_| ApiError::invalid("工作区标识无效"))?;
    let mut all_ids = HashSet::new();
    for (id, owner) in archive.documents.iter().map(|item| (&item.id, &item.workspace_id))
        .chain(archive.canvases.iter().map(|item| (&item.id, &item.workspace_id)))
        .chain(archive.relations.iter().map(|item| (&item.id, &item.workspace_id)))
        .chain(archive.anchors.iter().map(|item| (&item.id, &item.workspace_id)))
        .chain(archive.contexts.iter().map(|item| (&item.id, &item.workspace_id)))
        .chain(archive.runs.iter().map(|item| (&item.id, &item.workspace_id)))
        .chain(archive.proposals.iter().map(|item| (&item.id, &item.workspace_id)))
        .chain(archive.canvas_proposals.iter().map(|item| (&item.id, &item.workspace_id)))
        .chain(archive.assets.iter().map(|item| (&item.id, &item.workspace_id))) {
        if owner != workspace_id || !all_ids.insert(id) || uuid::Uuid::parse_str(id).is_err() { return Err(ApiError::invalid("归档中的对象标识或工作区归属无效")); }
    }
    let documents: HashSet<_> = archive.documents.iter().map(|document| &document.id).collect();
    let mut versions = HashMap::new();
    for version in &archive.versions {
        if !documents.contains(&version.document_id) || version.version < 1 || versions.insert((&version.document_id, version.version), version).is_some() { return Err(ApiError::invalid("归档中的文稿版本无效")); }
        db::validate_content(&version.content)?;
    }
    for document in &archive.documents {
        let version = versions.get(&(&document.id, document.current_version)).ok_or_else(|| ApiError::invalid("归档缺少文稿当前版本"))?;
        if version.content != document.content || version.title != document.title { return Err(ApiError::invalid("文稿与当前版本内容不一致")); }
    }
    for canvas in &archive.canvases {
        if canvas.objects.iter().any(|object| !documents.contains(&object.document_id)) { return Err(ApiError::invalid("画布引用了归档之外的文稿")); }
    }
    for relation in &archive.relations {
        crate::endpoints::validate_archive(archive, &relation.source_id, relation.source_ref.as_ref())?;
        crate::endpoints::validate_archive(archive, &relation.target_id, relation.target_ref.as_ref())?;
        if relation.include_in_context && (!documents.contains(&relation.source_id) || !documents.contains(&relation.target_id)) { return Err(ApiError::invalid("旧版上下文连线的端点需要是文稿")); }
    }
    research::context_order(&archive.documents.iter().map(|document| document.id.clone()).collect::<Vec<_>>(), &archive.documents, &archive.relations)?;
    for anchor in &archive.anchors {
        let version = versions.get(&(&anchor.document_id, anchor.version)).ok_or_else(|| ApiError::invalid("锚点来源版本缺失"))?;
        let block = version.content.blocks.iter().find(|block| block.id == anchor.block_id).ok_or_else(|| ApiError::invalid("锚点来源文本块缺失"))?;
        if anchor.quote.is_empty() || !research::quote_at(&block.text, anchor.start_utf16, &anchor.quote) { return Err(ApiError::invalid("锚点引用与来源原文不一致")); }
    }
    let context_ids: HashSet<_> = archive.contexts.iter().map(|context| &context.id).collect();
    let run_ids: HashSet<_> = archive.runs.iter().map(|run| &run.id).collect();
    let anchor_ids: HashSet<_> = archive.anchors.iter().map(|anchor| &anchor.id).collect();
    let proposal_ids: HashSet<_> = archive.proposals.iter().map(|proposal| &proposal.id).collect();
    let canvas_proposal_ids: HashSet<_> = archive.canvas_proposals.iter().map(|proposal| &proposal.id).collect();
    for context in &archive.contexts {
        for visual in &context.visuals {
            if !archive.assets.iter().any(|asset| asset.id == visual.asset_id) || visual.object_ids.is_empty() || visual.object_ids.iter().any(|id| !context.scenes.iter().any(|scene| scene.objects.iter().any(|object| &object.id == id))) { return Err(ApiError::invalid("归档视觉材料的资产或场景对象缺失")); }
        }
        if context.inherited_context_ids.iter().any(|id| !context_ids.contains(id)) { return Err(ApiError::invalid("归档上下文的继承来源缺失")); }
        for source in &context.sources {
            if !versions.contains_key(&(&source.document_id, source.version)) || source.anchor_id.as_ref().is_some_and(|id| !anchor_ids.contains(id)) { return Err(ApiError::invalid("归档上下文引用了缺失的文稿版本或片段")); }
        }
        if context.scenes.iter().any(|scene| !archive.canvases.iter().any(|canvas| canvas.id == scene.canvas_id) || scene.objects.iter().any(|object| object.document_id.as_ref().is_some_and(|id| !documents.contains(id)))) { return Err(ApiError::invalid("归档场景的画布或文稿引用缺失")); }
    }
    for relation in &archive.relations {
        if let Some(claim) = &relation.claim {
            for source in claim.reviews.iter().flat_map(|review| &review.evidence) {
                if !versions.contains_key(&(&source.document_id, source.version)) { return Err(ApiError::invalid("归档研究证据的版本缺失")); }
                if let Some(id) = &source.anchor_id {
                    if !archive.anchors.iter().any(|anchor| &anchor.id == id && anchor.document_id == source.document_id && anchor.version == source.version) { return Err(ApiError::invalid("归档研究证据的锚点与版本不一致")); }
                }
            }
        }
    }
    for run in &archive.runs {
        if run.canvas_proposal_id.as_ref().is_some_and(|id| !canvas_proposal_ids.contains(id)) { return Err(ApiError::invalid("画布提案运行记录引用不完整")); }
        if !context_ids.contains(&run.context_id) || run.document_id.as_ref().is_some_and(|id| !documents.contains(id)) || run.proposal_id.as_ref().is_some_and(|id| !proposal_ids.contains(id)) { return Err(ApiError::invalid("运行记录引用不完整")); }
    }
    for proposal in &archive.proposals {
        if !run_ids.contains(&proposal.run_id) || !anchor_ids.contains(&proposal.anchor_id) { return Err(ApiError::invalid("修改提案来源不完整")); }
    }
    for proposal in &archive.canvas_proposals {
        if !run_ids.contains(&proposal.run_id) || !context_ids.contains(&proposal.context_id) || !archive.canvases.iter().any(|canvas| canvas.id == proposal.canvas_id) { return Err(ApiError::invalid("画布提案来源不完整")); }
        let context = archive.contexts.iter().find(|context| context.id == proposal.context_id).ok_or_else(|| ApiError::invalid("画布提案上下文缺失"))?;
        crate::canvas_proposal::validate_archive(proposal, context, &documents)?;
    }
    Ok(())
}

pub async fn import_archive(State(state): State<AppState>, Json(mut archive): Json<WorkspaceArchive>) -> Result<(StatusCode, Json<Workspace>)> {
    let workspace = state.db.call(move |connection| {
        validate_archive(&archive)?;
        let transaction = connection.transaction()?;
        let exists: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?)", [&archive.workspace.id], |row| row.get(0))?;
        if exists { return Err(ApiError::new(StatusCode::CONFLICT, "workspace_exists", "目标工作区已经存在，归档恢复需要空缺的工作区标识")); }
        let workspace = &archive.workspace;
        transaction.execute("INSERT INTO workspaces VALUES (?,?,?,?)", params![workspace.id, workspace.name, workspace.created_at, workspace.updated_at])?;
        for document in &archive.documents {
            transaction.execute("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?)", params![document.id, document.workspace_id, document.title, db::enum_name(&document.kind)?, document.current_version, db::encode(&document.metadata)?, document.created_at, document.updated_at])?;
        }
        for version in &archive.versions { db::insert_version(&transaction, version)?; }
        for canvas in &archive.canvases { db::insert_canvas(&transaction, canvas)?; }
        for relation in &archive.relations { db::insert_relation(&transaction, relation)?; }
        for anchor in &archive.anchors { db::insert_anchor(&transaction, anchor)?; }
        for context in &archive.contexts { db::insert_context(&transaction, context)?; }
        for run in &mut archive.runs {
            if !run.status.terminal() { run.status = RunStatus::Interrupted; run.error = Some("从归档恢复的未完成运行".into()); run.updated_at = now(); }
            db::insert_run(&transaction, run)?;
        }
        for proposal in &archive.proposals { db::insert_proposal(&transaction, proposal)?; }
        for proposal in &archive.canvas_proposals { crate::canvas_proposal::insert(&transaction, proposal)?; }
        for asset in &archive.assets { db::insert_asset(&transaction, asset)?; }
        transaction.commit()?;
        Ok(archive.workspace)
    }).await?;
    Ok((StatusCode::CREATED, Json(workspace)))
}
