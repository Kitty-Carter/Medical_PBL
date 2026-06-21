/**
 * DeepSeek API 客户端（chat/reasoner双模型）
 */

const OpenAI = require('openai');
const config = require('./config');

// 检查API key（优先使用环境变量，然后使用配置文件）
const apiKey = config.apiKey;
let deepseek = null;

if (apiKey && apiKey !== '') {
  deepseek = new OpenAI({
    apiKey,
    baseURL: config.baseURL
  });
  console.log('[DeepSeek] API客户端已初始化');
  if (!process.env.DEEPSEEK_API_KEY) {
    console.log('[DeepSeek] 使用config.js中的API Key');
  }
} else {
  console.warn('[DeepSeek] ⚠️ 未设置DEEPSEEK_API_KEY，将使用fallback模式');
}

/**
 * 调用 deepseek-chat（直接输出segments JSON）
 */
async function callChat(messages, options = {}) {
  // 如果没有API key，抛出错误让renderer fallback
  if (!deepseek) {
    throw new Error('DEEPSEEK_API_KEY not set');
  }
  
  const {
    temperature = config.models.chat.temperature.normal,
    maxTokens = config.models.chat.maxTokens,
    timeout = config.models.chat.timeout
  } = options;
  
  console.log(`[DeepSeek-Chat] temperature=${temperature}, maxTokens=${maxTokens}`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' }
    }, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const content = response.choices[0].message.content;
    const usage = {
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens
    };
    
    console.log(`[DeepSeek-Chat] 成功 tokens=${usage.totalTokens} contentLength=${content.length}`);
    
    return {
      content,
      usage,
      model: 'deepseek-chat'
    };
    
  } catch (error) {
    console.error(`[DeepSeek-Chat] 错误:`, error.message);
    
    // 重试逻辑
    if (error.status === 429 || error.status === 500 || error.status === 503) {
      console.log(`[DeepSeek-Chat] 重试 (${error.status})`);
      await sleep(1000 + Math.random() * 2000);
      return callChat(messages, options);
    }
    
    throw error;
  }
}

/**
 * 调用 deepseek-reasoner（仅关键场景）
 */
async function callReasoner(messages, options = {}) {
  // 如果没有API key，抛出错误让renderer fallback
  if (!deepseek) {
    throw new Error('DEEPSEEK_API_KEY not set');
  }
  
  const {
    temperature = config.models.reasoner.temperature,
    maxTokens = config.models.reasoner.maxTokens,
    timeout = config.models.reasoner.timeout
  } = options;
  
  console.log(`[DeepSeek-Reasoner] temperature=${temperature}, maxTokens=${maxTokens}`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await deepseek.chat.completions.create({
      model: 'deepseek-reasoner',
      messages,
      temperature,
      max_tokens: maxTokens
    }, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    // reasoner 返回 content + reasoning_content
    const content = response.choices[0].message.content;
    const reasoning = response.choices[0].message.reasoning_content;
    
    const usage = {
      promptTokens: response.usage.prompt_tokens,
      completionTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens
    };
    
    console.log(`[DeepSeek-Reasoner] 成功 tokens=${usage.totalTokens} reasoningLength=${reasoning?.length || 0}`);
    
    return {
      content,
      reasoning,
      usage,
      model: 'deepseek-reasoner'
    };
    
  } catch (error) {
    console.error(`[DeepSeek-Reasoner] 错误:`, error.message);
    
    // reasoner 失败降级到 chat
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      console.log(`[DeepSeek-Reasoner] 超时，降级到 chat`);
      return callChat(messages, { temperature: 0.6, maxTokens: 900 });
    }
    
    throw error;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  callChat,
  callReasoner
};
