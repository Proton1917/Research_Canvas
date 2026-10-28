use std::collections::{HashMap, HashSet};
use std::path::{Component, Path as FilePath};

use axum::{Json, extract::{Multipart, Path, Query, State}, http::StatusCode};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::{AppState, db, error::{ApiError, Result}, file_import::{self, PreparedFile}, model::{id, now}};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EntryKind { File, Directory }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectEntry {
    pub project_id: String,
    pub path: String,
    pub parent_path: String,
    pub name: String,
    pub kind: EntryKind,
    pub document_id: Option<String>,
    pub asset_id: Option<String>,
    pub media_type: Option<String>,
    pub byte_length: usize,
    pub imported_version: Option<i64>,
    pub text_status: String,
    pub message: Option<String>,
    pub updated_at: String,
}

fn project_row(row: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project { id: row.get(0)?, workspace_id: row.get(1)?, name: row.get(2)?, created_at: row.get(3)?, updated_at: row.get(4)? })
}

fn entry_row(row: &Row<'_>) -> rusqlite::Result<ProjectEntry> {
    let kind: String = row.get(4)?;
    Ok(ProjectEntry { project_id: row.get(0)?, path: row.get(1)?, parent_path: row.get(2)?, name: row.get(3)?, kind: if kind == "file" { EntryKind::File } else { EntryKind::Directory }, document_id: row.get(5)?, asset_id: row.get(6)?, media_type: row.get(7)?, byte_length: row.get(8)?, imported_version: row.get(9)?, text_status: row.get(10)?, message: row.get(11)?, updated_at: row.get(12)? })
}

pub fn get(connection: &Connection, id: &str) -> Result<Project> {
    Ok(connection.query_row("SELECT * FROM projects WHERE id=?", [id], project_row)?)
}

pub fn list(connection: &Connection, workspace_id: &str) -> Result<Vec<Project>> {
    let mut statement = connection.prepare("SELECT * FROM projects WHERE workspace_id=? ORDER BY created_at,id")?;
    Ok(statement.query_map([workspace_id], project_row)?.collect::<rusqlite::Result<_>>()?)
}

pub fn all_entries(connection: &Connection, workspace_id: &str) -> Result<Vec<ProjectEntry>> {
    let mut statement = connection.prepare("SELECT e.* FROM project_entries e JOIN projects p ON p.id=e.project_id WHERE p.workspace_id=? ORDER BY e.project_id,e.path")?;
    Ok(statement.query_map([workspace_id], entry_row)?.collect::<rusqlite::Result<_>>()?)
}

pub fn insert_project(connection: &Connection, project: &Project) -> Result<()> {
    connection.execute("INSERT INTO projects VALUES (?,?,?,?,?)", params![project.id,project.workspace_id,project.name,project.created_at,project.updated_at])?;
    Ok(())
}

pub fn insert_entry(connection: &Connection, entry: &ProjectEntry) -> Result<()> {
    connection.execute("INSERT INTO project_entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,path) DO UPDATE SET document_id=excluded.document_id,asset_id=excluded.asset_id,media_type=excluded.media_type,byte_length=excluded.byte_length,imported_version=excluded.imported_version,text_status=excluded.text_status,message=excluded.message,updated_at=excluded.updated_at", params![entry.project_id,entry.path,entry.parent_path,entry.name,db::enum_name(&entry.kind)?,entry.document_id,entry.asset_id,entry.media_type,entry.byte_length,entry.imported_version,entry.text_status,entry.message,entry.updated_at])?;
    Ok(())
}

// 外部清单中的路径规范化为项目内相对路径，归档按相同约定恢复目录。
pub fn relative_path(value: &str) -> Result<String> {
    let portable = value.replace('\\', "/");
    let mut parts = Vec::new();
    for component in FilePath::new(&portable).components() {
        match component {
            Component::Normal(part) => {
                let part = part.to_str().ok_or_else(|| ApiError::invalid("项目路径需要 UTF-8"))?;
                if part.contains('\0') || (parts.is_empty() && part.ends_with(':')) { return Err(ApiError::invalid("请使用项目内相对路径")); }
                parts.push(part);
            },
            Component::CurDir => {},
            _ => return Err(ApiError::invalid("请使用项目内相对路径")),
        }
    }
    if parts.is_empty() { return Err(ApiError::invalid("文件或子目录路径为空")); }
    Ok(parts.join("/"))
}

fn parts(path: &str) -> (&str, &str) { path.rsplit_once('/').unwrap_or(("", path)) }

pub async fn create(State(state): State<AppState>, Path(workspace_id): Path<String>, Json(input): Json<crate::api::NameInput>) -> Result<(StatusCode, Json<Project>)> {
    if input.name.trim().is_empty() { return Err(ApiError::invalid("请输入项目名称")); }
    let project = state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        db::workspace(&transaction, &workspace_id)?;
        let project = Project { id: id(), workspace_id, name: input.name.trim().to_owned(), created_at: now(), updated_at: now() };
        insert_project(&transaction, &project)?;
        db::touch(&transaction, &project.workspace_id)?;
        transaction.commit()?;
        Ok(project)
    }).await?;
    Ok((StatusCode::CREATED, Json(project)))
}

pub async fn read(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Project>> {
    Ok(Json(state.db.call(move |connection| get(connection, &id)).await?))
}

pub async fn capabilities(State(state): State<AppState>) -> Json<Value> {
    Json(json!({"projects":true,"relative_paths":true,"batch_upload":true,"max_request_bytes":state.config.max_request_bytes,"max_archive_bytes":state.config.max_archive_bytes,"project_page_size":state.config.project_page_size,"pdf_text":"builtin","text_encodings":["utf-8","utf-16-bom"],"formats":["markdown","note","json","jsonl","yaml","toml","csv","tsv","source_code","ipynb","docx","xlsx","xls","xlsm","xlsb","ods","pptx","ppt","pptm","ppsx","pdf","image","text","attachment"]}))
}

pub async fn list_projects(State(state): State<AppState>, Path(workspace_id): Path<String>) -> Result<Json<Value>> {
    Ok(Json(state.db.call(move |connection| {
        db::workspace(connection, &workspace_id)?;
        let mut statement = connection.prepare("SELECT p.*,COUNT(e.document_id),COALESCE(SUM(e.byte_length),0) FROM projects p LEFT JOIN project_entries e ON e.project_id=p.id WHERE p.workspace_id=? GROUP BY p.id ORDER BY p.created_at,p.id")?;
        let rows = statement.query_map([workspace_id], |row| Ok(json!({"project":project_row(row)?,"file_count":row.get::<_, i64>(5)?,"byte_length":row.get::<_, i64>(6)?})))?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(json!(rows))
    }).await?))
}

#[derive(Deserialize)]
pub struct TreeQuery {
    #[serde(default)] pub parent: String,
    #[serde(default)] pub after: String,
    pub limit: Option<usize>,
}

pub async fn entries(State(state): State<AppState>, Path(project_id): Path<String>, Query(input): Query<TreeQuery>) -> Result<Json<Value>> {
    let parent = if input.parent.is_empty() { String::new() } else { relative_path(&input.parent)? };
    let limit = input.limit.unwrap_or(state.config.project_page_size);
    if limit == 0 { return Err(ApiError::invalid("每页数量需要大于零")); }
    Ok(Json(state.db.call(move |connection| {
        let project = get(connection, &project_id)?;
        let mut statement = connection.prepare("SELECT * FROM project_entries WHERE project_id=? AND parent_path=? AND path>? ORDER BY path LIMIT ?")?;
        let mut rows = statement.query_map(params![project_id,parent,input.after,limit.saturating_add(1)], entry_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        let next = if rows.len() > limit { rows.truncate(limit); rows.last().map(|entry| entry.path.clone()) } else { None };
        Ok(json!({"project":project,"parent":parent,"entries":rows,"next_cursor":next}))
    }).await?))
}

#[derive(Deserialize)]
struct ImportFile {
    field: String,
    path: String,
    expected_version: Option<i64>,
}

#[derive(Deserialize)]
struct Manifest {
    #[serde(default)] files: Vec<ImportFile>,
    #[serde(default)] directories: Vec<String>,
}

fn directory(connection: &Connection, project_id: &str, path: &str, known: &mut HashSet<String>) -> Result<()> {
    if path.is_empty() || known.contains(path) { return Ok(()); }
    let (parent, name) = parts(path);
    directory(connection, project_id, parent, known)?;
    let existing: Option<String> = connection.query_row("SELECT kind FROM project_entries WHERE project_id=? AND path=?", [project_id,path], |row| row.get(0)).optional()?;
    if let Some(kind) = existing {
        if kind != "directory" { return Err(ApiError::new(StatusCode::CONFLICT, "path_conflict", format!("{path} 已保存为文件"))); }
    } else {
        insert_entry(connection, &ProjectEntry { project_id: project_id.to_owned(), path: path.to_owned(), parent_path: parent.to_owned(), name: name.to_owned(), kind: EntryKind::Directory, document_id: None, asset_id: None, media_type: None, byte_length: 0, imported_version: None, text_status: "directory".into(), message: None, updated_at: now() })?;
    }
    known.insert(path.to_owned());
    Ok(())
}

fn save_file(connection: &Connection, project: &Project, spec: &ImportFile, file: &PreparedFile, directories: &mut HashSet<String>) -> Result<Value> {
    let (parent, name) = parts(&spec.path);
    directory(connection, &project.id, parent, directories)?;
    let existing = connection.query_row("SELECT * FROM project_entries WHERE project_id=? AND path=?", [&project.id,&spec.path], entry_row).optional()?;
    let mut previous = None;
    if let Some(entry) = &existing {
        if entry.kind != EntryKind::File { return Err(ApiError::new(StatusCode::CONFLICT, "path_conflict", "此路径已保存为目录")); }
        let same: bool = connection.query_row("SELECT data=? FROM assets WHERE id=?", params![file.data,entry.asset_id], |row| row.get(0))?;
        if same { return Ok(json!({"path":spec.path,"status":"unchanged","entry":entry})); }
        let document = db::document(connection, entry.document_id.as_deref().unwrap())?;
        let expected = spec.expected_version.or(entry.imported_version).unwrap();
        if document.current_version != expected { return Err(ApiError::conflict(document.current_version)); }
        previous = Some(document);
    }
    let asset_id = id();
    file.insert_asset(connection, &asset_id, &project.workspace_id)?;
    let mut metadata = Value::Object(previous.as_ref().and_then(|document| document.metadata.as_object()).cloned().unwrap_or_default());
    metadata.as_object_mut().unwrap().extend(file.metadata(&asset_id).as_object().unwrap().clone());
    metadata["project_id"] = json!(project.id);
    metadata["relative_path"] = json!(spec.path);
    let mut document = match previous {
        Some(mut document) => {
            document.content = file.content.clone();
            document.metadata = metadata;
            let version = document.current_version;
            db::revise(connection, &mut document, version, "project-import")?;
            document
        },
        None => {
            let document = db::new_document(project.workspace_id.clone(), format!("{}/{}",project.name,spec.path), file.kind.clone(), file.content.clone(), metadata);
            db::insert_document(connection, &document, "project-import")?;
            document
        },
    };
    // 原始文件与导入版本的对应关系随当前文稿元信息保留。
    let mut sources = document.metadata.get("source_versions").and_then(Value::as_array).cloned().unwrap_or_default();
    sources.push(json!({"version":document.current_version,"asset_id":asset_id}));
    document.metadata["source_versions"] = json!(sources);
    connection.execute("UPDATE documents SET metadata=? WHERE id=?", params![db::encode(&document.metadata)?,document.id])?;
    let entry = ProjectEntry { project_id: project.id.clone(), path: spec.path.clone(), parent_path: parent.to_owned(), name: name.to_owned(), kind: EntryKind::File, document_id: Some(document.id), asset_id: Some(asset_id), media_type: Some(file.media_type.clone()), byte_length: file.data.len(), imported_version: Some(document.current_version), text_status: file.text_status.clone(), message: file.message.clone(), updated_at: now() };
    insert_entry(connection, &entry)?;
    Ok(json!({"path":spec.path,"status":if existing.is_some() {"updated"} else {"imported"},"entry":entry}))
}

pub async fn import_files(State(state): State<AppState>, Path(project_id): Path<String>, mut multipart: Multipart) -> Result<Json<Value>> {
    let field = multipart.next_field().await.map_err(|error| ApiError::invalid(error.to_string()))?.ok_or_else(|| ApiError::invalid("请先提供 manifest 字段"))?;
    if field.name() != Some("manifest") { return Err(ApiError::invalid("首个字段需要是 manifest")); }
    let mut manifest: Manifest = serde_json::from_str(&field.text().await.map_err(|error| ApiError::invalid(error.to_string()))?).map_err(|error| ApiError::invalid(format!("导入清单：{error}")))?;
    let mut paths = HashSet::new();
    let mut specs = HashMap::new();
    for mut spec in manifest.files {
        spec.path = relative_path(&spec.path)?;
        if !paths.insert(spec.path.clone()) || specs.insert(spec.field.clone(), spec).is_some() { return Err(ApiError::invalid("同批文件的路径与字段标识需要唯一")); }
    }
    for path in &mut manifest.directories { *path = relative_path(path)?; }
    let mut uploads = Vec::new();
    while let Some(field) = multipart.next_field().await.map_err(|error| ApiError::invalid(error.to_string()))? {
        let spec = specs.remove(field.name().unwrap_or("")).ok_or_else(|| ApiError::invalid("文件字段缺少对应清单项"))?;
        let filename = parts(&spec.path).1.to_owned();
        let media_type = field.content_type().unwrap_or("application/octet-stream").to_owned();
        let data = field.bytes().await.map_err(|error| ApiError::invalid(error.to_string()))?.to_vec();
        uploads.push((spec, filename, media_type, data));
    }
    if !specs.is_empty() { return Err(ApiError::invalid("清单中的文件字段缺失，请重新上传该批文件")); }
    let files = tokio::task::spawn_blocking(move || uploads.into_iter().map(|(spec,name,mime,data)| (spec,file_import::prepare(name,mime,data))).collect::<Vec<_>>()).await.map_err(ApiError::internal)?;
    Ok(Json(state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut project = get(&transaction, &project_id)?;
        let mut directories = HashSet::new();
        for path in manifest.directories { directory(&transaction, &project.id, &path, &mut directories)?; }
        let mut results = Vec::new();
        for (spec, file) in files {
            match save_file(&transaction, &project, &spec, &file, &mut directories) {
                Ok(result) => results.push(result),
                Err(error) if error.status == StatusCode::CONFLICT => results.push(json!({"path":spec.path,"status":"conflict","error":{"code":error.code,"message":error.message,"details":error.details}})),
                Err(error) => return Err(error),
            }
        }
        project.updated_at = now();
        transaction.execute("UPDATE projects SET updated_at=? WHERE id=?", params![project.updated_at,project.id])?;
        db::touch(&transaction, &project.workspace_id)?;
        transaction.commit()?;
        Ok(json!({"project":project,"results":results}))
    }).await?))
}
