// 节点: emitter - 准备最终输出（实际分段发送由 server 处理）
function emitChunks(graphState) {
  const { segments, speakerDecision } = graphState;
  const roleKey = speakerDecision.nextSpeaker;

  // 转换为最终输出格式
  const chunks = segments.map(seg => ({
    text: seg.text,
    type: seg.type,
  }));

  const roleNames = {
    teacher: 'A教授',
    B: 'B同学',
    C: 'C同学',
  };

  return {
    finalOutput: {
      roleKey,
      roleName: roleNames[roleKey] || 'A教授',
      chunks,
      fullMessage: chunks.map(c => c.text).join('\n'),
    },
  };
}

module.exports = { emitChunks };
