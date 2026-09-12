@{
  SchemaVersion = '2026-09-12.1'
  Region = 'us-east1'
  FirestoreLocation = 'us-east1'
  # Automnia's Gemini 3.7 Flash relay is served through Vertex's global endpoint. Keeping this
  # separate from the Cloud Run and Firestore regions prevents a regional
  # endpoint from rejecting the reference model used for chat and tools.
  VertexLocation = 'global'
  AutomniaRelayModel = 'gemini-3.7-flash'
  AutomniaRelayFallbackModels = @('gemini-3.6-flash', 'gemini-2.5-flash')
  # Models exposed to customer clients. The primary/fallback chain above is
  # still the only operational chain used after a request is accepted.
  AutomniaRelaySelectableModels = @('gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-2.5-flash')
  # Customer-facing credits are a compact display unit. The Cloud Run ledger
  # remains authoritative in raw Vertex tokens.
  TokensPerCredit = 1000
  # Hosted-credit token budget defaults. The relay still honors an explicit
  # caller max_tokens value, bounded by the configured maximum.
  RelayMaxInputTokens = 8192
  RelayMaxOutputTokens = 3072
  RelayTextOutputTokens = 1536
  RelayToolOutputTokens = 2048
  RelayMaxToolTokens = 2048
  RelayMaxTools = 24
  RelayMaxSystemChars = 6000
  RelayMaxMessageChars = 12000
  RelayMaxToolResultChars = 6000
  RelayMaxHistoryMessages = 8
  RelayMaxInlineImages = 1
  RelayMaxInlineImageChars = 400000
  ServiceName = 'automnia-shopify-provisioner'
  ServiceAccountName = 'automnia-provisioner'
  KnowledgeDataStoreId = 'automnia-knowledge'
  KnowledgeEngineId = 'automnia-assistant-grounded'
  KnowledgeModelVersion = 'gemini-3.1-pro-preview/answer_gen/v1'
  KnowledgeFallbackModelVersion = 'gemini-2.5-flash/answer_gen/v1'
  PermanentBaseUrl = 'https://api.automnia.app'
  PermanentDomain = 'api.automnia.app'
  # Private, uniformly-access-controlled GCS bucket for customer installers.
  # Leave blank to derive "$ProjectId-automnia-installers" during deployment.
  InstallerBucket = ''
  InstallerSignedUrlMinutes = 10
  InstallerWindowsX64Object = 'releases/current/windows/Automnia-Setup-x64.exe'
  InstallerMacosArm64Object = 'releases/current/macos/Automnia-AI-Nexus-arm64.dmg'
  InstallerMacosX64Object = 'releases/current/macos/Automnia-AI-Nexus-x64.dmg'
  InstallerLinuxAppImageX64Object = 'releases/current/linux/Automnia-AI-Nexus-x86_64.AppImage'
  InstallerLinuxDebX64Object = 'releases/current/linux/Automnia-AI-Nexus-x86_64.deb'
  ShopifyStoreDomain = 'automnia.app'
  ShopifyAppClientId = 'd0972d80b936c44961e9490b1d113432'
  ShopifyApiVersion = '2026-07'
  ShopifyCheckoutUrl = 'https://automnia.app/collections/automnia-plans-and-refills'
  EmailProvider = 'microsoft_graph'
  # Set this to the licensed Microsoft 365 mailbox that will send customer
  # license emails, for example licenses@automnia.app.
  EmailSender = 'support@automnia.app'
  VerificationMaxAgeMinutes = 30
  HealthTimeoutSeconds = 180
  DomainMappingTimeoutMinutes = 30
  DnsProjectId = ''
  DnsZone = ''
  MigrationBucketSuffix = 'automnia-firestore-migrations'
  RequiredApis = @(
    'aiplatform.googleapis.com'
    'artifactregistry.googleapis.com'
    'cloudbilling.googleapis.com'
    'cloudbuild.googleapis.com'
    'cloudresourcemanager.googleapis.com'
    'dns.googleapis.com'
    'discoveryengine.googleapis.com'
    'firestore.googleapis.com'
    'gmail.googleapis.com'
    'iam.googleapis.com'
    'iamcredentials.googleapis.com'
    'run.googleapis.com'
    'secretmanager.googleapis.com'
    'serviceusage.googleapis.com'
    'storage.googleapis.com'
  )
  RuntimeRoles = @(
    'roles/aiplatform.user'
    'roles/datastore.user'
    # The Help console calls Discovery Engine's Answer method on the private
    # Automnia knowledge serving config.
    'roles/discoveryengine.viewer'
    'roles/logging.logWriter'
    'roles/secretmanager.secretAccessor'
  )
  SecretBindings = @{
    SHOPIFY_WEBHOOK_SECRETS = 'automnia-shopify-webhook-secrets'
    SHOPIFY_ADMIN_API_TOKEN = 'automnia-shopify-admin-api-token'
    MICROSOFT_GRAPH_MAIL_CREDENTIALS = 'automnia-microsoft-graph-mail-credentials'
    ADMIN_API_TOKEN = 'automnia-admin-api-token'
  }
  MigrationSecrets = @(
    'automnia-shopify-webhook-secrets'
    'automnia-shopify-admin-api-token'
    'automnia-microsoft-graph-mail-credentials'
    'automnia-admin-api-token'
  )
  Collections = @(
    'automnia_licenses'
    'automnia_license_indexes'
    'automnia_credit_topups'
    'automnia_credit_usage'
    'automnia_shopify_webhook_events'
    'automnia_deployment_metadata'
  )
}
