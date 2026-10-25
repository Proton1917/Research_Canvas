use std::{borrow::Cow, sync::OnceLock};

use latex2mathml::{DisplayStyle, latex_to_mathml};
use pulldown_cmark::{Event, Options, Parser};
use regex::Regex;

use crate::{canvas_proposal::{CanvasAction, GeneratedProposal}, model::{Run, RunStatus}};

// 对公式中一致重复转义的反斜杠生成候选，解析成功后采用。
fn corrected_math(math: &str, display: DisplayStyle) -> Option<String> {
    static SLASHES: OnceLock<Regex> = OnceLock::new();
    static COMMAND: OnceLock<Regex> = OnceLock::new();
    let slashes = SLASHES.get_or_init(|| Regex::new(r"\\+").expect("固定反斜杠表达式有效"));
    let command = COMMAND.get_or_init(|| Regex::new(r"\\+[A-Za-z]{2,}").expect("固定命令表达式有效"));
    if !command.is_match(math) { return None; }
    let layers = slashes.find_iter(math).map(|found| found.len().trailing_zeros()).min().unwrap_or(0);
    if layers == 0 { return None; }
    let factor = 1usize << layers;
    let corrected = slashes.replace_all(math, |capture: &regex::Captures<'_>| "\\".repeat(capture[0].len() / factor)).into_owned();
    latex_to_mathml(&corrected, display).ok().map(|_| corrected)
}

pub fn normalize(markdown: &str) -> Cow<'_, str> {
    if !markdown.contains(r"\\") { return Cow::Borrowed(markdown); }
    let options = Options::ENABLE_MATH | Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH;
    let mut replacements = Vec::new();
    for (event, range) in Parser::new_ext(markdown, options).into_offset_iter() {
        let (math, display) = match event {
            Event::InlineMath(math) => (math, DisplayStyle::Inline),
            Event::DisplayMath(math) => (math, DisplayStyle::Block),
            _ => continue,
        };
        let Some(corrected) = corrected_math(&math, display) else { continue; };
        if let Some(offset) = markdown[range.clone()].find(math.as_ref()) {
            replacements.push((range.start + offset..range.start + offset + math.len(), corrected));
        }
    }
    if replacements.is_empty() { return Cow::Borrowed(markdown); }
    let mut output = String::with_capacity(markdown.len());
    let mut cursor = 0;
    for (range, corrected) in replacements {
        output.push_str(&markdown[cursor..range.start]);
        output.push_str(&corrected);
        cursor = range.end;
    }
    output.push_str(&markdown[cursor..]);
    Cow::Owned(output)
}

fn replace(value: &mut String) {
    if let Cow::Owned(corrected) = normalize(value) { *value = corrected; }
}

pub fn normalize_generated(proposal: &mut GeneratedProposal) {
    replace(&mut proposal.answer);
    for action in &mut proposal.actions {
        match action {
            CanvasAction::CreateDocument { title, text, .. } => { replace(title); replace(text); }
            CanvasAction::ReplaceExcerpt { replacement, .. } => replace(replacement),
            CanvasAction::CreateRelation { label, mapping, preserved_operations, conditions, counterexamples, missing_proof, next_validation, .. } => {
                for text in [label, mapping, conditions, counterexamples, missing_proof, next_validation] { replace(text); }
                for text in preserved_operations { replace(text); }
            }
            CanvasAction::MoveObject { .. } => {},
        }
    }
}

pub fn normalize_run(run: &mut Run) {
    if run.status == RunStatus::Succeeded && run.canvas_proposal_id.is_some() { replace(&mut run.answer); }
}

#[cfg(test)]
mod tests {
    use super::normalize;

    #[test]
    fn corrects_reported_math_and_preserves_literals() {
        let input = "乘法积分 $\\\\leftrightarrow$ 重整化森林；`$\\\\leftrightarrow$`\n\n```latex\n$\\\\leftrightarrow$\n```";
        let expected = "乘法积分 $\\leftrightarrow$ 重整化森林；`$\\\\leftrightarrow$`\n\n```latex\n$\\\\leftrightarrow$\n```";
        assert_eq!(normalize(input), expected);
        assert_eq!(normalize(expected), expected);
    }

    #[test]
    fn preserves_matrix_rows_and_correct_commands() {
        let input = r"$$\begin{matrix}a & b \\ c & d\end{matrix}$$ 与 $U(\gamma_2 \circ \gamma_1)$";
        assert_eq!(normalize(input), input);
    }
}
