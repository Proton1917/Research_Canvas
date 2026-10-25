use axum::{Json, extract::{Path, State}, http::StatusCode};
use rusqlite::{Connection, params};
use serde::Deserialize;

use crate::{AppState, db, error::{ApiError, Result}, model::*};

pub fn needs_evidence(status: &ClaimStatus) -> bool { matches!(status, ClaimStatus::Verified | ClaimStatus::Supported | ClaimStatus::Established | ClaimStatus::Refuted) }

pub fn refresh(connection: &Connection, relation: &mut Relation) -> Result<()> {
    let Some(claim) = relation.claim.as_mut() else { return Ok(()); };
    let Some(review) = claim.reviews.last() else { claim.review_required = needs_evidence(&claim.status); return Ok(()); };
    claim.review_required = review.claim_revision != claim.revision;
    for source in &review.evidence {
        if db::document(connection, &source.document_id)?.current_version != source.version { claim.review_required = true; }
    }
    Ok(())
}

pub fn validate_evidence(connection: &Connection, workspace_id: &str, evidence: &[EvidenceRef]) -> Result<()> {
    for source in evidence {
        db::scoped_document(connection, &source.document_id, workspace_id)?;
        db::version(connection, &source.document_id, source.version)?;
        if let Some(id) = &source.anchor_id {
            let anchor = db::anchor(connection, id)?;
            if anchor.document_id != source.document_id || anchor.version != source.version || anchor.workspace_id != workspace_id { return Err(ApiError::invalid("证据锚点与文稿版本不一致")); }
        }
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReviewInput {
    pub expected_claim_revision: i64,
    pub status: ClaimStatus,
    pub evidence: Vec<EvidenceRef>,
    pub reason: String,
    pub confirmed: bool,
}

pub async fn review(State(state): State<AppState>, Path(id): Path<String>, Json(mut input): Json<ReviewInput>) -> Result<Json<Relation>> {
    if !input.confirmed || input.reason.trim().is_empty() { return Err(ApiError::invalid("研究状态变更需要人工确认和判断依据")); }
    if input.status == ClaimStatus::Verified { input.status = ClaimStatus::Established; }
    if needs_evidence(&input.status) && input.evidence.is_empty() { return Err(ApiError::invalid("该研究状态需要带版本的证据")); }
    if input.status == ClaimStatus::Refuted && !input.evidence.iter().any(|source| source.role == EvidenceRole::Counterexample) { return Err(ApiError::invalid("被反驳状态需要反例证据")); }
    if matches!(input.status, ClaimStatus::Supported | ClaimStatus::Established) && !input.evidence.iter().any(|source| matches!(source.role, EvidenceRole::Support | EvidenceRole::Derivation)) { return Err(ApiError::invalid("支持状态需要支持证据或论证来源")); }
    Ok(Json(state.db.call(move |connection| {
        let transaction = connection.transaction()?;
        let mut relation = db::relation(&transaction, &id)?;
        validate_evidence(&transaction, &relation.workspace_id, &input.evidence)?;
        let claim = relation.claim.as_mut().ok_or_else(|| ApiError::invalid("请先填写研究关系的对应与条件"))?;
        if claim.revision != input.expected_claim_revision {
            let mut error = ApiError::new(StatusCode::CONFLICT, "claim_version_conflict", "研究关系已更新，请读取当前内容后确认");
            error.details = serde_json::json!({"current_version":claim.revision,"current_claim_revision":claim.revision});
            return Err(error);
        }
        claim.revision += 1;
        claim.status = input.status.clone();
        claim.reviews.push(ClaimReview { claim_revision: claim.revision, status: input.status, evidence: input.evidence, reason: input.reason, confirmed_at: now(), confirmed_by: "local_user".into() });
        claim.review_required = false;
        transaction.execute("UPDATE relations SET claim=? WHERE id=?", params![db::encode(claim)?, relation.id])?;
        db::touch(&transaction, &relation.workspace_id)?;
        refresh(&transaction, &mut relation)?;
        transaction.commit()?;
        Ok(relation)
    }).await?))
}

pub async fn read(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<Relation>> {
    Ok(Json(state.db.call(move |connection| db::relation(connection, &id)).await?))
}
