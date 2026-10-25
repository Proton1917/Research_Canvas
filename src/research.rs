use std::collections::{HashMap, HashSet};

use crate::{error::{ApiError, Result}, model::*};

// 根据参与上下文的有向关系遍历祖先，并保留确定的材料次序。
pub fn context_order(starts: &[String], documents: &[Document], relations: &[Relation]) -> Result<Vec<String>> {
    let ids: HashSet<_> = documents.iter().map(|document| document.id.as_str()).collect();
    let mut incoming: HashMap<&str, Vec<&Relation>> = HashMap::new();
    for relation in relations.iter().filter(|relation| relation.include_in_context) {
        incoming.entry(&relation.target_id).or_default().push(relation);
    }
    for edges in incoming.values_mut() {
        edges.sort_by(|a, b| (a.context_order, &a.created_at, &a.id).cmp(&(b.context_order, &b.created_at, &b.id)));
    }
    let mut visited = HashSet::new();
    let mut active = HashSet::new();
    let mut ordered = Vec::new();
    for start in starts {
        let mut stack = vec![(start.as_str(), false)];
        while let Some((id, exiting)) = stack.pop() {
            if exiting {
                active.remove(id);
                if visited.insert(id) { ordered.push(id.to_string()); }
                continue;
            }
            if visited.contains(id) { continue; }
            if !ids.contains(id) { return Err(ApiError::invalid(format!("上下文文稿不存在：{id}"))); }
            if !active.insert(id) { return Err(ApiError::invalid("参与上下文的连线形成了循环")); }
            stack.push((id, true));
            if let Some(edges) = incoming.get(id) {
                for edge in edges.iter().rev() { stack.push((&edge.source_id, false)); }
            }
        }
    }
    Ok(ordered)
}

pub fn utf16_to_byte(text: &str, offset: usize) -> Option<usize> {
    let mut units = 0;
    for (byte, character) in text.char_indices() {
        if units == offset { return Some(byte); }
        units += character.len_utf16();
        if units > offset { return None; }
    }
    (units == offset).then_some(text.len())
}

pub fn quote_at(text: &str, start: usize, quote: &str) -> bool {
    utf16_to_byte(text, start).is_some_and(|byte| text[byte..].starts_with(quote))
}

pub fn replace_excerpt(document: &mut Document, anchor: &Anchor, replacement: &str) -> Result<()> {
    let location = resolve_anchor(anchor, document);
    if !matches!(location.status, AnchorStatus::Exact | AnchorStatus::Relocated) { return Err(ApiError::invalid("原选段无法唯一定位，请重新选择原文并生成提案")); }
    let block = document.content.blocks.iter_mut().find(|block| Some(&block.id) == location.block_id.as_ref()).ok_or_else(|| ApiError::missing("原文块"))?;
    let start = utf16_to_byte(&block.text, location.start_utf16.ok_or_else(|| ApiError::internal("锚点偏移缺失"))?).ok_or_else(|| ApiError::internal("锚点偏移无效"))?;
    block.text.replace_range(start..start + anchor.quote.len(), replacement);
    document.content.editor_state = None;
    document.content.markdown = None;
    Ok(())
}

pub fn resolve_anchor(anchor: &Anchor, document: &Document) -> AnchorResolution {
    let mut result = AnchorResolution {
        anchor: anchor.clone(), status: AnchorStatus::Missing,
        current_version: document.current_version, block_id: None,
        start_utf16: None, end_utf16: None,
    };
    let original = document.content.blocks.iter().find(|block| block.id == anchor.block_id);
    let mut matches = Vec::new();
    for block in &document.content.blocks {
        for (byte, _) in block.text.match_indices(&anchor.quote) {
            let before = &block.text[..byte];
            let after = &block.text[byte + anchor.quote.len()..];
            let context_matches = before.ends_with(&anchor.prefix) && after.starts_with(&anchor.suffix);
            matches.push((block, before.encode_utf16().count(), context_matches));
        }
    }
    // 原块及周边内容优先，重复文本的位置变化保留为歧义状态。
    let local: Vec<_> = matches.iter().filter(|(block, _, _)| block.id == anchor.block_id).collect();
    let candidates = if local.is_empty() { matches.iter().collect::<Vec<_>>() } else { local };
    let contextual: Vec<_> = candidates.iter().copied().filter(|(_, _, matched)| *matched).collect();
    let selected = if candidates.len() == 1 {
        Some(candidates[0])
    } else if contextual.len() == 1 {
        Some(contextual[0])
    } else { None };
    if let Some((block, start, _)) = selected {
        result.status = if block.id == anchor.block_id && *start == anchor.start_utf16 {
            AnchorStatus::Exact
        } else { AnchorStatus::Relocated };
        result.block_id = Some(block.id.clone());
        result.start_utf16 = Some(*start);
        result.end_utf16 = Some(*start + anchor.quote.encode_utf16().count());
    } else if !candidates.is_empty() {
        result.status = AnchorStatus::Ambiguous;
    } else if original.is_some() {
        result.status = AnchorStatus::Changed;
    }
    result
}

// 使用 Reciprocal Rank Fusion 合并标题与正文的检索次序。
pub fn search(documents: &[Document], query: &str, limit: usize) -> Vec<serde_json::Value> {
    let query = query.to_lowercase();
    let mut title_hits = Vec::new();
    let mut body_hits = Vec::new();
    for document in documents {
        if let Some(position) = document.title.to_lowercase().find(&query) { title_hits.push((position, document)); }
        if let Some(position) = document.content.body().to_lowercase().find(&query) { body_hits.push((position, document)); }
    }
    title_hits.sort_by_key(|(position, document)| (*position, document.id.as_str()));
    body_hits.sort_by_key(|(position, document)| (*position, document.id.as_str()));
    let mut scores: HashMap<&str, (f32, &Document)> = HashMap::new();
    for ranking in [&title_hits, &body_hits] {
        for (rank, (_, document)) in ranking.iter().enumerate() {
            let entry = scores.entry(&document.id).or_insert((0.0, document));
            entry.0 += 1.0 / (60.0 + (rank + 1) as f32);
        }
    }
    let mut results: Vec<_> = scores.into_values().collect();
    results.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.id.cmp(&b.1.id)));
    results.into_iter().take(limit).map(|(score, document)| serde_json::json!({
        "document_id": document.id, "title": document.title,
        "version": document.current_version, "score": score / (2.0 / 61.0),
        "excerpt": document.content.body().chars().take(240).collect::<String>(),
    })).collect()
}
