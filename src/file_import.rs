use std::io::{Cursor, Read};

use quick_xml::{Reader, events::Event};
use rusqlite::{Connection, params};
use serde_json::{Value, json};

use crate::{db, error::{ApiError, Result}, model::*};

pub struct PreparedFile {
    pub filename: String,
    pub media_type: String,
    pub data: Vec<u8>,
    pub kind: DocumentKind,
    pub content: Content,
    pub format: String,
    pub text_status: String,
    pub message: Option<String>,
    pub details: Value,
}

fn code_markdown(text: &str, language: &str) -> String {
    let width = text.split(|character| character != '`').map(str::len).max().unwrap_or(0).max(2) + 1;
    let fence = "`".repeat(width);
    format!("{fence}{language}\n{text}\n{fence}")
}

fn notebook(data: &[u8]) -> Result<Content> {
    let value: Value = serde_json::from_slice(data).map_err(|error| ApiError::invalid(format!("Notebook JSON：{error}")))?;
    let cells = value["cells"].as_array().ok_or_else(|| ApiError::invalid("Notebook 需要 cells 数组"))?;
    let language = value.pointer("/metadata/language_info/name").and_then(Value::as_str).unwrap_or("");
    let mut blocks = Vec::new();
    let mut markdown = Vec::new();
    for cell in cells {
        let source = match &cell["source"] {
            Value::String(text) => text.clone(),
            Value::Array(lines) => lines.iter().map(|line| line.as_str().ok_or_else(|| ApiError::invalid("Notebook source 行需要字符串"))).collect::<Result<Vec<_>>>()?.concat(),
            _ => return Err(ApiError::invalid("Notebook 单元格需要 source")),
        };
        markdown.push(if cell["cell_type"] == "code" { code_markdown(&source, language) } else { source.clone() });
        blocks.push(source);
    }
    // 统一正文由成熟 Markdown 导入器建立编辑结构，单元格原文保存在原始附件中。
    Ok(Content { blocks: Content::text(blocks.join("\n\n")).blocks, markdown: Some(markdown.join("\n\n")), editor_state: None })
}

fn docx(data: &[u8]) -> Result<Content> {
    let mut archive = zip::ZipArchive::new(Cursor::new(data)).map_err(|error| ApiError::invalid(format!("Word 文件：{error}")))?;
    let mut xml = String::new();
    archive.by_name("word/document.xml").map_err(|error| ApiError::invalid(format!("Word 正文：{error}")))?.read_to_string(&mut xml).map_err(|error| ApiError::invalid(format!("Word XML：{error}")))?;
    let mut reader = Reader::from_str(&xml);
    let mut text = String::new();
    let mut in_text = false;
    loop {
        match reader.read_event().map_err(|error| ApiError::invalid(format!("Word XML：{error}")))? {
            Event::Start(tag) if tag.local_name().as_ref() == b"t" => in_text = true,
            Event::End(tag) => match tag.local_name().as_ref() {
                b"t" => in_text = false,
                b"p" | b"tr" => text.push('\n'),
                b"tc" => text.push('\t'),
                _ => {},
            },
            Event::Empty(tag) => match tag.local_name().as_ref() {
                b"tab" => text.push('\t'),
                b"br" => text.push('\n'),
                _ => {},
            },
            Event::Text(value) if in_text => text.push_str(&value.decode().map_err(|error| ApiError::invalid(error.to_string()))?),
            Event::GeneralRef(value) if in_text => {
                let reference = value.decode().map_err(|error| ApiError::invalid(error.to_string()))?;
                text.push_str(&quick_xml::escape::unescape(&format!("&{reference};")).map_err(|error| ApiError::invalid(error.to_string()))?);
            },
            Event::Eof => break,
            _ => {},
        }
    }
    Ok(Content::text(text.trim_end().to_owned()))
}

fn decode_text(data: &[u8]) -> Option<String> {
    if let Some((encoding, prefix)) = encoding_rs::Encoding::for_bom(data) {
        return encoding.decode_without_bom_handling_and_without_replacement(&data[prefix..]).map(|text| text.into_owned());
    }
    if data.contains(&0) { return None; }
    std::str::from_utf8(data).ok().map(str::to_owned)
}

pub fn prepare(filename: String, supplied_type: String, data: Vec<u8>) -> PreparedFile {
    let extension = std::path::Path::new(&filename).extension().and_then(|extension| extension.to_str()).unwrap_or("").to_lowercase();
    let media_type = mime_guess::from_path(&filename).first_raw().map(str::to_owned).unwrap_or(supplied_type);
    let mut file = PreparedFile { filename, media_type, data, kind: DocumentKind::Document, content: Content::default(), format: extension.clone(), text_status: "ready".into(), message: None, details: json!({}) };
    let content = if matches!(extension.as_str(), "xlsx" | "xls" | "xlsm" | "xlsb" | "xla" | "xlam" | "ods" | "pptx" | "ppt" | "pptm" | "ppsx" | "ppsm" | "potx") {
        let result = if matches!(extension.as_str(), "xlsx" | "xls" | "xlsm" | "xlsb" | "xla" | "xlam" | "ods") {
            crate::office_import::spreadsheet(&file.data)
        } else { crate::office_import::presentation(&file.data) };
        result.map(|office| {
            file.details = office.details;
            if !office.warnings.is_empty() {
                file.text_status = "partial".into();
                file.message = Some(office.warnings.join("\n"));
            }
            office.content
        })
    } else if extension == "pdf" || file.media_type == "application/pdf" {
        file.kind = DocumentKind::Pdf;
        file.media_type = "application/pdf".into();
        pdf_extract::extract_text_from_mem_by_pages(&file.data)
            .map(|pages| Content { blocks: pages.into_iter().enumerate().map(|(index, text)| TextBlock { id: id(), text, page: Some((index + 1) as u32) }).collect(), ..Content::default() })
            .map_err(|error| ApiError::invalid(format!("PDF 文字提取：{error}")))
    } else if file.media_type.starts_with("image/") {
        file.kind = DocumentKind::Image;
        file.text_status = "image".into();
        Ok(Content::default())
    } else if extension == "docx" {
        docx(&file.data)
    } else if extension == "ipynb" {
        notebook(&file.data)
    } else if let Some(text) = decode_text(&file.data) {
        let mut content = Content::text(text.clone());
        if matches!(extension.as_str(), "md" | "markdown" | "mdx" | "note") {
            content.markdown = Some(text);
            file.format = "markdown".into();
        } else if extension != "txt" && !extension.is_empty() {
            content.markdown = Some(code_markdown(&text, &extension));
        }
        if file.media_type == "application/octet-stream" { file.media_type = "text/plain; charset=utf-8".into(); }
        Ok(content)
    } else {
        file.text_status = "attachment".into();
        file.message = Some("原始文件已保存，可下载或交给对应应用打开".into());
        Ok(Content::default())
    };
    match content {
        Ok(content) => {
            if file.kind == DocumentKind::Pdf && content.blocks.iter().all(|block| block.text.trim().is_empty()) {
                file.text_status = "empty".into();
                file.message = Some("PDF 已保存，文字层为空；可打开原页或使用 OCR 提取文字".into());
            }
            file.content = content;
        },
        Err(error) => { file.text_status = "error".into(); file.message = Some(error.message); },
    }
    file
}

impl PreparedFile {
    pub fn metadata(&self, asset_id: &str) -> Value {
        json!({"source_asset_id":asset_id,"source_filename":self.filename,"file_format":self.format,"media_type":self.media_type,"byte_length":self.data.len(),"text_status":self.text_status,"import_message":self.message,"import_details":self.details})
    }

    pub fn asset_view(&self, asset_id: &str) -> Value {
        json!({"id":asset_id,"filename":self.filename,"media_type":self.media_type,"byte_length":self.data.len(),"url":format!("/api/assets/{asset_id}")})
    }

    pub fn insert_asset(&self, connection: &Connection, asset_id: &str, workspace_id: &str) -> Result<()> {
        connection.execute("INSERT INTO assets (id,workspace_id,filename,media_type,data,created_at,temporary) VALUES (?,?,?,?,?,?,0)", params![asset_id,workspace_id,self.filename,self.media_type,self.data,now()])?;
        Ok(())
    }

    pub fn insert_document(&self, connection: &Connection, workspace_id: &str) -> Result<Document> {
        let asset_id = id();
        self.insert_asset(connection, &asset_id, workspace_id)?;
        let document = db::new_document(workspace_id.to_owned(), self.filename.clone(), self.kind.clone(), self.content.clone(), self.metadata(&asset_id));
        db::insert_document(connection, &document, "import")?;
        Ok(document)
    }
}
