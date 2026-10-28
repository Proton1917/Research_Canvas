use serde::{Deserialize, Serialize};
use serde_json::Value;

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum DocumentKind {
    #[default]
    Document,
    Note,
    Discussion,
    Pdf,
    Image,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TextBlock {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub page: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
pub struct Content {
    #[serde(default)]
    pub blocks: Vec<TextBlock>,
    #[serde(default)]
    pub markdown: Option<String>,
    #[serde(default)]
    pub editor_state: Option<Value>,
}

impl Content {
    pub fn text(text: String) -> Self {
        Self {
            blocks: vec![TextBlock { id: id(), text, page: None }],
            ..Self::default()
        }
    }

    pub fn body(&self) -> String {
        self.blocks.iter().map(|block| block.text.as_str()).collect::<Vec<_>>().join("\n\n")
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub workspace_id: String,
    pub title: String,
    pub kind: DocumentKind,
    pub current_version: i64,
    pub metadata: Value,
    pub content: Content,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DocumentVersion {
    pub document_id: String,
    pub version: i64,
    pub title: String,
    pub content: Content,
    pub created_at: String,
    pub reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CanvasObject {
    pub id: String,
    pub document_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Canvas {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub revision: i64,
    pub objects: Vec<CanvasObject>,
    pub editor_state: Option<Value>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ClaimStatus {
    Analogy,
    Candidate,
    Verified,
    Supported,
    Established,
    Refuted,
}

pub fn initial_revision() -> i64 { 1 }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceRole { Support, Derivation, Counterexample }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvidenceRef {
    pub document_id: String,
    pub version: i64,
    #[serde(default)] pub anchor_id: Option<String>,
    pub role: EvidenceRole,
    pub note: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClaimReview {
    pub claim_revision: i64,
    pub status: ClaimStatus,
    pub evidence: Vec<EvidenceRef>,
    pub reason: String,
    pub confirmed_at: String,
    pub confirmed_by: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Claim {
    pub status: ClaimStatus,
    pub conditions: String,
    pub counterexamples: String,
    pub sources: Vec<String>,
    #[serde(default)] pub mapping: String,
    #[serde(default)] pub preserved_operations: Vec<String>,
    #[serde(default)] pub missing_proof: String,
    #[serde(default)] pub next_validation: String,
    #[serde(default = "initial_revision")] pub revision: i64,
    #[serde(default)] pub reviews: Vec<ClaimReview>,
    #[serde(default)] pub review_required: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Relation {
    pub id: String,
    pub workspace_id: String,
    pub source_id: String,
    pub target_id: String,
    #[serde(default)] pub source_ref: Option<crate::endpoints::ResearchEndpoint>,
    #[serde(default)] pub target_ref: Option<crate::endpoints::ResearchEndpoint>,
    pub kind: String,
    pub label: String,
    pub include_in_context: bool,
    pub context_order: i64,
    pub claim: Option<Claim>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Anchor {
    pub id: String,
    pub workspace_id: String,
    pub document_id: String,
    pub version: i64,
    pub block_id: String,
    pub quote: String,
    pub start_utf16: usize,
    pub prefix: String,
    pub suffix: String,
    pub page: Option<u32>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AnchorStatus {
    Exact,
    Relocated,
    Changed,
    Missing,
    Ambiguous,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AnchorResolution {
    pub anchor: Anchor,
    pub status: AnchorStatus,
    pub current_version: i64,
    pub block_id: Option<String>,
    pub start_utf16: Option<usize>,
    pub end_utf16: Option<usize>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ResearchMode {
    #[default]
    Discussion,
    Rewrite,
    Relation,
    Canvas,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ContextSource {
    pub number: usize,
    pub document_id: String,
    pub version: i64,
    pub title: String,
    pub content: String,
    pub anchor_id: Option<String>,
    pub anchor_status: Option<AnchorStatus>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Context {
    pub id: String,
    pub workspace_id: String,
    pub mode: ResearchMode,
    pub question: String,
    pub document_ids: Vec<String>,
    pub anchor_ids: Vec<String>,
    pub ordered_document_ids: Vec<String>,
    pub sources: Vec<ContextSource>,
    #[serde(default)]
    pub inherited_context_ids: Vec<String>,
    #[serde(default)]
    pub scenes: Vec<crate::scene::SceneSnapshot>,
    pub messages: Vec<Message>,
    pub character_count: usize,
    #[serde(default)]
    pub freshness: Option<crate::context::Freshness>,
    #[serde(default)]
    pub visuals: Vec<crate::visual::VisualInput>,
    #[serde(default)]
    pub origin: Option<RunOrigin>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunOrigin {
    pub canvas_id: String,
    pub source_ids: Vec<String>,
    pub write_region: Option<crate::scene::Bounds>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunPlacement {
    pub object_id: String,
    pub canvas_revision: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Queued,
    Running,
    Succeeded,
    Failed,
    Cancelled,
    Interrupted,
}

impl RunStatus {
    pub fn terminal(&self) -> bool {
        !matches!(self, Self::Queued | Self::Running)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub workspace_id: String,
    pub context_id: String,
    pub model: String,
    pub status: RunStatus,
    pub answer: String,
    pub model_used: Option<String>,
    pub usage: Option<Value>,
    pub error: Option<String>,
    pub document_id: Option<String>,
    pub proposal_id: Option<String>,
    #[serde(default)]
    pub canvas_proposal_id: Option<String>,
    #[serde(default)]
    pub origin: Option<RunOrigin>,
    #[serde(default)]
    pub placement: Option<RunPlacement>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RunProgress {
    pub sequence: u64,
    pub run: Run,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ProposalStatus {
    Pending,
    Applied,
    Reverted,
    Rejected,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Proposal {
    pub id: String,
    pub workspace_id: String,
    pub run_id: String,
    pub anchor_id: String,
    pub replacement: String,
    pub status: ProposalStatus,
    pub applied_version: Option<i64>,
    pub previous_version: Option<i64>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub workspace_id: String,
    pub filename: String,
    pub media_type: String,
    pub data_base64: String,
    pub created_at: String,
    #[serde(default)]
    pub temporary: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkspaceArchive {
    pub format_version: u32,
    pub workspace: Workspace,
    pub documents: Vec<Document>,
    pub versions: Vec<DocumentVersion>,
    pub canvases: Vec<Canvas>,
    pub relations: Vec<Relation>,
    pub anchors: Vec<Anchor>,
    pub contexts: Vec<Context>,
    pub runs: Vec<Run>,
    pub proposals: Vec<Proposal>,
    #[serde(default)]
    pub canvas_proposals: Vec<crate::canvas_proposal::CanvasProposal>,
    pub assets: Vec<Asset>,
    #[serde(default)]
    pub projects: Vec<crate::projects::Project>,
    #[serde(default)]
    pub project_entries: Vec<crate::projects::ProjectEntry>,
}
