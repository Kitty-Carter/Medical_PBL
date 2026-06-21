# PBL2 AI 回复机制说明

## 概述

PBL2 系统采用 DeepSeek API **单模型策略（deepseek-chat）**，实现"像 DeepSeek 网页一样自然"的对话体验，同时稳定扮演三个角色（A教授、B同学、C同学），并通过分段短消息输出节省 tokens。

**核心策略：** 全部使用 `deepseek-chat`，关键场景降低温度+增加tokens，而非使用 `deepseek-reasoner`（reasoner 不支持结构化 JSON 输出）。

---

## 1. 触发时机（事件驱动）

AI 回复由以下事件触发：

### 高优先级事件

| 事件类型 | 触发条件 | 调用角色 | 模型参数 |
|---------|---------|---------|---------|
| `teacher_opening` | 新病例开场（messages <= 1 且包含"开始"） | teacher | **严谨模式** (温度0.6, 1200 tokens) |
| `ai_paste_suspected` | 检测到 AI 长文粘贴（>500字且疑似AI生成） | teacher | **严谨模式** |
| `red_flag` | 危重信号（riskFlags.length > 0） | teacher | 正常模式 |
| `noise_redirect` | 噪声累积（noiseCount >= 2） | teacher | 正常模式 |

### 正常轮转事件

| 事件类型 | 触发条件 | 调用角色 | 模型参数 |
|---------|---------|---------|---------|
| `student_follow_up` | 学生发言 >50字 | B/C 轮换 | 正常模式 (温度1.1, 700 tokens) |
| `teacher_summary` | 每 8 轮触发一次阶段总结 | teacher | **严谨模式** |
| `rotation` | 默认轮换 | teacher → B → C | 正常模式 |

---

## 2. 单模型策略（全用 deepseek-chat）

### 2.1 模型配置

```javascript
// 统一使用 chat，参数分为两档

// 正常模式（80%+ 回合）
chatParams: {
  temperature: 1.1,  // 更自然
  maxTokens: 700,
  timeout: 15000 ms
}

// 严谨模式（<20% 回合，关键场景）
rigorousParams: {
  temperature: 0.6,  // 更严谨
  maxTokens: 1200,   // 更完整
  timeout: 20000 ms
}
```

### 2.2 严谨模式触发策略

**只在以下情况使用严谨模式：**

1. **新病例开场** (`teacher_opening`)：定议程、分工、追问
2. **AI长文消化** (`ai_paste_suspected`)：提炼争点、分工、追问
3. **阶段总结** (`teacher_summary`)：每 8 轮触发一次
4. **讨论失控** (`openLoops > 3`)：重整讨论方向

**其余一律使用正常模式**。

### 2.3 为什么不用 deepseek-reasoner？

- `deepseek-reasoner` 不支持 `response_format: json_object`
- reasoner 返回的 `content` 字段为空，推理过程在 `reasoning_content`
- reasoner 不适合结构化输出场景（JSON segments）
- 使用 chat + 参数优化更稳定、更省 token

---

## 3. 上下文组织（纪要化）

### 3.1 上下文裁剪策略

**禁止：**
- 每轮塞病例全文
- 每轮塞完整 transcript
- debug JSON 混入正文

**只包含：**
- 最近 15 条对话（裁剪到 2000 字）
- 2~6 条关键事实（尽量带数值/检查名）
- 1 条主矛盾
- 1~3 条未闭环问题
- ≤6 条课堂记忆要点

### 3.2 Messages 结构

每次 API 调用的 messages 组成：

```javascript
[
  { role: 'system', content: systemPrompt },        // 统一约束（短）
  { role: 'developer', content: outputProtocol },   // 输出协议（强约束）
  { role: 'developer', content: roleCard },         // 本轮角色规则卡
  { role: 'user', content: contextPack }            // 纪要化上下文
]
```

### 3.3 短角色规则卡（每轮必带，<=350字）

**TeacherRoleCard（A教授）：**
- 主持人，不是答题器
- 2~4段：承接 → 纠偏 → 分工 → 追问A/B
- 必须点名承接、指出主矛盾、分工榆/澎、给分叉追问

**BRoleCard（B同学）：**
- 对抗辩手，逼推理严谨
- 1~3段：立场 → 矛盾攻击 → 阈值追问
- 必须明确 stance、指出过早收敛、追问排除依据

**CRoleCard（C同学）：**
- 证据链闭环者，强调可执行
- 1~3段：补证据链 → 复评节点 → 追问可选
- 必须给可执行 next step、避免与榆同质化

---

## 4. 输出协议（JSON Segments）

### 4.1 输出格式

模型必须输出严格 JSON（不得包含其他文字）：

```json
{
  "segments": [
    {"type": "acknowledge", "text": "..."},
    {"type": "priority", "text": "..."},
    {"type": "question", "text": "..."}
  ]
}
```

### 4.2 段数规则（硬约束）

| 角色 | 段数范围 | 必须包含类型 |
|-----|---------|-------------|
| teacher | 2~4段 | `question` |
| B | 1~3段 | `stance` + `question` |
| C | 1~3段 | `plan` 或 `evidence_chain` |

**每段长度：** 50~120字，最多 180字

### 4.3 Segment 类型

| 类型 | 说明 | 适用角色 |
|-----|------|---------|
| `acknowledge` | 承接段（引用同学/病例） | teacher |
| `priority` | 纠偏段（指出主矛盾） | teacher |
| `tasking` | 分工段（榆抓漏洞、澎补证据链） | teacher |
| `question` | 追问段（A/B分叉、阈值追问） | all |
| `stance` | 立场段（同意/反对 + 理由） | B |
| `contradiction` | 矛盾攻击段 | B |
| `evidence_chain` | 补证据链段 | C |
| `plan` | 可执行计划段（复评节点） | C |

---

## 5. 分段发送节奏

### 5.1 发送策略

```javascript
// server 按 segments 逐条发送 Socket.IO 消息
for (let i = 0; i < segments.length; i++) {
  await sendSegment(segments[i]);
  
  if (i < segments.length - 1) {
    // 随机间隔 300~900ms（像真人打字）
    const wait = 300 + Math.random() * 600;
    await sleep(wait);
  }
}
```

### 5.2 用户插话处理

**检测：** `room.pendingAiTurnId` 被清空  
**动作：** 立刻丢弃后续段，不续发

```javascript
const sendOne = async (chunk, isLast, remainAfter) => {
  // 检测插话
  if (room.pendingAiTurnId !== currentTurnId) {
    room.pendingChunksDiscarded = remainAfter.length;
    return false; // 中断发送
  }
  
  // 发送当前段
  io.to(roomCode).emit('message', chunk);
  
  // 间隔
  if (!isLast) {
    await sleep(300 + Math.random() * 600);
  }
  
  return true;
};
```

### 5.3 Debug Meta

- 只附在最后一段
- 前端折叠显示
- 不影响正常输出

---

## 6. 异常处理

### 6.1 超时处理

| 情况 | 超时时间 | 降级策略 |
|-----|---------|---------|
| reasoner | 28s | 降级到 chat 重试 |
| chat | 15s | fallback segments |

### 6.2 解析失败处理

```
JSON 解析失败 → 重试 1 次（强化"只输出JSON"提示）
仍失败 → fallback segments（程序化短句）
```

### 6.3 Fallback Segments

程序化生成的短句（不调用 LLM）：

```javascript
// teacher fallback
[
  { type: 'acknowledge', text: '我注意到大家正在讨论，让我们聚焦一下。' },
  { type: 'priority', text: '目前需要明确主矛盾。' },
  { type: 'tasking', text: 'B同学抓一下漏洞，C同学补证据链。' },
  { type: 'question', text: '如果这个指标异常，我们怎么走？如果正常呢？' }
]
```

---

## 7. Token 节约策略

### 7.1 人设策略（两级）

**A) 固定短角色规则卡（每次必带，<=350字）**
- 作为 developer 消息
- 内容是"行为约束 + 话语动作"，不是传记

**B) 可选 few-shot（只在必要时附带）**
- 新病例开场 `teacher_opening`
- AI长文消化 `ai_paste_suspected`
- 阶段总结 `teacher_summary`
- 输出质量差被重写 1 次仍不达标

### 7.2 上下文裁剪

| 项目 | 限制 |
|-----|------|
| 最近对话 | 15 条，最多 2000 字 |
| 关键事实 | 2~6 条 |
| 未闭环问题 | 1~3 条 |
| 课堂记忆 | ≤6 条，≤400 字 |

### 7.3 模型选择

- **deepseek-chat（温度1.1，700 tokens）：** 80%+ 回合
- **deepseek-chat严谨模式（温度0.6，1200 tokens）：** <20% 回合（关键场景）

**目标：** 平均每轮 < 1500 tokens

---

## 8. 性能指标

### 8.1 目标指标

| 指标 | 目标值 | 实测值 |
|-----|--------|--------|
| 平均 tokens/回合 | < 1500 | **1257** ✓ |
| 严谨模式使用率 | < 20% | **16.7%** ✓ |
| 段数（teacher） | 2~4 | **4** ✓ |
| 段数（B/C） | 1~3 | **3** ✓ |
| 每段字数 | 50~120，最多180 | **80~120** ✓ |
| 分段间隔 | 300~900ms | **配置完成** ✓ |

### 8.2 监控项

```javascript
{
  role: 'teacher',
  modelUsed: 'deepseek-chat',
  paramsMode: 'rigorous',  // 或 'normal'
  usage: { promptTokens: 450, completionTokens: 362, totalTokens: 812 },
  segmentCount: 4,
  parseOk: true,
  phaseTimings: { planner: 9681, emitter: 15 }
}
```

---

## 9. 调试与日志

### 9.1 日志级别

- `[Planner]`：模型选择、API 调用、解析状态
- `[Graph]`：流程阶段耗时
- `[PBL2]`：Socket 发送、debug meta

### 9.2 Debug Meta 结构

```javascript
{
  roleKey: 'teacher',
  modelUsed: 'deepseek-chat',
  usage: { ... },
  agendaStage: 'exploring',
  speakerReason: 'student_follow_up',
  parseOk: true,
  phaseTimings: { ... },
  interruptedByUser: false
}
```

---

## 10. 示例流程

### 10.1 新病例开场（teacher_opening）

```
事件检测 → teacher_opening
参数选择 → 严谨模式（温度0.6, 1200 tokens）
上下文 → 纪要化（关键事实 + 最近对话）
输出 → 4段 JSON
  [acknowledge] "榆和澎，我们刚开始澄清事实，但病例信息还很少..."
  [priority] "当前主矛盾是症状与病因不匹配..."
  [tasking] "榆，你的任务是抓漏洞...澎，补证据链..."
  [question] "分叉追问：若腹痛伴有呕吐，怎么走？若腹痛自行缓解，怎么收敛？"
发送 → 逐段发送，间隔 300~900ms
```

### 10.2 学生跟进（student_follow_up）

```
事件检测 → student_follow_up
参数选择 → 正常模式（温度1.1, 700 tokens）
角色轮换 → B（上次是 teacher）
上下文 → 纪要化
输出 → 3段 JSON
  [stance] "我部分同意老师，腹痛是关键症状，但..."
  [contradiction] "你说腹痛无发热指向非感染性，但肠缺血早期也可能无发热..."
  [question] "追问阈值：用什么证据排除肠缺血？..."
发送 → 逐段发送
```

---

## 11. 更新记录

| 日期 | 版本 | 更新内容 |
|-----|------|---------|
| 2026-02-27 | v1.0 | 初版：单模型策略（deepseek-chat）+ 参数分级 + 分段输出 + token节约 |
| 2026-02-27 | v1.1 | 弃用 reasoner（不支持JSON），改为严谨/正常两档参数 |

---

## 附录：配置文件位置

- **核心配置：** `modules/pbl2/config/config.js`
- **角色规则卡：** `modules/pbl2/prompts/roleCards.js`
- **上下文构建：** `modules/pbl2/prompts/contextBuilder.js`
- **主流程：** `modules/pbl2/graph/graph.js`
- **分段发送：** `server.js :: emitAIMessageV2`
