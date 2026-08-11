@{
  SchemaVersion = '2026-08-11.3'
  Region = 'us-east1'
  FirestoreLocation = 'us-east1'
  # Gemini 3.6 Flash is served through Vertex's global endpoint. Keeping this
  # separate from the Cloud Run and Firestore regions prevents a regional
  # endpoint from rejecting the reference model used for chat and tools.
  VertexLocation = 'global'
  ServiceName = 'automnia-shopify-provisioner'
  ServiceAccountName = 'automnia-provisioner'
  PermanentBaseUrl = 'https://api.automnia.ai'
  PermanentDomain = 'api.automnia.ai'
  ShopifyCheckoutUrl = 'https://unbkay-k3.myshopify.com/collections/automnia-plans-and-refills'
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
    'firestore.googleapis.com'
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
    'roles/logging.logWriter'
    'roles/secretmanager.secretAccessor'
  )
  SecretBindings = @{
    SHOPIFY_WEBHOOK_SECRETS = 'automnia-shopify-webhook-secrets'
    ADMIN_API_TOKEN = 'automnia-admin-api-token'
  }
  MigrationSecrets = @(
    'automnia-shopify-webhook-secrets'
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
