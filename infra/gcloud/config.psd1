@{
  SchemaVersion = '2026-08-11.1'
  Region = 'us-east1'
  FirestoreLocation = 'us-east1'
  VertexLocation = 'us-central1'
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
