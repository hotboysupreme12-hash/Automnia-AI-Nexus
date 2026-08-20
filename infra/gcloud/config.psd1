@{
  SchemaVersion = '2026-08-13.4'
  Region = 'us-east1'
  FirestoreLocation = 'us-east1'
  # Automnia's Gemini 3.7 Flash relay is served through Vertex's global endpoint. Keeping this
  # separate from the Cloud Run and Firestore regions prevents a regional
  # endpoint from rejecting the reference model used for chat and tools.
  VertexLocation = 'global'
  AutomniaRelayModel = 'gemini-3.7-flash'
  ServiceName = 'automnia-shopify-provisioner'
  ServiceAccountName = 'automnia-provisioner'
  KnowledgeDataStoreId = 'automnia-knowledge'
  KnowledgeEngineId = 'automnia-assistant-grounded'
  KnowledgeModelVersion = 'gemini-3.1-pro-preview/answer_gen/v1'
  KnowledgeFallbackModelVersion = 'gemini-2.5-flash/answer_gen/v1'
  PermanentBaseUrl = 'https://api.automnia.ai'
  PermanentDomain = 'api.automnia.ai'
  ShopifyStoreDomain = 'unbkay-k3.myshopify.com'
  ShopifyAppClientId = 'd0972d80b936c44961e9490b1d113432'
  ShopifyApiVersion = '2026-07'
  ShopifyCheckoutUrl = 'https://unbkay-k3.myshopify.com/collections/automnia-plans-and-refills'
  GmailSender = 'hotboysupreme2@gmail.com'
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
    GMAIL_OAUTH_CREDENTIALS = 'automnia-gmail-oauth-credentials'
    ADMIN_API_TOKEN = 'automnia-admin-api-token'
  }
  MigrationSecrets = @(
    'automnia-shopify-webhook-secrets'
    'automnia-shopify-admin-api-token'
    'automnia-gmail-oauth-credentials'
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
