const axios = require('axios');
const config = require('../config/config');
const { buildRolePrompt } = require('../../aiRoleCards');

const TEXT_FIELDS = ['content', 'message', 'reply', 'text', 'result', 'output', 'response', 'data'];

class AstrBotClient {
  constructor() {
    this.config = config.astrbot || {};
  }

  async chat({
    roleKey,
    roomCode,
    eventType,
    promptMode = 'normal',
    messages,
    senderName = 'Medical_PBL',
    senderId = 'medical-pbl',
  }) {
    if (!this.config.enabled) {
      throw new Error('AstrBot disabled');
    }
    const prompt = this.buildWebhookPrompt({ roleKey, roomCode, eventType, promptMode, messages });

    let lastError = null;
    const maxAttempts = Math.max(1, Number(this.config.maxRetries || 1));
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        if ((this.config.mode || 'openapi') === 'openapi') {
          return await this.callOpenApi({ roleKey, roomCode, prompt, senderName, eventType });
        }
        return await this.callWebhook({ roleKey, roomCode, prompt, senderName, senderId, eventType });
      } catch (error) {
        lastError = error;
        if (attempt < maxAttempts) {
          await sleep(Number(this.config.retryDelayBase || 600) * attempt);
        }
      }
    }

    throw new Error(`AstrBot request failed: ${lastError?.message || 'unknown_error'}`);
  }

  async *streamChat({
    roleKey,
    roomCode,
    eventType,
    promptMode = 'normal',
    messages,
    signal,
  }) {
    if (!this.config.enabled) {
      throw new Error('AstrBot disabled');
    }
    // Webhook 模式：非流式，一次性返回
    if ((this.config.mode || 'openapi') === 'webhook') {
      const prompt = this.buildWebhookPrompt({ roleKey, roomCode, eventType, promptMode, messages });
      const result = await this.callWebhook({
        roleKey,
        roomCode,
        prompt,
        senderName: 'Medical_PBL',
        senderId: 'medical-pbl',
        eventType,
        signal,
      });
      if (result?.content) {
        yield { type: 'delta', delta: result.content, fullText: result.content };
      }
      yield { type: 'done' };
      return;
    }

    const apiKey = String(this.config.apiKey || '').trim();
    const baseURL = String(this.config.baseURL || '').trim().replace(/\/+$/, '');
    if (!apiKey) {
      throw new Error('AstrBot OpenAPI key missing');
    }
    if (!baseURL) {
      throw new Error('AstrBot OpenAPI baseURL missing');
    }

    const prompt = this.buildRoomPrompt({ roomCode, promptMode, messages, roleKey, eventType });
    const sessionId = this.buildSessionId(roomCode, roleKey);
    // ASCII-safe header values: HTTP headers must only contain ASCII (0x00-0x7F)
    const safeRoleKey = String(roleKey).replace(/[^\x00-\x7F]/g, '');
    const safeRoomCode = String(roomCode).replace(/[^\x00-\x7F]/g, '');
    const fetchOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/event-stream',
        'X-Medical-PBL-Role': safeRoleKey,
        'X-Medical-PBL-Event': eventType || 'room_followup',
        'X-Medical-PBL-Room': safeRoomCode,
      },
      body: JSON.stringify({
        username: `medical_pbl_${roleKey}`,
        session_id: sessionId,
        message: prompt,
        enable_streaming: true,
      }),
    };
    if (signal) fetchOpts.signal = signal;
    const response = await fetch(`${baseURL}/api/v1/chat`, fetchOpts);

    if (!response.ok || !response.body) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`AstrBot OpenAPI status=${response.status} body=${errorBody.slice(0, 300)}`);
    }

    let lastFullText = '';
    for await (const rawEvent of iterateSSE(response.body)) {
      if (!rawEvent) continue;
      if (rawEvent === '[DONE]') {
        yield { type: 'done' };
        break;
      }

      const parsed = safeParseJson(rawEvent);
      const extracted = extractStreamingText(parsed ?? rawEvent);
      if (!extracted) continue;

      let delta = extracted;
      if (extracted.startsWith(lastFullText)) {
        delta = extracted.slice(lastFullText.length);
      }
      if (!delta) continue;

      lastFullText += delta;
      yield {
        type: 'delta',
        delta,
        fullText: lastFullText,
      };
    }
  }

  async callOpenApi({ roleKey, roomCode, prompt, senderName, eventType }) {
    const apiKey = String(this.config.apiKey || '').trim();
    const baseURL = String(this.config.baseURL || '').trim().replace(/\/+$/, '');
    if (!apiKey) {
      throw new Error('AstrBot OpenAPI key missing');
    }
    if (!baseURL) {
      throw new Error('AstrBot OpenAPI baseURL missing');
    }

    const sessionId = this.buildSessionId(roomCode, roleKey);
    const response = await axios.post(`${baseURL}/api/v1/chat`, {
      username: `medical_pbl_${roleKey}`,
      session_id: sessionId,
      message: prompt,
      enable_streaming: false,
    }, {
      timeout: Number(this.config.timeoutMs || 12000),
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Medical-PBL-Role': roleKey,
        'X-Medical-PBL-Event': eventType || 'rotation',
        'X-Medical-PBL-Room': roomCode,
      },
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`AstrBot OpenAPI status=${response.status} body=${extractResponseText(response.data) || ''}`);
    }

    const content = extractResponseText(response.data);
    if (!content) {
      throw new Error('AstrBot OpenAPI returned empty content');
    }

    return {
      content,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        promptChars: prompt.length,
      },
      model: `astrbot_openapi:${roleKey}`,
    };
  }

  async callWebhook({ roleKey, roomCode, prompt, senderName, senderId, eventType, signal }) {
    const webhookUrl = this.config.webhookUrls?.[roleKey];
    if (!webhookUrl) {
      throw new Error(`Missing AstrBot webhook for role=${roleKey}`);
    }
    const payload = this.buildPayload({
      prompt,
      roleKey,
      roomCode,
      senderName,
      senderId,
      eventType,
    });
    const reqConfig = {
      timeout: Number(this.config.timeoutMs || 12000),
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/json',
        'X-Medical-PBL-Role': roleKey,
        'X-Medical-PBL-Event': eventType || 'rotation',
      },
    };
    if (signal) reqConfig.signal = signal;
    const response = await axios.post(webhookUrl, payload, reqConfig);

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`AstrBot webhook status=${response.status} body=${extractResponseText(response.data) || ''}`);
    }

    const content = extractResponseText(response.data);
    if (!content) {
      throw new Error('AstrBot webhook returned empty content');
    }

    return {
      content,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        promptChars: prompt.length,
      },
      model: `astrbot_webhook:${roleKey}`,
    };
  }

  buildPayload({ prompt, roleKey, roomCode, senderName, senderId, eventType }) {
    const sessionId = this.buildSessionId(roomCode, roleKey);
    return {
      message: prompt,
      text: prompt,
      content: prompt,
      session_id: sessionId,
      conversation_id: roomCode,
      room_id: roomCode,
      user_id: senderId,
      username: senderName,
      metadata: {
        source: 'medical_pbl',
        roleKey,
        eventType,
        roomCode,
      },
    };
  }

  buildSessionId(roomCode, roleKey) {
    const prefix = this.config.sessionPrefix || 'medical-pbl';
    return `${prefix}:${roomCode}:${roleKey}`;
  }

    buildWebhookPrompt({ roleKey, roomCode, eventType, promptMode, messages }) {
    const roleDisplayName = {
      teacher: '机器人4号（A教授，AI教师）',
      B: '机器人2号（B同学，AI学生1）',
      C: '机器人3号（C同学，AI学生2）',
    }[roleKey] || roleKey;

    const respondHint = eventType === 'student_message_response'
      ? '【重要】刚才有真人学生发言，你必须针对学生的观点或问题做出回应，与真人学生交流讨论，不要自言自语。'
      : eventType === 'teacher_message_response'
        ? '【重要】刚才有教师发言，请针对教师的引导或问题做出回应。'
        : '请针对聊天记录中的最新发言做出回应，与教师、学生交流讨论。';

    const promptParts = [
      `你现在在 Medical_PBL 网页课堂中发言。`,
      `当前扮演：${roleDisplayName}`,
      `房间：${roomCode}`,
      respondHint,
      `输出要求：像真实群聊一样自然回复，不要输出 JSON，不要输出 markdown，直接说人话。`,
      `如果信息不足，就提出能改变诊疗路径的追问，不要空泛总结。`,
      '',
      '【最近聊天记录，请针对上述内容回复】',
      (Array.isArray(messages) ? messages : [])
        .map((message) => `[${message.role}] ${String(message.content || '').trim()}`)
        .filter(Boolean)
        .join('\n\n'),
    ];

    const prompt = promptParts.join('\n');
    const maxChars = promptMode === 'rigorous'
      ? Number(config.promptModes?.rigorousPromptMaxChars || 4600)
      : Number(config.promptModes?.concisePromptMaxChars || 3600);
    return prompt.length > maxChars ? prompt.slice(-maxChars) : prompt;
  }

  buildRoomPrompt({ roomCode, promptMode, messages, roleKey = 'B', eventType = '' }) {
    const roleDesc = {
      B: '机器人2号，名字叫B同学',
      C: '机器人3号，名字叫C同学',
      teacher: '机器人4号，名字叫A教授',
    }[roleKey] || '机器人2号，名字叫B同学';
    const respondHint = eventType === 'student_message_response'
      ? '【重要】刚才有真人学生发言，你必须针对学生的观点或问题做出回应，与真人学生交流讨论，不要自言自语。'
      : eventType === 'teacher_message_response'
        ? '【重要】刚才有教师发言，请针对教师的引导或问题做出回应。'
        : '请针对聊天记录中的最新发言做出回应，与教师、学生交流讨论。';

    // 读取角色技能卡，注入到 prompt 最前面作为 system-level 指令
    let roleCardPrompt = '';
    try {
      roleCardPrompt = buildRolePrompt(roleKey);
    } catch (err) {
      // buildRolePrompt 失败时静默降级，不影响主流程
      if (config.debug) {
        console.warn(`[AstrBot] buildRolePrompt failed for role=${roleKey}:`, err.message);
      }
    }

    const prompt = [
      roleCardPrompt,
      `你是 AstrBot 中的${roleDesc}。`,
      '你正在 Medical_PBL 网站的医学讨论房间里发言。',
      respondHint,
      '请严格围绕下面这一个房间的病例与聊天记录回复，不要切换到别的病例，不要引用外部陌生情境。',
      '请像真实群聊一样自然回应，不要解释系统设定，不要输出 JSON，不要输出 markdown。',
      `当前房间：${roomCode}`,
      '',
      '【最近聊天记录】',
      (Array.isArray(messages) ? messages : [])
        .map((message) => `[${message.role}] ${String(message.content || '').trim()}`)
        .filter(Boolean)
        .join('\n\n'),
    ].filter(Boolean).join('\n');

    const maxChars = promptMode === 'rigorous'
      ? Number(config.promptModes?.rigorousPromptMaxChars || 4600)
      : Number(config.promptModes?.concisePromptMaxChars || 3600);
    return prompt.length > maxChars ? prompt.slice(-maxChars) : prompt;
  }
}

function extractResponseText(data) {
  if (data == null) return '';
  if (typeof data === 'string') {
    return extractTextFromString(data);
  }
  if (Array.isArray(data)) {
    return data.map(extractResponseText).filter(Boolean).join('\n').trim();
  }
  if (typeof data !== 'object') {
    return String(data);
  }

  for (const field of TEXT_FIELDS) {
    if (typeof data[field] === 'string' && data[field].trim()) {
      return extractTextFromString(data[field]);
    }
  }

  for (const field of TEXT_FIELDS) {
    if (data[field] && typeof data[field] === 'object') {
      const nested = extractResponseText(data[field]);
      if (nested) return nested;
    }
  }

  return '';
}

function extractTextFromString(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (!text.includes('data:')) return text;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s*/, ''))
    .filter((line) => line && line !== '[DONE]');

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    try {
      const parsed = JSON.parse(line);
      const nested = extractResponseText(parsed);
      if (nested) return nested;
    } catch (_) {
      if (line) return line;
    }
  }
  return text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function* iterateSSE(stream) {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const dataLines = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);
      for (const dataLine of dataLines) {
        yield dataLine;
      }
    }
  }
}

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function extractStreamingText(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (typeof data !== 'object') return '';

  const candidates = [
    data.delta,
    data.content,
    data.text,
    data.message,
    data.output,
    data.response,
    data.data,
    data.choices?.[0]?.delta?.content,
    data.choices?.[0]?.message?.content,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
    if (candidate && typeof candidate === 'object') {
      const nested = extractStreamingText(candidate);
      if (nested) return nested;
    }
  }
  return '';
}

module.exports = {
  AstrBotClient,
  extractResponseText,
};
