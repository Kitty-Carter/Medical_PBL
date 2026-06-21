// DeepSeek API 配置
// 注意：实际生产环境应该使用环境变量，此文件仅供开发测试使用

module.exports = {
  // DeepSeek API Key
  apiKey: process.env.DEEPSEEK_API_KEY || '',
  
  // API Base URL
  baseURL: 'https://api.deepseek.com',
  
  // 模型配置
  models: {
    chat: {
      name: 'deepseek-chat',
      temperature: {
        normal: 1.1,
        rigorous: 0.7
      },
      maxTokens: 700,
      timeout: 45000 // 45秒
    },
    reasoner: {
      name: 'deepseek-reasoner',
      temperature: 0.4,
      maxTokens: 1200,
      timeout: 60000 // 60秒
    }
  },
  
  // 重试配置
  retry: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffFactor: 2
  },
  
  // 日志配置
  logging: {
    enabled: true,
    verbose: false,
    includeTokens: true
  }
};
