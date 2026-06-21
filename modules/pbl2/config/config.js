// PBL2 配置文件 - 优化版（像 DeepSeek 网页体验）
require('dotenv').config();

module.exports = {
  // AstrBot Webhook 配置
  astrbot: {
    enabled: process.env.ASTRBOT_ENABLED !== 'false',
    mode: process.env.ASTRBOT_MODE || 'webhook',
    baseURL: process.env.ASTRBOT_BASE_URL || 'http://127.0.0.1:6185',
    apiKey: process.env.ASTRBOT_API_KEY || '',
    timeoutMs: Number(process.env.ASTRBOT_TIMEOUT_MS || 12000),
    maxRetries: Number(process.env.ASTRBOT_MAX_RETRIES || 1),
    retryDelayBase: Number(process.env.ASTRBOT_RETRY_DELAY_BASE || 600),
    sessionPrefix: process.env.ASTRBOT_SESSION_PREFIX || 'medical-pbl',
    // 机器人2号=B同学, 机器人3号=C同学, 机器人4号=A教授
    webhookUrls: {
      // 同机上云默认策略：优先读取环境变量；未配置时仅提供本机占位路径（需在 .env 中填入真实 webhook）
      B: process.env.ASTRBOT_YU_WEBHOOK || 'http://127.0.0.1:6185/api/platform/webhook/YOUR_YU_WEBHOOK_ID',
      C: process.env.ASTRBOT_PENG_WEBHOOK || 'http://127.0.0.1:6185/api/platform/webhook/YOUR_PENG_WEBHOOK_ID',
      teacher: process.env.ASTRBOT_TEACHER_WEBHOOK || 'http://127.0.0.1:6185/api/platform/webhook/YOUR_TEACHER_WEBHOOK_ID',
    },
  },

  // 兼容保留：仅在需要直接调用 DeepSeek 时使用
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    modelChat: 'deepseek-chat',
    modelReasoner: 'deepseek-reasoner',
    chatParams: {
      temperature: 0.9,
      maxTokens: 700,
      timeout: 15000,
    },
    reasonerParams: {
      temperature: 0.4,
      maxTokens: 1200,
      timeout: 28000,
    },
    maxRetries: 1,
    retryDelayBase: 1000,
    retryDelayMax: 20000,
  },

  // 并发控制
  concurrency: {
    globalMaxConcurrent: 10,
    perRoomLock: true,
  },

  // 分段发送配置（像真人打字）
  chunking: {
    minIntervalMs: 300,
    maxIntervalMs: 900,
    teacherSegments: { min: 2, max: 4 },
    studentSegments: { min: 1, max: 3 },
    maxCharsPerSegment: 180,
  },

  // 上下文裁剪
  context: {
    recentMessagesCount: 10,       // 最近10条对话
    maxRecentChars: 1400,          // 最近对话裁剪到1400字
    keyFactsMax: 6,                // 最多6条关键事实
    openLoopsMax: 3,               // 最多3条未闭环
    lessonMemoryBullets: 6,        // 最多6条课堂记忆
  },

  // 提示词模式（用于 AstrBot 提示强度切换）
  promptModes: {
    concisePromptMaxChars: 3600,
    rigorousPromptMaxChars: 4600,
  },

  // 调试
  debug: true,
  pipelineVersion: 'pbl2-astrbot-v1.0',
};

