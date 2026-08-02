/**
 * Provider metadata is static product configuration. Keeping it outside the
 * executable control-plane module makes provider additions reviewable without
 * crossing runtime, session, or process-management code.
 */

export type OAuthProviderMetadata = {
  provider: 'google' | 'openai'
  docs: string
  redirectUri: string
  scopes: string[]
  clientIdEnvKeys: string[]
  clientSecretEnvKeys: string[]
  projectIdEnvKeys: string[]
}

export type AuthProviderCatalogEntry = {
  label: string
  envKeys: string[]
  docs: string
  apiKeyUrl?: string
  optionalAuth?: boolean
  oauth?: OAuthProviderMetadata
  subscriptionAuth?: {
    label: string
    docs: string
    setupCommand: string
  }
}

export const GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:8085/oauth2callback'

export const GOOGLE_OAUTH_CLIENT_ID_KEYS = [
  'DYSTOPAI_GOOGLE_OAUTH_CLIENT_ID',
  'OPENCLAW_GEMINI_OAUTH_CLIENT_ID',
  'GEMINI_CLI_OAUTH_CLIENT_ID',
]

export const GOOGLE_OAUTH_CLIENT_SECRET_KEYS = [
  'DYSTOPAI_GOOGLE_OAUTH_CLIENT_SECRET',
  'OPENCLAW_GEMINI_OAUTH_CLIENT_SECRET',
  'GEMINI_CLI_OAUTH_CLIENT_SECRET',
]

export const GOOGLE_PROJECT_ID_KEYS = ['GOOGLE_CLOUD_PROJECT', 'GOOGLE_PROJECT_ID', 'GCP_PROJECT', 'GCLOUD_PROJECT']

export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/generative-language.retriever',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

export const OPENAI_CODEX_OAUTH_REDIRECT_URI = 'http://localhost:1455/auth/callback'

export const OPENAI_CODEX_OAUTH_SCOPES = ['openid', 'profile', 'email', 'offline_access']

export const OPENCLAW_PROVIDER_DOCS_URL = 'https://docs.openclaw.ai/concepts/model-providers'

export const AUTH_PROVIDER_CATALOG: Record<string, AuthProviderCatalogEntry> = {
  openai: {
    label: 'OpenAI / Codex',
    envKeys: ['OPENAI_API_KEY'],
    docs: 'https://docs.openclaw.ai/providers/openai',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    oauth: {
      provider: 'openai',
      docs: 'https://docs.openclaw.ai/providers/openai',
      redirectUri: OPENAI_CODEX_OAUTH_REDIRECT_URI,
      scopes: OPENAI_CODEX_OAUTH_SCOPES,
      clientIdEnvKeys: [],
      clientSecretEnvKeys: [],
      projectIdEnvKeys: [],
    },
  },
  anthropic: {
    label: 'Anthropic',
    envKeys: ['ANTHROPIC_API_KEY'],
    docs: 'https://docs.openclaw.ai/providers/anthropic',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    subscriptionAuth: {
      label: 'Claude Code subscription',
      docs: 'https://docs.openclaw.ai/providers/anthropic',
      setupCommand: 'openclaw models auth login --provider anthropic --method setup-token',
    },
  },
  google: {
    label: 'Google Gemini',
    envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    docs: 'https://ai.google.dev/gemini-api/docs/oauth',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    oauth: {
      provider: 'google',
      docs: 'https://ai.google.dev/gemini-api/docs/oauth',
      redirectUri: GOOGLE_OAUTH_REDIRECT_URI,
      scopes: GOOGLE_OAUTH_SCOPES,
      clientIdEnvKeys: GOOGLE_OAUTH_CLIENT_ID_KEYS,
      clientSecretEnvKeys: GOOGLE_OAUTH_CLIENT_SECRET_KEYS,
      projectIdEnvKeys: GOOGLE_PROJECT_ID_KEYS,
    },
  },
  'google-vertex': {
    label: 'Google Vertex AI',
    envKeys: [],
    docs: 'https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstarts/quickstart-multimodal',
  },
  deepseek: {
    label: 'DeepSeek',
    envKeys: ['DEEPSEEK_API_KEY'],
    docs: 'https://api-docs.deepseek.com/',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  },
  opencode: {
    label: 'OpenCode',
    envKeys: ['OPENCODE_API_KEY', 'OPENCODE_ZEN_API_KEY'],
    docs: 'https://docs.openclaw.ai/concepts/models',
  },
  'opencode-go': {
    label: 'OpenCode Go',
    envKeys: ['OPENCODE_API_KEY', 'OPENCODE_ZEN_API_KEY'],
    docs: 'https://docs.openclaw.ai/concepts/models',
  },
  openrouter: {
    label: 'OpenRouter',
    envKeys: ['OPENROUTER_API_KEY'],
    docs: 'https://openrouter.ai/docs/quickstart',
    apiKeyUrl: 'https://openrouter.ai/settings/keys',
  },
  xai: {
    label: 'xAI / Grok',
    envKeys: ['XAI_API_KEY'],
    docs: 'https://docs.x.ai/docs/overview',
    apiKeyUrl: 'https://console.x.ai/',
  },
  groq: {
    label: 'Groq',
    envKeys: ['GROQ_API_KEY'],
    docs: 'https://console.groq.com/docs/quickstart',
    apiKeyUrl: 'https://console.groq.com/keys',
  },
  mistral: {
    label: 'Mistral',
    envKeys: ['MISTRAL_API_KEY'],
    docs: 'https://docs.mistral.ai/api/',
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
  },
  meta: {
    label: 'Meta',
    envKeys: ['MODEL_API_KEY'],
    docs: 'https://docs.openclaw.ai/providers/meta',
  },
  qwen: {
    label: 'Qwen',
    envKeys: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
    docs: 'https://www.alibabacloud.com/help/en/model-studio/get-api-key',
  },
  qwencloud: {
    label: 'Qwen Cloud',
    envKeys: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  dashscope: {
    label: 'DashScope',
    envKeys: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
    docs: 'https://www.alibabacloud.com/help/en/model-studio/get-api-key',
  },
  modelstudio: {
    label: 'Model Studio',
    envKeys: ['DASHSCOPE_API_KEY', 'QWEN_API_KEY'],
    docs: 'https://www.alibabacloud.com/help/en/model-studio/get-api-key',
  },
  'qwen-cli': {
    label: 'Qwen CLI',
    envKeys: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  'qwen-oauth': {
    label: 'Qwen OAuth',
    envKeys: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  'qwen-portal': {
    label: 'Qwen Portal',
    envKeys: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  kimi: {
    label: 'Kimi',
    envKeys: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    docs: 'https://platform.moonshot.ai/docs',
  },
  'kimi-coding': {
    label: 'Kimi Coding',
    envKeys: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  moonshot: {
    label: 'Moonshot',
    envKeys: ['MOONSHOT_API_KEY', 'KIMI_API_KEY'],
    docs: 'https://platform.moonshot.ai/docs',
  },
  cerebras: {
    label: 'Cerebras',
    envKeys: ['CEREBRAS_API_KEY'],
    docs: 'https://inference-docs.cerebras.ai/quickstart',
  },
  deepinfra: {
    label: 'DeepInfra',
    envKeys: ['DEEPINFRA_API_KEY'],
    docs: 'https://deepinfra.com/docs',
    apiKeyUrl: 'https://deepinfra.com/dash/api_keys',
  },
  fireworks: {
    label: 'Fireworks',
    envKeys: ['FIREWORKS_API_KEY'],
    docs: 'https://docs.fireworks.ai/getting-started/introduction',
  },
  together: {
    label: 'Together',
    envKeys: ['TOGETHER_API_KEY'],
    docs: 'https://docs.together.ai/docs/quickstart',
  },
  huggingface: {
    label: 'Hugging Face',
    envKeys: ['HUGGINGFACE_API_KEY', 'HF_TOKEN'],
    docs: 'https://huggingface.co/docs/hub/security-tokens',
  },
  nvidia: {
    label: 'NVIDIA',
    envKeys: ['NVIDIA_API_KEY'],
    docs: 'https://docs.api.nvidia.com/',
  },
  novita: {
    label: 'Novita',
    envKeys: ['NOVITA_API_KEY'],
    docs: 'https://novita.ai/docs',
  },
  'novita-ai': {
    label: 'Novita AI',
    envKeys: ['NOVITA_API_KEY'],
    docs: 'https://novita.ai/docs',
  },
  novitaai: {
    label: 'Novita AI',
    envKeys: ['NOVITA_API_KEY'],
    docs: 'https://novita.ai/docs',
  },
  chutes: {
    label: 'Chutes',
    envKeys: ['CHUTES_API_KEY'],
    docs: 'https://chutes.ai/docs',
  },
  fal: {
    label: 'fal',
    envKeys: ['FAL_KEY', 'FAL_API_KEY'],
    docs: 'https://fal.ai/docs',
  },
  litellm: {
    label: 'LiteLLM',
    envKeys: ['LITELLM_API_KEY'],
    docs: 'https://docs.litellm.ai/docs/',
  },
  'microsoft-foundry': {
    label: 'Microsoft Foundry',
    envKeys: ['AZURE_AI_API_KEY', 'AZURE_OPENAI_API_KEY', 'MICROSOFT_FOUNDRY_API_KEY'],
    docs: 'https://learn.microsoft.com/en-us/azure/ai-foundry/',
  },
  azure: {
    label: 'Azure Speech',
    envKeys: ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_API_KEY', 'SPEECH_KEY'],
    docs: 'https://learn.microsoft.com/en-us/azure/ai-services/speech-service/',
  },
  'azure-speech': {
    label: 'Azure Speech',
    envKeys: ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_API_KEY', 'SPEECH_KEY'],
    docs: 'https://learn.microsoft.com/en-us/azure/ai-services/speech-service/',
  },
  perplexity: {
    label: 'Perplexity',
    envKeys: ['PERPLEXITY_API_KEY', 'PPLX_API_KEY'],
    docs: 'https://docs.perplexity.ai/',
  },
  exa: {
    label: 'Exa',
    envKeys: ['EXA_API_KEY'],
    docs: 'https://docs.exa.ai/',
  },
  tavily: {
    label: 'Tavily',
    envKeys: ['TAVILY_API_KEY'],
    docs: 'https://docs.tavily.com/',
  },
  firecrawl: {
    label: 'Firecrawl',
    envKeys: ['FIRECRAWL_API_KEY'],
    docs: 'https://docs.firecrawl.dev/',
  },
  parallel: {
    label: 'Parallel',
    envKeys: ['PARALLEL_API_KEY'],
    docs: 'https://docs.parallel.ai/',
  },
  'parallel-free': {
    label: 'Parallel Free',
    envKeys: ['PARALLEL_API_KEY'],
    docs: 'https://docs.parallel.ai/',
  },
  deepgram: {
    label: 'Deepgram',
    envKeys: ['DEEPGRAM_API_KEY'],
    docs: 'https://developers.deepgram.com/docs',
  },
  elevenlabs: {
    label: 'ElevenLabs',
    envKeys: ['ELEVENLABS_API_KEY', 'XI_API_KEY'],
    docs: 'https://elevenlabs.io/docs',
  },
  minimax: {
    label: 'MiniMax',
    envKeys: ['MINIMAX_API_KEY'],
    docs: 'https://www.minimaxi.com/document/guides',
  },
  'minimax-portal': {
    label: 'MiniMax Portal',
    envKeys: ['MINIMAX_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  byteplus: {
    label: 'BytePlus',
    envKeys: ['BYTEPLUS_API_KEY', 'ARK_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  'byteplus-plan': {
    label: 'BytePlus Plan',
    envKeys: ['BYTEPLUS_API_KEY', 'ARK_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  volcengine: {
    label: 'Volcengine',
    envKeys: ['VOLCENGINE_API_KEY', 'ARK_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  'volcengine-plan': {
    label: 'Volcengine Plan',
    envKeys: ['VOLCENGINE_API_KEY', 'ARK_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  stepfun: {
    label: 'StepFun',
    envKeys: ['STEPFUN_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  'stepfun-plan': {
    label: 'StepFun Plan',
    envKeys: ['STEPFUN_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  zai: {
    label: 'Z.AI',
    envKeys: ['ZAI_API_KEY', 'GLM_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  arcee: {
    label: 'Arcee',
    envKeys: ['ARCEE_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  gmi: {
    label: 'GMI',
    envKeys: ['GMI_API_KEY', 'GMI_CLOUD_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  'gmi-cloud': {
    label: 'GMI Cloud',
    envKeys: ['GMI_CLOUD_API_KEY', 'GMI_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  gmicloud: {
    label: 'GMI Cloud',
    envKeys: ['GMI_CLOUD_API_KEY', 'GMI_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  venice: {
    label: 'Venice',
    envKeys: ['VENICE_API_KEY'],
    docs: 'https://docs.venice.ai/',
  },
  synthetic: {
    label: 'Synthetic',
    envKeys: ['SYNTHETIC_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  qianfan: {
    label: 'Qianfan',
    envKeys: ['QIANFAN_API_KEY', 'ERNIE_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  'tencent-tokenhub': {
    label: 'Tencent TokenHub',
    // TOKENHUB_API_KEY is the current OpenClaw/Tencent contract. Keep the
    // older names as secondary compatibility fallbacks for existing installs.
    envKeys: ['TOKENHUB_API_KEY', 'TENCENT_TOKENHUB_API_KEY', 'TENCENT_API_KEY'],
    docs: 'https://docs.openclaw.ai/providers/tencent',
  },
  'tencent-tokenplan': {
    label: 'Tencent TokenPlan',
    envKeys: ['TOKENPLAN_API_KEY'],
    docs: 'https://docs.openclaw.ai/providers/tencent',
  },
  'vercel-ai-gateway': {
    label: 'Vercel AI Gateway',
    envKeys: ['VERCEL_AI_GATEWAY_API_KEY', 'VERCEL_API_KEY'],
    docs: 'https://vercel.com/docs/ai-gateway',
  },
  xiaomi: {
    label: 'Xiaomi',
    envKeys: ['XIAOMI_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  'xiaomi-token-plan': {
    label: 'Xiaomi Token Plan',
    envKeys: ['XIAOMI_TOKEN_PLAN_API_KEY', 'XIAOMI_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  vydra: {
    label: 'Vydra',
    envKeys: ['VYDRA_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  runway: {
    label: 'Runway',
    envKeys: ['RUNWAY_API_KEY'],
    docs: 'https://docs.dev.runwayml.com/',
  },
  alibaba: {
    label: 'Alibaba',
    envKeys: ['ALIBABA_API_KEY', 'DASHSCOPE_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  'cloudflare-ai-gateway': {
    label: 'Cloudflare AI Gateway',
    envKeys: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_AI_GATEWAY_API_KEY'],
    docs: 'https://developers.cloudflare.com/ai-gateway/',
  },
  'github-copilot': {
    label: 'GitHub Copilot',
    envKeys: ['GITHUB_TOKEN', 'GITHUB_COPILOT_TOKEN'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  'copilot-proxy': {
    label: 'Copilot Proxy',
    envKeys: ['COPILOT_PROXY_API_KEY', 'GITHUB_COPILOT_TOKEN'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  kilocode: {
    label: 'KiloCode',
    envKeys: ['KILOCODE_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  'google-gemini-cli': {
    label: 'Google Gemini CLI',
    envKeys: [],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
    optionalAuth: true,
  },
  ollama: {
    label: 'Ollama',
    envKeys: ['OLLAMA_API_KEY'],
    docs: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
    optionalAuth: true,
  },
  'ollama-cloud': {
    label: 'Ollama Cloud',
    envKeys: ['OLLAMA_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
  },
  lmstudio: {
    label: 'LM Studio',
    envKeys: ['LMSTUDIO_API_KEY', 'LM_API_TOKEN'],
    docs: 'https://lmstudio.ai/docs/app/api',
    optionalAuth: true,
  },
  vllm: {
    label: 'vLLM',
    envKeys: ['VLLM_API_KEY'],
    docs: 'https://docs.vllm.ai/',
    optionalAuth: true,
  },
  sglang: {
    label: 'SGLang',
    envKeys: ['SGLANG_API_KEY'],
    docs: 'https://docs.sglang.ai/',
    optionalAuth: true,
  },
  comfy: {
    label: 'Comfy',
    envKeys: ['COMFY_API_KEY', 'COMFY_CLOUD_API_KEY'],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
    optionalAuth: true,
  },
  searxng: {
    label: 'SearXNG',
    envKeys: ['SEARXNG_API_KEY'],
    docs: 'https://docs.searxng.org/',
    optionalAuth: true,
  },
  duckduckgo: {
    label: 'DuckDuckGo',
    envKeys: [],
    docs: OPENCLAW_PROVIDER_DOCS_URL,
    optionalAuth: true,
  },
  grok: {
    label: 'Grok Search',
    envKeys: ['XAI_API_KEY'],
    docs: 'https://docs.x.ai/docs/overview',
  },
}

export const AUTH_ENV_MAP = Object.fromEntries(
  Object.entries(AUTH_PROVIDER_CATALOG).map(([provider, entry]) => [provider, entry.envKeys]),
) as Record<string, string[]>
