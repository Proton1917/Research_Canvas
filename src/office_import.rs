use std::io::Cursor;

use calamine::{Data, Reader};
use serde_json::{Value, json};

use crate::{error::{ApiError, Result}, model::Content};

pub struct OfficeContent {
    pub content: Content,
    pub details: Value,
    pub warnings: Vec<String>,
}

fn markdown_content(text: String) -> Content {
    let mut content = Content::text(text.clone());
    content.markdown = Some(text);
    content
}

fn cell_text(text: &str) -> String {
    let mut escaped = String::new();
    for character in text.chars() {
        if character == '\n' { escaped.push_str("<br>"); }
        else {
            if "\\`*_[]<>|$".contains(character) { escaped.push('\\'); }
            escaped.push(character);
        }
    }
    escaped
}

fn column_name(mut index: u32) -> String {
    let mut letters = Vec::new();
    loop {
        letters.push((b'A' + (index % 26) as u8) as char);
        if index < 26 { break; }
        index = index / 26 - 1;
    }
    letters.into_iter().rev().collect()
}

fn value_text(value: &Data) -> String {
    match value {
        Data::DateTime(value) => value.as_datetime().map(|date| date.to_string()).unwrap_or_else(|| value.to_string()),
        _ => value.to_string(),
    }
}

pub fn spreadsheet(data: &[u8]) -> Result<OfficeContent> {
    let mut workbook = calamine::open_workbook_auto_from_rs(Cursor::new(data)).map_err(|error| ApiError::invalid(format!("工作簿读取：{error}")))?;
    let mut text = String::new();
    let mut sheets = Vec::new();
    for name in workbook.sheet_names() {
        let values = workbook.worksheet_range(&name).map_err(|error| ApiError::invalid(format!("工作表 {name}：{error}")))?;
        let formulas = workbook.worksheet_formula(&name).map_err(|error| ApiError::invalid(format!("工作表 {name} 公式：{error}")))?;
        text.push_str(&format!("## 工作表：{}\n\n", cell_text(&name)));
        let starts = [values.start(), formulas.start()].into_iter().flatten().collect::<Vec<_>>();
        let ends = [values.end(), formulas.end()].into_iter().flatten().collect::<Vec<_>>();
        let Some(start_row) = starts.iter().map(|position| position.0).min() else {
            sheets.push(json!({"name":name,"rows":0,"columns":0,"formula_count":0}));
            text.push_str("空工作表\n\n");
            continue;
        };
        let start_col = starts.iter().map(|position| position.1).min().unwrap();
        let end_row = ends.iter().map(|position| position.0).max().unwrap();
        let end_col = ends.iter().map(|position| position.1).max().unwrap();
        let mut formula_count = 0;
        text.push_str("| 行 |");
        for column in start_col..=end_col { text.push_str(&format!(" {} |", column_name(column))); }
        text.push_str("\n| --- |");
        for _ in start_col..=end_col { text.push_str(" --- |"); }
        text.push('\n');
        for row in start_row..=end_row {
            text.push_str(&format!("| {} |", row + 1));
            for column in start_col..=end_col {
                let value = values.get_value((row, column)).map(value_text).unwrap_or_default();
                let formula = formulas.get_value((row, column)).filter(|formula| !formula.is_empty());
                text.push(' ');
                text.push_str(&cell_text(&value));
                if let Some(formula) = formula {
                    formula_count += 1;
                    text.push_str(&format!("<br>公式：{}", cell_text(&format!("={}",formula.trim_start_matches('=')))));
                }
                text.push_str(" |");
            }
            text.push('\n');
        }
        text.push('\n');
        sheets.push(json!({"name":name,"rows":end_row-start_row+1,"columns":end_col-start_col+1,"start_row":start_row+1,"start_column":column_name(start_col),"formula_count":formula_count}));
    }
    Ok(OfficeContent { content: markdown_content(text), details: json!({"sheets":sheets,"formula_values":"stored"}), warnings: Vec::new() })
}

pub fn presentation(data: &[u8]) -> Result<OfficeContent> {
    let document = pptxboss_core::Document::load(data.to_vec()).map_err(|error| ApiError::invalid(format!("演示文稿读取：{error}")))?;
    let options = pptxboss_core::MarkdownOptions { notes: true, comments: true, images: false, ..Default::default() };
    let slides = document.map_slides(|slide| -> Result<_> {
        let slide = slide.map_err(|error| ApiError::invalid(format!("幻灯片读取：{error}")))?;
        let mut report = pptxboss_core::ExtractReport::default();
        let text = slide.markdown(&options, &mut report);
        Ok((slide.number(), slide.title(), text, report.warnings()))
    });
    let mut text = String::new();
    let mut sections = Vec::new();
    let mut warnings = Vec::new();
    for slide in slides {
        let (number, title, markdown, skipped) = slide?;
        text.push_str(&format!("# 幻灯片 {number}\n\n{markdown}\n\n"));
        sections.push(json!({"number":number,"title":title}));
        warnings.extend(skipped.into_iter().map(|warning| format!("幻灯片 {number}：{warning}")));
    }
    Ok(OfficeContent { content: markdown_content(text), details: json!({"slides":sections,"legacy":document.is_legacy()}), warnings })
}
